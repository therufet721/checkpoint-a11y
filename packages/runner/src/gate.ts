import fs from 'node:fs/promises';
import path from 'node:path';
import {
  allOccurrences,
  diffAgainstBaseline,
  executedCheckpoints,
  groupOccurrences,
  nextBaseline,
  renderPrComment,
  renderTerminalSummary,
  type Baseline,
  type GateDiff,
  type RunResult,
} from '@checkpoint-a11y/core';
import { uploadRun } from './api';
import type { ResolvedConfig } from './config';
import { upsertPrComment, writeJobSummary } from './github';

export interface GateOptions {
  /** Post or update the PR comment (needs GITHUB_TOKEN). */
  comment?: boolean;
  /** Write the local baseline from this run (local mode only). */
  updateBaseline?: boolean;
  /** Ignore the API even if configured. */
  offline?: boolean;
  log?: (msg: string) => void;
}

export interface GateOutcome {
  diff: GateDiff;
  comment: string;
  exitCode: number;
  mode: 'api' | 'local';
  dashboardUrl?: string;
}

export const EXIT = { ok: 0, gateFailed: 1, flowError: 2, toolError: 3 } as const;

export async function readBaselineFile(file: string): Promise<Baseline | null> {
  try {
    const b = JSON.parse(await fs.readFile(file, 'utf8')) as Baseline;
    if (b.schemaVersion !== 1 || !Array.isArray(b.issues)) throw new Error(`Unsupported baseline format in ${file}`);
    return b;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeBaselineFile(file: string, baseline: Baseline): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Stable ordering keeps baseline diffs in code review readable.
  const issues = [...baseline.issues].sort((a, b) => a.flow.localeCompare(b.flow) || a.checkpoint.localeCompare(b.checkpoint) || a.fingerprint.localeCompare(b.fingerprint));
  await fs.writeFile(file, JSON.stringify({ ...baseline, issues }, null, 2) + '\n');
}

export async function gate(run: RunResult, config: ResolvedConfig, opts: GateOptions = {}): Promise<GateOutcome> {
  const log = opts.log ?? (() => undefined);
  const token = process.env.CHECKPOINT_A11Y_TOKEN;
  const apiUrl = process.env.CHECKPOINT_A11Y_API_URL ?? config.api?.url;
  const useApi = !!(token && apiUrl && !opts.offline);
  const flowErrors = run.flows.filter((f) => f.status === 'error');

  let diff: GateDiff;
  let comment: string;
  let dashboardUrl: string | undefined;

  if (useApi) {
    log(`Uploading results to ${apiUrl}`);
    const res = await uploadRun({ url: apiUrl!, token: token! }, run, config.resultsDir, config.policy);
    diff = res.diff;
    comment = res.comment;
    dashboardUrl = res.dashboardUrl;
    if (opts.updateBaseline) log('Note: in API mode the baseline is updated by the server for runs on the default branch.');
  } else {
    const baseline = await readBaselineFile(config.baselinePath);
    diff = diffAgainstBaseline(groupOccurrences(allOccurrences(run)), baseline, { policy: config.policy, executed: executedCheckpoints(run) });
    comment = renderPrComment(diff, { commit: run.git.commit });
    if (opts.updateBaseline) {
      if (flowErrors.length) {
        log(`Baseline not updated: ${flowErrors.length} flow(s) failed, so the results are incomplete.`);
      } else {
        await writeBaselineFile(config.baselinePath, nextBaseline(baseline, run));
        log(`Baseline written to ${path.relative(process.cwd(), config.baselinePath)}`);
      }
    }
  }

  if (flowErrors.length) {
    comment += `\n\n> ⚠️ ${flowErrors.length} flow(s) failed to run: ${flowErrors.map((f) => `\`${f.name}\``).join(', ')}. Their checkpoints were not tested.`;
  }

  await fs.mkdir(config.resultsDir, { recursive: true });
  await fs.writeFile(path.join(config.resultsDir, 'diff.json'), JSON.stringify(diff, null, 2));
  await fs.writeFile(path.join(config.resultsDir, 'comment.md'), comment);
  await writeJobSummary(comment).catch(() => undefined);

  if (opts.comment) {
    const ghToken = process.env.GITHUB_TOKEN;
    const { repo, prNumber } = run.git;
    if (!ghToken) log('PR comment skipped: GITHUB_TOKEN is not set.');
    else if (!repo || !prNumber) log('PR comment skipped: not running on a pull request.');
    else {
      try {
        const action = await upsertPrComment({ token: ghToken, repo, prNumber }, comment);
        log(`PR comment ${action}.`);
      } catch (err) {
        log(`PR comment failed: ${(err as Error).message}`);
      }
    }
  }

  log('');
  log(renderTerminalSummary(diff));
  if (dashboardUrl) log(`Dashboard: ${dashboardUrl}`);

  const exitCode = !diff.passed ? EXIT.gateFailed : flowErrors.length && config.failOnFlowError ? EXIT.flowError : EXIT.ok;
  if (exitCode === EXIT.flowError) log(`Checkpoint A11y: ${flowErrors.length} flow(s) errored.`);
  return { diff, comment, exitCode, mode: useApi ? 'api' : 'local', dashboardUrl };
}
