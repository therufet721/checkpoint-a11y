/** Severity as reported by axe-core, reused for custom checks. */
export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export const IMPACT_ORDER: Record<Impact, number> = { minor: 0, moderate: 1, serious: 2, critical: 3 };

/**
 * violation: a definite failure that can block a PR.
 * needs-review: a heuristic or partial check that a human must confirm. Never blocks by default.
 */
export type IssueKind = 'violation' | 'needs-review';

/** Which check family produced the issue. */
export type RuleSource = 'axe' | 'keyboard' | 'state' | 'layout' | 'wcag22';

export type AttributionMethod = 'build-plugin' | 'react-fiber' | 'angular-debug' | 'selector';

export interface Attribution {
  method: AttributionMethod;
  /** Component name, e.g. "PrimaryButton". */
  component?: string;
  /** Repo-relative source path, e.g. "packages/ui/src/Button.tsx". */
  sourcePath?: string;
  line?: number;
  /** Stamped ancestors from innermost to outermost, e.g. ["IconButton", "Header", "App"]. */
  stack?: string[];
  /** Owners resolved from CODEOWNERS. */
  owners?: string[];
}

export interface StandardsApplicability {
  /** The issue maps to a WCAG 2.1 A/AA criterion. */
  wcag21: boolean;
  /** The issue maps to a WCAG 2.2 A/AA criterion. */
  wcag22: boolean;
}

/** One concrete failing element at one checkpoint. */
export interface IssueOccurrence {
  /** Stable id for (rule, component-or-selector, flow, checkpoint). */
  fingerprint: string;
  /** Stable id for (rule, component-or-selector). Groups the same root cause across pages. */
  rootCauseKey: string;
  ruleId: string;
  source: RuleSource;
  kind: IssueKind;
  impact: Impact;
  /** WCAG success criteria, e.g. ["1.4.3"]. */
  wcag: string[];
  standards: StandardsApplicability;
  /** Short human summary of the rule. */
  help: string;
  /** Longer explanation for this specific element. */
  description: string;
  helpUrl?: string;
  flow: string;
  checkpoint: string;
  url: string;
  selector: string;
  normalizedSelector: string;
  html: string;
  attribution: Attribution;
  /** Path of the element screenshot, relative to the results directory. */
  screenshot?: string;
  /** Accessibility tree excerpt (Playwright aria snapshot). */
  ariaSnapshot?: string;
}

export interface CheckpointResult {
  flow: string;
  name: string;
  url: string;
  viewport: { name: string; width: number; height: number };
  durationMs: number;
  /** Full viewport screenshot, relative to the results directory. */
  screenshot?: string;
  issues: IssueOccurrence[];
  /** Checks that could not run, with the reason. Shown as known limitations. */
  skipped?: { check: string; reason: string }[];
}

export interface FlowResult {
  name: string;
  file?: string;
  status: 'passed' | 'error';
  error?: string;
  durationMs: number;
  checkpoints: CheckpointResult[];
}

export interface GitInfo {
  commit?: string;
  branch?: string;
  baseBranch?: string;
  prNumber?: number;
  repo?: string; // "owner/name"
}

export interface RulesetInfo {
  /** Version of the Checkpoint A11y rule set (bumped whenever a check changes). */
  version: string;
  axeVersion: string;
  /** The standard the run is primarily tested against. */
  standard: 'WCAG 2.2 AA';
  /** Standards the run is also reported against. */
  reportedAgainst: string[];
}

export interface RunResult {
  schemaVersion: 1;
  tool: { name: 'checkpoint-a11y'; version: string };
  ruleset: RulesetInfo;
  startedAt: string;
  finishedAt: string;
  git: GitInfo;
  flows: FlowResult[];
}

/** All occurrences that share a fingerprint, collapsed into one reportable issue. */
export interface IssueGroup {
  fingerprint: string;
  rootCauseKey: string;
  ruleId: string;
  source: RuleSource;
  kind: IssueKind;
  impact: Impact;
  wcag: string[];
  standards: StandardsApplicability;
  help: string;
  description: string;
  helpUrl?: string;
  flow: string;
  checkpoint: string;
  url: string;
  selector: string;
  html: string;
  attribution: Attribution;
  occurrences: number;
  screenshot?: string;
  ariaSnapshot?: string;
}

/** Same rule + same component (or selector) across every flow and checkpoint. */
export interface RootCause {
  key: string;
  ruleId: string;
  impact: Impact;
  kind: IssueKind;
  help: string;
  helpUrl?: string;
  wcag: string[];
  attribution: Attribution;
  selector: string;
  fingerprints: string[];
  locations: { flow: string; checkpoint: string }[];
  occurrences: number;
}

export interface Baseline {
  schemaVersion: 1;
  createdAt: string;
  commit?: string;
  branch?: string;
  ruleset: RulesetInfo;
  /** Issue groups without screenshots or snapshots, keyed implicitly by fingerprint. */
  issues: Omit<IssueGroup, 'screenshot' | 'ariaSnapshot'>[];
}

export interface Waiver {
  /** Fingerprint or root cause key. */
  match: string;
  reason: string;
  author?: string;
  /** ISO date. A waiver without expiry is rejected by validation. */
  expires: string;
}

export type FailOn = 'any' | 'serious' | 'none';

export interface GatePolicy {
  /** any: every new violation fails. serious: only serious and critical. none: warn only. */
  failOn: FailOn;
  /** Let needs-review findings block too. Off by default because they are heuristic. */
  failOnReview: boolean;
  waivers: Waiver[];
}

export interface GateDiff {
  newIssues: IssueGroup[];
  fixedIssues: Omit<IssueGroup, 'screenshot' | 'ariaSnapshot'>[];
  existingIssues: IssueGroup[];
  /** New issues that are excluded from failing by policy or a waiver, with the reason. */
  nonBlocking: { fingerprint: string; reason: string }[];
  /** New issues that fail the gate. */
  blocking: IssueGroup[];
  passed: boolean;
  hasBaseline: boolean;
}
