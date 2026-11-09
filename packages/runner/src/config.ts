import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import {
  DEFAULT_VIEWPORTS,
  parseCodeowners,
  validateWaivers,
  type CheckpointA11yConfig,
  type CodeownersRule,
  type GatePolicy,
  type ViewportConfig,
} from '@checkpoint-a11y/core';

export interface ResolvedConfig extends Omit<CheckpointA11yConfig, 'checks' | 'gate' | 'viewports' | 'flows' | 'waivers'> {
  configFile?: string;
  rootDir: string;
  flows: string[];
  viewports: ViewportConfig[];
  outputDir: string;
  resultsDir: string;
  baselinePath: string;
  policy: GatePolicy;
  failOnFlowError: boolean;
  checks: Required<Pick<NonNullable<CheckpointA11yConfig['checks']>, 'axe' | 'bestPractices' | 'axeIncomplete' | 'keyboard' | 'maxTabs' | 'state' | 'reflow' | 'wcag22' | 'screenshots'>> &
    Pick<NonNullable<CheckpointA11yConfig['checks']>, 'disableRules' | 'include' | 'exclude'> & { maxScreenshots: number };
}

export interface RunState {
  codeowners: CodeownersRule[];
  helpOrders: { order: number[]; flow: string; checkpoint: string }[];
}

export const CONFIG_FILES = ['checkpoint-a11y.config.ts', 'checkpoint-a11y.config.mts', 'checkpoint-a11y.config.js', 'checkpoint-a11y.config.mjs'];

export function findConfigFile(cwd: string, explicit?: string): string | undefined {
  if (explicit) {
    const p = path.resolve(cwd, explicit);
    if (!fs.existsSync(p)) throw new Error(`Config file not found: ${p}`);
    return p;
  }
  for (const f of CONFIG_FILES) {
    const p = path.join(cwd, f);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export async function importTs<T = unknown>(file: string): Promise<T> {
  const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
  return (await jiti.import(file, { default: true })) as T;
}

export async function loadConfig(cwd: string, explicit?: string, overrides: Partial<CheckpointA11yConfig> = {}): Promise<ResolvedConfig> {
  const configFile = findConfigFile(cwd, explicit);
  const raw: CheckpointA11yConfig = configFile ? await importTs<CheckpointA11yConfig>(configFile) : ({ baseURL: '' } as CheckpointA11yConfig);
  return resolveConfig({ ...raw, ...stripUndefined(overrides) }, configFile ? path.dirname(configFile) : cwd, configFile);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function resolveConfig(raw: CheckpointA11yConfig, dir: string, configFile?: string): ResolvedConfig {
  const baseURL = process.env.CHECKPOINT_A11Y_BASE_URL || raw.baseURL;
  const outputDir = path.resolve(dir, raw.outputDir ?? '.checkpoint-a11y');
  const waivers = raw.waivers ?? [];
  const waiverErrors = validateWaivers(waivers);
  if (waiverErrors.length) throw new Error(`Invalid waivers in config:\n  ${waiverErrors.join('\n  ')}`);
  const c = raw.checks ?? {};
  return {
    ...raw,
    configFile,
    baseURL,
    rootDir: path.resolve(dir, raw.rootDir ?? findRepoRoot(dir) ?? dir),
    flows: raw.flows ?? ['a11y/**/*.flow.{ts,js,mjs}'],
    viewports: raw.viewports?.length ? raw.viewports : DEFAULT_VIEWPORTS,
    outputDir,
    resultsDir: path.join(outputDir, 'results'),
    baselinePath: path.resolve(dir, raw.baselinePath ?? path.join(raw.outputDir ?? '.checkpoint-a11y', 'baseline.json')),
    policy: { failOn: raw.gate?.failOn ?? 'any', failOnReview: raw.gate?.failOnReview ?? false, waivers },
    failOnFlowError: raw.gate?.failOnFlowError ?? true,
    checks: {
      axe: c.axe ?? true,
      bestPractices: c.bestPractices ?? false,
      axeIncomplete: c.axeIncomplete ?? false,
      keyboard: c.keyboard ?? true,
      maxTabs: c.maxTabs ?? 150,
      state: c.state ?? true,
      reflow: c.reflow ?? true,
      wcag22: c.wcag22 ?? true,
      screenshots: c.screenshots ?? true,
      maxScreenshots: 40,
      disableRules: c.disableRules,
      include: c.include,
      exclude: c.exclude,
    },
  };
}

export function findRepoRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function loadCodeowners(config: ResolvedConfig): CodeownersRule[] {
  const candidates = config.codeowners
    ? [path.resolve(config.rootDir, config.codeowners)]
    : ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'].map((p) => path.join(config.rootDir, p));
  for (const file of candidates) {
    if (fs.existsSync(file)) return parseCodeowners(fs.readFileSync(file, 'utf8'));
  }
  return [];
}

export function newRunState(config: ResolvedConfig): RunState {
  return { codeowners: loadCodeowners(config), helpOrders: [] };
}
