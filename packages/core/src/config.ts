import type { FailOn, Waiver } from './types';

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

export interface CheckpointA11yConfig {
  /** Base URL of the app under test, e.g. a preview deployment. Can be overridden with CHECKPOINT_A11Y_BASE_URL. */
  baseURL: string;
  /** Globs for flow files. Default: ["a11y/**\/*.flow.{ts,js,mjs}"] */
  flows?: string[];
  viewports?: ViewportConfig[];
  /** Where results, screenshots and the local baseline live. Default ".checkpoint-a11y". */
  outputDir?: string;
  /** Local baseline file, used when no API is configured. Default ".checkpoint-a11y/baseline.json". */
  baselinePath?: string;
  /** Path to CODEOWNERS. Default: first of .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS. */
  codeowners?: string;
  /** Repo root that source paths in data-a11y-src are relative to. Default: the config file's directory. */
  rootDir?: string;
  gate?: {
    failOn?: FailOn;
    failOnReview?: boolean;
    /** Fail the run if a flow throws. Default true. */
    failOnFlowError?: boolean;
  };
  waivers?: Waiver[];
  checks?: {
    axe?: boolean;
    /** Include axe "best-practice" rules. They never map to a WCAG criterion. Default false. */
    bestPractices?: boolean;
    /** Report axe "incomplete" results as needs-review. Default false. */
    axeIncomplete?: boolean;
    keyboard?: boolean;
    /** Maximum Tab presses per checkpoint. Default 150. */
    maxTabs?: number;
    state?: boolean;
    reflow?: boolean;
    wcag22?: boolean;
    screenshots?: boolean;
    /** axe rule ids to disable. */
    disableRules?: string[];
    /** Only scan inside this selector. */
    include?: string;
    /** Never report inside these selectors (e.g. third-party widgets). */
    exclude?: string[];
  };
  /** Help mechanisms for WCAG 3.2.6 Consistent Help, e.g. ['a[href="/help"]', '#chat-launcher']. */
  help?: string[];
  /** Playwright storage state file, for flows that start logged in. */
  storageState?: string;
  /**
   * How the runner gets past the customer's own protection (WAF, bot management, staging auth).
   * Read secrets from environment variables, e.g. headers: { 'x-ca11y-key': process.env.WAF_BYPASS_KEY! }.
   */
  access?: AccessConfig;
  /**
   * Log in once before the flows run. The file's default export receives { page, context, baseURL }.
   * The resulting cookies and storage are reused by every flow.
   */
  auth?: { setup: string };
  /** Cloud API. If set together with CHECKPOINT_A11Y_TOKEN, results are uploaded and the baseline comes from the API. */
  api?: { url: string; project?: string };
  /** Launch options forwarded to Playwright. */
  browser?: { headless?: boolean; channel?: string };
}

export interface AccessConfig {
  /** Sent only to requests whose origin is baseURL's origin or listed in allowedOrigins, never to third parties. */
  headers?: Record<string, string>;
  /** Extra origins that may receive the headers above (e.g. your API on another subdomain). */
  allowedOrigins?: string[];
  /** Replace the browser user agent. */
  userAgent?: string;
  /** Append to the default user agent, e.g. "Checkpoint A11y/1 (+allowlist-id)". Common WAF allow-list pattern. */
  userAgentSuffix?: string;
  /** HTTP basic auth, typical for staging environments. Only sent to baseURL's origin. */
  httpCredentials?: { username: string; password: string };
  proxy?: { server: string; username?: string; password?: string; bypass?: string };
  /** Accept self-signed certificates on internal hosts. */
  ignoreHTTPSErrors?: boolean;
  /**
   * A selector that only exists on the real site (e.g. 'header nav'). If a checkpoint lacks it, the page is
   * treated as blocked. Complements the built-in detection of known bot-protection pages.
   */
  readySelector?: string;
  /** Skip the access preflight check. Default false. */
  skipPreflight?: boolean;
}

export function defineConfig(config: CheckpointA11yConfig): CheckpointA11yConfig {
  return config;
}

export const DEFAULT_VIEWPORTS: ViewportConfig[] = [{ name: 'desktop', width: 1280, height: 800 }];
