import path from 'node:path';
import type { Browser, BrowserContext, LaunchOptions } from 'playwright';
import type { ResolvedConfig } from './config';
import { importTs } from './config';

export class AccessError extends Error {}

export function launchOptions(config: ResolvedConfig, headed?: boolean): LaunchOptions {
  return {
    headless: headed ? false : (config.browser?.headless ?? true),
    channel: config.browser?.channel,
    proxy: config.access?.proxy,
  };
}

function originOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Origins that may receive access headers: the app itself plus explicitly allowed ones. */
export function trustedOrigins(config: ResolvedConfig): Set<string> {
  const set = new Set<string>();
  const base = originOf(config.baseURL);
  if (base) set.add(base);
  for (const o of config.access?.allowedOrigins ?? []) {
    const origin = originOf(o);
    if (origin) set.add(origin);
  }
  return set;
}

/**
 * A browser context carrying the customer's access configuration.
 * Headers are attached per request and only for trusted origins, so a WAF bypass key never reaches
 * analytics, CDNs or other third parties loaded by the page.
 */
export async function createContext(
  browser: Browser,
  config: ResolvedConfig,
  opts: { viewport: { width: number; height: number }; storageState?: string },
): Promise<BrowserContext> {
  const access = config.access ?? {};
  let userAgent = access.userAgent;
  if (!userAgent && access.userAgentSuffix) userAgent = `${browser.browserType().name() === 'chromium' ? await defaultUserAgent(browser) : ''} ${access.userAgentSuffix}`.trim();

  const context = await browser.newContext({
    baseURL: config.baseURL || undefined,
    viewport: opts.viewport,
    storageState: opts.storageState,
    reducedMotion: 'reduce',
    userAgent,
    ignoreHTTPSErrors: access.ignoreHTTPSErrors,
    httpCredentials: access.httpCredentials ? { ...access.httpCredentials, origin: originOf(config.baseURL) } : undefined,
  });

  const headers = access.headers ?? {};
  if (Object.keys(headers).length) {
    const trusted = trustedOrigins(config);
    await context.route('**/*', (route) => {
      const req = route.request();
      if (!trusted.has(originOf(req.url()) ?? '')) return route.fallback();
      return route.fallback({ headers: { ...req.headers(), ...headers } });
    });
  }
  return context;
}

let cachedUA: string | undefined;
async function defaultUserAgent(browser: Browser): Promise<string> {
  if (cachedUA) return cachedUA;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  cachedUA = await page.evaluate(() => navigator.userAgent);
  await ctx.close();
  return cachedUA;
}

const BLOCKED = new Set([401, 403, 407, 429]);

/**
 * Runs in the page. Recognises bot-protection challenge and block pages that come back with HTTP 200.
 * Returns a short reason, or null if the page looks like the real site.
 */
