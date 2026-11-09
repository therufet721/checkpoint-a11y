import { groupOccurrences, allOccurrences } from './group';
import { IMPACT_ORDER, type Baseline, type GateDiff, type GatePolicy, type IssueGroup, type RunResult, type Waiver } from './types';

export const DEFAULT_POLICY: GatePolicy = { failOn: 'any', failOnReview: false, waivers: [] };

export function activeWaiver(waivers: Waiver[], issue: Pick<IssueGroup, 'fingerprint' | 'rootCauseKey'>, now = new Date()): Waiver | undefined {
  return waivers.find(
    (w) => (w.match === issue.fingerprint || w.match === issue.rootCauseKey) && new Date(w.expires).getTime() > now.getTime(),
  );
}

/** Why a new issue does not block, or undefined if it does. */
export function nonBlockingReason(issue: IssueGroup, policy: GatePolicy, now = new Date()): string | undefined {
  const waiver = activeWaiver(policy.waivers, issue, now);
  if (waiver) return `waived until ${waiver.expires.slice(0, 10)}: ${waiver.reason}`;
  if (policy.failOn === 'none') return 'policy is warn-only';
  if (issue.kind === 'needs-review' && !policy.failOnReview) return 'needs manual review';
  if (policy.failOn === 'serious' && IMPACT_ORDER[issue.impact] < IMPACT_ORDER.serious) return `impact ${issue.impact} is below the serious threshold`;
  return undefined;
}

export function baselineFromRun(run: RunResult): Baseline {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    commit: run.git.commit,
    branch: run.git.branch,
    ruleset: run.ruleset,
    issues: groupOccurrences(allOccurrences(run)).map(({ screenshot: _s, ariaSnapshot: _a, ...rest }) => rest),
  };
}

/**
 * The "no new debt" rule.
 * New: in the run, not in the baseline. These can fail the gate.
 * Fixed: in the baseline, not in the run.
 * Existing: in both. Reported, never blocking.
 * Without a baseline every issue is treated as new, but the gate passes so that the first run never goes red.
 */
export function checkpointKey(flow: string, checkpoint: string): string {
  return `${flow}\u001f${checkpoint}`;
}

/** The checkpoints that actually ran. Baseline issues elsewhere are not "fixed", just untested. */
export function executedCheckpoints(run: RunResult): Set<string> {
  return new Set(run.flows.flatMap((f) => f.checkpoints.map((c) => checkpointKey(f.name, c.name))));
}

export interface DiffOptions {
  policy?: GatePolicy;
  /** If given, only baseline issues at these checkpoints can be reported as fixed. */
  executed?: Set<string>;
  now?: Date;
}

export function diffAgainstBaseline(
  current: IssueGroup[],
  baseline: Baseline | null | undefined,
  options: DiffOptions | GatePolicy = {},
): GateDiff {
  const opts: DiffOptions = 'failOn' in options ? { policy: options } : options;
  const policy = opts.policy ?? DEFAULT_POLICY;
  const now = opts.now ?? new Date();
  const known = new Map((baseline?.issues ?? []).map((i) => [i.fingerprint, i]));
  const currentFps = new Set(current.map((i) => i.fingerprint));

  const newIssues = current.filter((i) => !known.has(i.fingerprint));
  const existingIssues = current.filter((i) => known.has(i.fingerprint));
  const fixedIssues = (baseline?.issues ?? []).filter(
    (i) => !currentFps.has(i.fingerprint) && (!opts.executed || opts.executed.has(checkpointKey(i.flow, i.checkpoint))),
  );

  const nonBlocking: GateDiff['nonBlocking'] = [];
  const blocking: IssueGroup[] = [];
  for (const issue of newIssues) {
    const reason = baseline ? nonBlockingReason(issue, policy, now) : 'no baseline recorded yet';
    if (reason) nonBlocking.push({ fingerprint: issue.fingerprint, reason });
    else blocking.push(issue);
  }

  return {
    newIssues,
    fixedIssues,
    existingIssues,
    nonBlocking,
    blocking,
    passed: blocking.length === 0,
    hasBaseline: !!baseline,
  };
}

export function validateWaivers(waivers: Waiver[]): string[] {
  const errors: string[] = [];
  waivers.forEach((w, i) => {
    if (!w.match) errors.push(`waivers[${i}]: "match" is required`);
    if (!w.reason?.trim()) errors.push(`waivers[${i}]: "reason" is required`);
    if (!w.expires || Number.isNaN(new Date(w.expires).getTime())) errors.push(`waivers[${i}]: "expires" must be an ISO date`);
  });
  return errors;
}

/**
 * Builds the next baseline from a run. Issues at checkpoints the run did not execute are carried over
 * from the previous baseline, so a partial or filtered run cannot silently erase known debt.
 */
export function nextBaseline(previous: Baseline | null | undefined, run: RunResult): Baseline {
  const fresh = baselineFromRun(run);
  if (!previous) return fresh;
  const executed = executedCheckpoints(run);
  const carried = previous.issues.filter((i) => !executed.has(checkpointKey(i.flow, i.checkpoint)));
  return { ...fresh, issues: [...fresh.issues, ...carried] };
}
