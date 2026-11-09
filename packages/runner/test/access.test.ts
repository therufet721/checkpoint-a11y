import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CheckpointA11yConfig } from '@checkpoint-a11y/core';
import { AccessError, createContext, preflight, runAuthSetup } from '../src/access';
import { resolveConfig } from '../src/config';
import { runFlow } from '../src/run';

let app: http.Server;
let thirdParty: http.Server;
let appURL: string;
let thirdURL: string;
let browser: Browser;
const thirdPartyHeaders: http.IncomingHttpHeaders[] = [];
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ca11y-access-'));

async function listen(s: http.Server): Promise<string> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  // Third party on another origin: records what it receives.
  thirdParty = http.createServer((req, res) => {
    thirdPartyHeaders.push(req.headers);
    res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* analytics */');
  });
  thirdURL = await listen(thirdParty);

  // The "customer site": a WAF that wants x-bypass or an allow-listed UA, staging basic auth on /staging,
  // and a login-protected /account.
  app = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/soft' || url === '/soft/next') {
      // A block page that comes back as 200, like the ones vendors serve to bots.
      const body = url === '/soft'
        ? '<!doctype html><html lang="en"><title>Shop</title><main><h1>Shop</h1><a href="/soft/next">Next</a></main></html>'
        : '<!doctype html><html lang="en"><title>Shop</title><h1>Something went wrong</h1><p>Reference BOT: 0.55ca3017.1794262486.7c29f06</p></html>';
      return void res.writeHead(200, { 'content-type': 'text/html' }).end(body);
    }
    if (url === '/staging') {
      const ok = req.headers.authorization === 'Basic ' + Buffer.from('qa:pw').toString('base64');
      if (!ok) return void res.writeHead(401, { 'www-authenticate': 'Basic realm="staging"' }).end();
      return void res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html lang="en"><title>s</title><main><h1>Staging</h1></main></html>');
    }
    const allowed = req.headers['x-bypass'] === 'secret' || /CheckpointA11y-allow/.test(req.headers['user-agent'] ?? '');
    if (!allowed) return void res.writeHead(403, { 'content-type': 'text/html' }).end('<p>Access denied</p>');
    if (url === '/login') {
      return void res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=ok; Path=/' }).end('<!doctype html><title>login</title><p>Logged in</p>');
    }
    if (url === '/account' && !(req.headers.cookie ?? '').includes('session=ok')) {
      return void res.writeHead(302, { location: '/login-required' }).end();
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(
      `<!doctype html><html lang="en"><head><title>App</title><script src="${thirdURL}/tag.js"></script></head><body><main><h1>${url}</h1></main></body></html>`,
    );
  });
  appURL = await listen(app);
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  app?.close();
  thirdParty?.close();
});

const cfg = (extra: Partial<CheckpointA11yConfig>) => resolveConfig({ baseURL: appURL, outputDir: out, ...extra }, out);

describe('customer-authorised access', () => {
  it('stops with guidance when the site blocks the runner', async () => {
    const err = await preflight(browser, cfg({})).catch((e) => e);
    expect(err).toBeInstanceOf(AccessError);
    expect(String(err.message)).toMatch(/HTTP 403/);
    expect(String(err.message)).toMatch(/access:/);
  });

  it('gets through with a bypass header, and never sends it to third parties', async () => {
    const config = cfg({ access: { headers: { 'x-bypass': 'secret' } } });
    await preflight(browser, config);
    thirdPartyHeaders.length = 0;
    const ctx = await createContext(browser, config, { viewport: { width: 800, height: 600 } });
    const page = await ctx.newPage();
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await ctx.close();
    expect(thirdPartyHeaders.length).toBeGreaterThan(0);
    for (const h of thirdPartyHeaders) expect(h['x-bypass']).toBeUndefined();
  });

  it('gets through with an allow-listed user agent suffix', async () => {
    await preflight(browser, cfg({ access: { userAgentSuffix: 'CheckpointA11y-allow/1' } }));
  });

  it('supports basic auth on staging', async () => {
    const blocked = await preflight(browser, cfg({ baseURL: `${appURL}/staging` })).catch((e) => e);
    expect(blocked).toBeInstanceOf(AccessError);
    await preflight(browser, cfg({ baseURL: `${appURL}/staging`, access: { httpCredentials: { username: 'qa', password: 'pw' } } }));
  });

  it('logs in once with an auth setup script and reuses the session', async () => {
    const setupFile = path.join(out, 'auth.setup.mjs');
    fs.writeFileSync(setupFile, `export default async ({ page }) => { await page.goto('/login'); };`);
    const config = resolveConfig({ baseURL: appURL, outputDir: out, access: { headers: { 'x-bypass': 'secret' } }, auth: { setup: setupFile } }, out);
    const state = await runAuthSetup(browser, config, () => undefined);
    expect(state && fs.existsSync(state)).toBe(true);
    const ctx = await createContext(browser, config, { viewport: { width: 800, height: 600 }, storageState: state });
    const page = await ctx.newPage();
    await page.goto('/account');
    expect(new URL(page.url()).pathname).toBe('/account');
    await ctx.close();
  });

  it('detects a block page served with HTTP 200', async () => {
    const err = await preflight(browser, cfg({ baseURL: `${appURL}/soft/next` })).catch((e) => e);
    expect(err).toBeInstanceOf(AccessError);
    expect(String(err.message)).toMatch(/Bot reference page/);
  });

  it('accepts the real page and honours readySelector', async () => {
    await preflight(browser, cfg({ baseURL: `${appURL}/soft` }));
    const err = await preflight(browser, cfg({ baseURL: `${appURL}/soft`, access: { readySelector: '#checkout' } })).catch((e) => e);
    expect(String(err?.message)).toMatch(/#checkout/);
  });

  it('fails the flow instead of scanning when blocked mid-flow', async () => {
    const config = cfg({ baseURL: `${appURL}/soft` });
    fs.mkdirSync(path.join(config.resultsDir, 'artifacts'), { recursive: true });
    const result = await runFlow(
      browser,
      { name: 'mid-flow block', options: {}, fn: async ({ page, a11y }) => {
        await page.goto(`${appURL}/soft`);
        await a11y.checkpoint('first page');
        await page.goto(`${appURL}/soft/next`);
        await a11y.checkpoint('second page');
      } },
      config,
      { codeowners: [], helpOrders: [] },
      config.viewports[0]!,
      false,
    );
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/second page" blocked/);
    expect(result.checkpoints.map((c) => c.name)).toEqual(['first page']);
  }, 60_000);
});