export function detectBlockPage(readySelector?: string): string | null {
  const title = (document.title || '').toLowerCase();
  const text = (document.body?.innerText || '').slice(0, 5000).toLowerCase();
  const html = document.documentElement.outerHTML.slice(0, 200_000).toLowerCase();
  const rules: [string, boolean][] = [
    ['Cloudflare challenge', title.includes('just a moment') || html.includes('cf-chl') || html.includes('challenges.cloudflare.com/cdn-cgi')],
    ['Cloudflare block', title.includes('attention required') && html.includes('cloudflare')],
    ['DataDome', html.includes('captcha-delivery.com') || html.includes('geo.captcha-delivery')],
    ['PerimeterX / HUMAN', html.includes('px-captcha') || text.includes('press & hold') || text.includes('press and hold')],
    ['Imperva / Incapsula', html.includes('_incapsula_resource') || text.includes('request unsuccessful. incapsula')],
    ['Akamai', title === 'access denied' && text.includes('reference #')],
    ['Kasada', html.includes('ips.js') && html.includes('kpsdk')],
    ['Bot reference page', /reference\s*(bot|id)?\s*:?\s*(bot|#)?\s*[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+/.test(text) || text.includes('reference bot')],
    ['Human verification', /verify (that )?you are (a )?human|are you a robot|unusual traffic|pardon our interruption/.test(text)],
  ];
  const hit = rules.find(([, m]) => m);
  if (hit) return hit[0];
  if (readySelector && !document.querySelector(readySelector)) return `expected element "${readySelector}" not found`;
  return null;
}

export function blockedMessage(url: string, reason: string): string {
  return [
    `${url} served a bot-protection page (${reason}) instead of the site, so there is nothing real to scan.`,
    `Grant the runner access in checkpoint-a11y.config.ts:`,
    `  access: { headers: { 'x-your-bypass-header': process.env.BYPASS_KEY! } }   // sent only to your origin`,
    `  access: { userAgentSuffix: 'Checkpoint A11y (+your-allowlist-id)' }               // allow-list by user agent`,
    `  access: { httpCredentials: { username, password } }                       // basic auth on staging`,
    `or allow-list your CI runners' IP addresses, or point baseURL at a preview/staging deployment.`,
  ].join('\n');
}

/**
 * Loads baseURL once before any flow. A blocked response would otherwise be scanned as if it were the
 * app, producing a report about a challenge page.
 */
export async function preflight(browser: Browser, config: ResolvedConfig, storageState?: string): Promise<void> {
  if (!config.baseURL || config.access?.skipPreflight) return;
  const context = await createContext(browser, config, { viewport: config.viewports[0]!, storageState });
  try {
    const page = await context.newPage();
    let status: number | undefined;
    let error: string | undefined;
    try {
      status = (await page.goto(config.baseURL, { waitUntil: 'domcontentloaded', timeout: 30_000 }))?.status();
    } catch (e) {
      error = (e as Error).message.split('\n')[0];
    }
    if (error) throw new AccessError(`Could not load ${config.baseURL}: ${error}`);
    if (status && !BLOCKED.has(status)) {
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
      const reason = await page.evaluate(detectBlockPage, config.access?.readySelector);
      if (reason) throw new AccessError(blockedMessage(config.baseURL, reason));
    }
    if (status && BLOCKED.has(status)) {
      throw new AccessError(
        [
          `${config.baseURL} answered HTTP ${status}: the runner is being blocked, so there is nothing real to scan.`,
          `This is usually bot protection or staging auth. Grant the runner access in checkpoint-a11y.config.ts:`,
          `  access: { headers: { 'x-your-bypass-header': process.env.BYPASS_KEY! } }   // sent only to your origin`,
          `  access: { userAgentSuffix: 'Checkpoint A11y (+your-allowlist-id)' }               // allow-list by user agent`,
          `  access: { httpCredentials: { username, password } }                       // basic auth on staging`,
          `or allow-list your CI runners' IP addresses, or point baseURL at a preview/staging deployment.`,
          `Set access.skipPreflight to true to bypass this check.`,
        ].join('\n'),
      );
    }
  } finally {
    await context.close();
  }
}

/** Runs the auth setup script once and returns the saved storage state path. */
export async function runAuthSetup(browser: Browser, config: ResolvedConfig, log: (m: string) => void): Promise<string | undefined> {
  const initial = config.storageState ? path.resolve(config.rootDir, config.storageState) : undefined;
  if (!config.auth?.setup) return initial;
  const cwd = config.configFile ? path.dirname(config.configFile) : process.cwd();
  const file = path.resolve(cwd, config.auth.setup);
  const setup = await importTs<(ctx: { page: import('playwright').Page; context: BrowserContext; baseURL: string }) => Promise<void>>(file);
  if (typeof setup !== 'function') throw new Error(`${config.auth.setup} must export a default async function`);
  log(`▶ auth setup (${config.auth.setup})`);
  const context = await createContext(browser, config, { viewport: config.viewports[0]!, storageState: initial });
  try {
    const page = await context.newPage();
    await setup({ page, context, baseURL: config.baseURL });
    const out = path.join(config.outputDir, 'auth', 'state.json');
    await context.storageState({ path: out });
    log('  ✓ logged in, session saved');
    return out;
  } finally {
    await context.close();
  }
}
