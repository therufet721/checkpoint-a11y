import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { glob } from 'tinyglobby';
import { RULESET_VERSION, type FlowResult, type RunResult } from '@checkpoint-a11y/core';
import { createContext, launchOptions, preflight, runAuthSetup } from './access';
import { A11y } from './checkpoint';
import { importTs, newRunState, type ResolvedConfig, type RunState } from './config';
import { detectGit } from './git';
import { clearFlows, registeredFlows, setCurrentFlowFile, type FlowDefinition } from './registry';
import { AXE_VERSION, TOOL_VERSION } from './version';

export interface RunOptions {
  grep?: string;
  headed?: boolean;
  log?: (msg: string) => void;
}

export function rulesetInfo(): RunResult['ruleset'] {
  return { version: RULESET_VERSION, axeVersion: AXE_VERSION, standard: 'WCAG 2.2 AA', reportedAgainst: ['WCAG 2.2 AA', 'WCAG 2.1 AA'] };
}

export async function discoverFlows(config: ResolvedConfig): Promise<FlowDefinition[]> {
  const cwd = config.configFile ? path.dirname(config.configFile) : process.cwd();
  const files = (await glob(config.flows, { cwd, absolute: true, ignore: ['**/node_modules/**'] })).sort();
  clearFlows();
  for (const file of files) {
    setCurrentFlowFile(path.relative(cwd, file));
    try {
      await importTs(file);
    } finally {
      setCurrentFlowFile(undefined);
    }
  }
  return registeredFlows();
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runFlow(
  browser: Browser,
  def: FlowDefinition,
  config: ResolvedConfig,
  state: RunState,
  viewport: ResolvedConfig['viewports'][number],
  qualify: boolean,
  storageState?: string,
): Promise<FlowResult> {
  const started = Date.now();
  const context = await createContext(browser, config, {
    viewport: { width: viewport.width, height: viewport.height },
    storageState: storageState ?? (config.storageState ? path.resolve(config.rootDir, config.storageState) : undefined),
  });
  const page = await context.newPage();
  const a11y = new A11y({ page, flow: def.name, viewport, qualifyByViewport: qualify, config, state });
  let error: string | undefined;
  try {
    await withTimeout(def.fn({ page, context, a11y, baseURL: config.baseURL, viewport }), def.options.timeout ?? 120_000, `Flow "${def.name}"`);
  } catch (err) {
    error = (err as Error).stack ?? String(err);
  } finally {
    await context.close().catch(() => undefined);
  }
  return {
    name: def.name,
    file: def.file,
    status: error ? 'error' : 'passed',
    error,
    durationMs: Date.now() - started,
    checkpoints: a11y.checkpoints,
  };
}

export async function runAll(config: ResolvedConfig, opts: RunOptions = {}): Promise<RunResult> {
  const log = opts.log ?? (() => undefined);
  const startedAt = new Date().toISOString();
  await fs.rm(config.resultsDir, { recursive: true, force: true });
  await fs.mkdir(path.join(config.resultsDir, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(config.resultsDir, 'flows'), { recursive: true });

  let flows = await discoverFlows(config);
  if (opts.grep) flows = flows.filter((f) => f.name.toLowerCase().includes(opts.grep!.toLowerCase()));
  flows = flows.filter((f) => !f.options.skip);
  if (!flows.length) throw new Error(`No flows found for ${config.flows.join(', ')}${opts.grep ? ` matching "${opts.grep}"` : ''}.`);
  if (!config.baseURL) log('Warning: no baseURL configured; flows must use absolute URLs.');

  const state = newRunState(config);
  const browser = await chromium.launch(launchOptions(config, opts.headed));
  const results: FlowResult[] = [];
  const qualify = config.viewports.length > 1;
  try {
    const storageState = await runAuthSetup(browser, config, log);
    await preflight(browser, config, storageState);
    for (const viewport of config.viewports) {
      for (const def of flows) {
        if (def.options.viewports && !def.options.viewports.includes(viewport.name)) continue;
        log(`▶ ${def.name}${qualify ? ` @${viewport.name}` : ''}`);
        const r = await runFlow(browser, def, config, state, viewport, qualify, storageState);
        const issues = r.checkpoints.reduce((n, c) => n + c.issues.length, 0);
        log(`  ${r.status === 'passed' ? '✓' : '✗'} ${r.checkpoints.length} checkpoint(s), ${issues} finding(s) in ${(r.durationMs / 1000).toFixed(1)}s`);
        if (r.error) log(`  ${r.error.split('\n')[0]}`);
        results.push(r);
      }
    }
  } finally {
    await browser.close();
  }

  const run: RunResult = {
    schemaVersion: 1,
    tool: { name: 'checkpoint-a11y', version: TOOL_VERSION },
    ruleset: rulesetInfo(),
    startedAt,
    finishedAt: new Date().toISOString(),
    git: detectGit(config.rootDir),
    flows: results,
  };
  await fs.writeFile(path.join(config.resultsDir, 'run.json'), JSON.stringify(run, null, 2));
  return run;
}

/** Merges per-flow results written by the Playwright fixture into one run. */
export async function collectFlowResults(config: ResolvedConfig): Promise<RunResult> {
  const dir = path.join(config.resultsDir, 'flows');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error(`No flow results in ${dir}. Run your Playwright tests with the @checkpoint-a11y/runner/playwright fixture first.`);
  const flows: FlowResult[] = [];
  for (const f of files) flows.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')));
  const now = new Date().toISOString();
  const run: RunResult = {
    schemaVersion: 1,
    tool: { name: 'checkpoint-a11y', version: TOOL_VERSION },
    ruleset: rulesetInfo(),
    startedAt: now,
    finishedAt: now,
    git: detectGit(config.rootDir),
    flows,
  };
  await fs.writeFile(path.join(config.resultsDir, 'run.json'), JSON.stringify(run, null, 2));
  return run;
}

export async function readLastRun(config: ResolvedConfig): Promise<RunResult> {
  const file = path.join(config.resultsDir, 'run.json');
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as RunResult;
  } catch {
    throw new Error(`No results found at ${file}. Run \`checkpoint-a11y run\` first.`);
  }
}
