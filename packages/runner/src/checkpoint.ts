import fs from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import {
  applicability,
  criteriaFromAxeTags,
  fingerprint,
  normalizeSelector,
  ownersFor,
  rootCauseKey,
  type CheckpointResult,
  type Impact,
  type IssueKind,
  type IssueOccurrence,
  type RuleSource,
} from '@checkpoint-a11y/core';
import type { Page } from 'playwright';
import { blockedMessage, detectBlockPage } from './access';
import { installBrowserLib, type DescribedElement, type KbStep } from './browser';
import type { ResolvedConfig, RunState } from './config';
import { RULES, type RuleMeta } from './rules';

/** A finding before it is turned into a fingerprinted occurrence. */
interface RawFinding {
  ruleId: string;
  source: RuleSource;
  kind: IssueKind;
  impact: Impact;
  wcag: string[];
  help: string;
  helpUrl?: string;
  description: string;
  target: DescribedElement;
}

export type CheckName = 'axe' | 'keyboard' | 'state' | 'reflow' | 'wcag22';

export interface CheckpointOptions {
  /** Skip specific checks at this checkpoint, e.g. reflow on a page with a deliberate data grid. */
  skip?: CheckName[];
  /** Restrict the axe scan to this selector. */
  include?: string;
  /** Extra selectors to ignore at this checkpoint. */
  exclude?: string[];
}

export interface A11yOptions {
  page: Page;
  flow: string;
  viewport: { name: string; width: number; height: number };
  /** Append the viewport name to checkpoint names, needed when a flow runs at several viewports. */
  qualifyByViewport: boolean;
  config: ResolvedConfig;
  state: RunState;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'x';

function fromRule(rule: RuleMeta, target: DescribedElement, description: string): RawFinding {
  return { ruleId: rule.id, source: rule.source, kind: rule.kind, impact: rule.impact, wcag: rule.wcag, help: rule.help, helpUrl: rule.helpUrl, description, target };
}

/**
 * The `a11y` object passed to every flow. Call `checkpoint(name)` at each state worth testing.
 */
export class A11y {
  readonly checkpoints: CheckpointResult[] = [];
  private readonly filled = new Map<string, { checkpoint: string; url: string }>();

  constructor(private readonly opts: A11yOptions) {}

  get flowName(): string {
    return this.opts.flow;
  }

  async checkpoint(name: string, options: CheckpointOptions = {}): Promise<CheckpointResult> {
    const { page, config } = this.opts;
    const checkpointName = this.opts.qualifyByViewport ? `${name} @${this.opts.viewport.name}` : name;
    if (this.checkpoints.some((c) => c.name === checkpointName)) {
      throw new Error(`Duplicate checkpoint "${name}" in flow "${this.opts.flow}". Checkpoint names are part of the fingerprint and must be unique per flow.`);
    }
    const started = Date.now();
    const skip = new Set<CheckName>(options.skip ?? []);
    const checks = config.checks;
    const skipped: { check: string; reason: string }[] = [];
    const findings: RawFinding[] = [];

    await this.settle();
    // Bot protection often kicks in a few pages into a flow. Never scan a challenge page as if it were the app.
    const blocked = await page.evaluate(detectBlockPage, config.access?.readySelector).catch(() => null);
    if (blocked) throw new Error(`Checkpoint "${name}" blocked: ${blockedMessage(page.url(), blocked)}`);
    await page.evaluate(installBrowserLib);
    const exclude = [...(checks.exclude ?? []), ...(options.exclude ?? []), '[data-ca11y-highlight]'];
    await page.evaluate((sel) => window.__checkpointA11y!.setExclude(sel), exclude);

    const baseName = `${slug(this.opts.flow)}--${slug(checkpointName)}`;
    let screenshot: string | undefined;
    if (checks.screenshots) {
      screenshot = `artifacts/${baseName}.jpg`;
      await page.screenshot({ path: path.join(config.resultsDir, screenshot), type: 'jpeg', quality: 70 }).catch(() => (screenshot = undefined));
    }

    const run = async (check: CheckName, enabled: boolean, fn: () => Promise<unknown>) => {
      if (!enabled || skip.has(check)) return;
      try {
        await fn();
      } catch (err) {
        skipped.push({ check, reason: `failed: ${(err as Error).message.split('\n')[0]}` });
      }
    };

    // Order matters: state checks read the current focus before the keyboard pass moves it,
    // and reflow resizes the viewport so it runs last.
    await run('axe', checks.axe, async () => findings.push(...(await this.axe(options, exclude))));
    await run('state', checks.state, async () => findings.push(...(await this.stateChecks())));
    await run('wcag22', checks.wcag22, async () => findings.push(...(await this.wcag22Checks(checkpointName))));
    await run('keyboard', checks.keyboard, async () => {
      const kb = await this.keyboardPass();
      findings.push(...kb.findings);
      if (kb.truncated) skipped.push({ check: 'keyboard-reachability', reason: `stopped after ${checks.maxTabs} Tab presses` });
    });

    const url = page.url();
    const occurrences = findings.filter((f) => !f.target.excluded).map((f) => this.toOccurrence(f, checkpointName, url));

    if (checks.screenshots) await this.captureEvidence(occurrences, baseName);

    await run('reflow', checks.reflow, async () => {
      const reflow = await this.reflow();
      occurrences.push(...reflow.filter((f) => !f.target.excluded).map((f) => this.toOccurrence(f, checkpointName, url)));
    });

    const result: CheckpointResult = {
      flow: this.opts.flow,
      name: checkpointName,
      url,
      viewport: this.opts.viewport,
      durationMs: Date.now() - started,
      screenshot,
      issues: occurrences,
      skipped: skipped.length ? skipped : undefined,
    };
    this.checkpoints.push(result);
    return result;
  }

  private async settle(): Promise<void> {
    const { page } = this.opts;
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);
    await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(() => undefined)).catch(() => undefined);
  }

  private async axe(options: CheckpointOptions, exclude: string[]): Promise<RawFinding[]> {
    const { page, config } = this.opts;
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
    if (config.checks.bestPractices) tags.push('best-practice');
    let builder = new AxeBuilder({ page }).withTags(tags);
    const include = options.include ?? config.checks.include;
    if (include) builder = builder.include(include);
    for (const sel of exclude) builder = builder.exclude(sel);
    if (config.checks.disableRules?.length) builder = builder.disableRules(config.checks.disableRules);
    const res = await builder.analyze();

    const groups: { list: typeof res.violations; kind: IssueKind }[] = [{ list: res.violations, kind: 'violation' }];
    if (config.checks.axeIncomplete) groups.push({ list: res.incomplete, kind: 'needs-review' });

    const pending: { rule: (typeof res.violations)[number]; node: (typeof res.violations)[number]['nodes'][number]; kind: IssueKind; selector: string }[] = [];
    for (const { list, kind } of groups) {
      for (const rule of list) {
        for (const node of rule.nodes) {
          const t = node.target as unknown as (string | string[])[];
          const selector = t.length === 1 && typeof t[0] === 'string' ? t[0] : t.flat().join(' >>> ');
          pending.push({ rule, node, kind, selector });
        }
      }
    }
    const described = await page.evaluate((sels) => window.__checkpointA11y!.inspect(sels), pending.map((p) => p.selector));

    return pending.map(({ rule, node, kind, selector }, i) => {
      const wcag = criteriaFromAxeTags(rule.tags);
      const d = described[i];
      return {
        ruleId: rule.id,
        source: 'axe' as const,
        kind,
        impact: ((node.impact ?? rule.impact) as Impact) ?? 'moderate',
        wcag,
        help: rule.help,
        helpUrl: rule.helpUrl,
        description: node.failureSummary ?? rule.description,
        target: d ?? { selector, html: node.html, attribution: { method: 'selector' as const }, excluded: false },
      };
    });
  }

  private async stateChecks(): Promise<RawFinding[]> {
    const { page } = this.opts;
    const [dialogs, errors] = await Promise.all([
      page.evaluate(() => window.__checkpointA11y!.dialogChecks()),
      page.evaluate(() => window.__checkpointA11y!.formErrorChecks()),
    ]);
    const out: RawFinding[] = [];
    for (const d of dialogs) {
      if (d.rule === 'dialog-focus-not-moved') {
        out.push(fromRule(RULES.dialogFocusNotMoved, d.target, 'A dialog is open but keyboard focus is outside it. Move focus to the dialog or its first control when it opens.'));
      } else {
        out.push(fromRule(RULES.dialogNotModal, d.target, 'role="dialog" without aria-modal="true". If the dialog blocks the page, mark it modal and make the background inert.'));
      }
    }
    for (const e of errors) {
      if (e.rule === 'error-not-associated') {
        out.push(fromRule(RULES.errorNotAssociated, e.target, `Field${e.detail ? ` "${e.detail}"` : ''} has aria-invalid="true" but no aria-describedby or aria-errormessage pointing at visible error text.`));
      } else {
        out.push(fromRule(RULES.errorTextNotLinked, e.target, `Error text "${e.detail}" is next to this field but not referenced by aria-describedby or aria-errormessage.`));
      }
    }
    return out;
  }

  private async wcag22Checks(checkpointName: string): Promise<RawFinding[]> {
    const { page, config, state } = this.opts;
    const out: RawFinding[] = [];
    const [auth, drag, fields] = await Promise.all([
      page.evaluate(() => window.__checkpointA11y!.authChecks()),
      page.evaluate(() => window.__checkpointA11y!.dragChecks()),
      page.evaluate(() => window.__checkpointA11y!.filledFields()),
    ]);

    for (const a of auth) {
      if (a.rule === 'auth-paste-blocked') out.push(fromRule(RULES.authPasteBlocked, a.target, 'A paste event on this password field was cancelled. Users of password managers and copy-paste cannot log in without memorising the password.'));
      else if (a.rule === 'auth-captcha') out.push(fromRule(RULES.authCaptcha, a.target, 'A CAPTCHA was detected. WCAG 3.3.8 requires an alternative that does not rely on a cognitive function test, unless it is object or personal-content recognition.'));
      else out.push(fromRule(RULES.authAutocomplete, a.target, `autocomplete is ${a.detail}. Use "username"/"email" and "current-password" or "new-password".`));
    }
    for (const d of drag) {
      out.push(fromRule(RULES.dragging, d.target, 'This element can be dragged. Confirm the same result can be achieved with single clicks or taps (for example move up/down buttons).'));
    }

    // 3.3.7 Redundant Entry: fields asked again, empty, after being filled at an earlier checkpoint on another URL.
    const url = page.url();
    for (const f of fields) {
      const prev = this.filled.get(f.key);
      if (!f.filled && prev && prev.url !== url) {
        out.push(fromRule(RULES.redundantEntry, f.target, `"${f.label}" was already entered at checkpoint "${prev.checkpoint}" and is asked for again without being pre-filled or offered for selection.`));
      }
    }
    for (const f of fields) if (f.filled && !this.filled.has(f.key)) this.filled.set(f.key, { checkpoint: checkpointName, url });

    // 3.2.6 Consistent Help: relative order of configured help mechanisms across all checkpoints in the run.
    if (config.help?.length) {
      const order = await page.evaluate((sels) => window.__checkpointA11y!.helpOrder(sels), config.help);
      const idxs = order.map((o) => o.index);
      for (const prev of state.helpOrders) {
        const mine = idxs.filter((i) => prev.order.includes(i));
        const theirs = prev.order.filter((i) => idxs.includes(i));
        const at = mine.findIndex((v, i) => v !== theirs[i]);
        if (at >= 0) {
          const target = order.find((o) => o.index === mine[at])!.target;
          out.push(fromRule(RULES.consistentHelp, target, `Help mechanisms ${mine.map((i) => config.help![i]).join(', ')} appear in a different order than at "${prev.flow} → ${prev.checkpoint}".`));
          break;
        }
      }
      if (idxs.length) state.helpOrders.push({ order: idxs, flow: this.opts.flow, checkpoint: checkpointName });
    }
    return out;
  }

  private async keyboardPass(): Promise<{ findings: RawFinding[]; truncated: boolean }> {
    const { page, config } = this.opts;
    const start = await page.evaluate(() => window.__checkpointA11y!.kbStart());
    const steps: KbStep[] = [];
    let truncated = true;
    let bodyVisits = 0;
    let stuck = 0;
    let lastIdx = -1;
    let trapped = false;

    for (let i = 0; i < config.checks.maxTabs; i++) {
      await page.keyboard.press('Tab');
      const s = await page.evaluate(() => window.__checkpointA11y!.kbStep());
      if (s.kind === 'body') {
        // Focus passes through the document between the last and first element. Keep going so elements
        // above the starting point (the last clicked control) are visited too; a second pass means done.
        if (++bodyVisits >= 2) {
          truncated = false;
          break;
        }
        continue;
      }
      if (s.idx === lastIdx) {
        // Focus did not move. Inside a modal with a single control that is correct behaviour.
        if (++stuck >= 2) {
          trapped = !start.modalOpen;
          truncated = false;
          break;
        }
        continue;
      }
      stuck = 0;
      if (!s.target) {
        // Revisiting an element: the Tab cycle is complete.
        // A natural wrap comes back to where the walk started. Looping back to a later element means
        // focus is stuck in a cycle that skips the rest of the page.
        const loopsMidway = s.idx !== steps[0]?.idx;
        const coversTooLittle = bodyVisits === 0 && steps.length < Math.max(2, Math.floor(start.candidates * 0.5));
        if (!start.modalOpen && (loopsMidway || coversTooLittle)) trapped = true;
        truncated = false;
        break;
      }
      lastIdx = s.idx!;
      steps.push(s);
    }

    const finish = await page.evaluate((t) => window.__checkpointA11y!.kbFinish(t), truncated);
    const out: RawFinding[] = [];

    if (trapped && steps.length) {
      const last = steps[steps.length - 1]!;
      out.push(fromRule(RULES.focusTrap, last.target!, `Tab cycles between ${steps.length} element(s) and never leaves them, while no modal dialog is open.`));
    }

    let escapeReported = false;
    let orderReports = 0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      if (s.focusVisible === false) {
        out.push(fromRule(RULES.focusNotVisible, s.target!, 'No change in outline, box-shadow, border, background, colour or underline was detected when this element received keyboard focus.'));
      }
      if (s.obscuredBy) {
        out.push(fromRule(RULES.focusObscured, s.target!, `When focused, this element is fully covered by ${s.obscuredBy.attribution.component ? `<${s.obscuredBy.attribution.component}>` : s.obscuredBy.selector}. Add scroll-padding or move the sticky content.`));
      }
      if (start.modalOpen && s.inModal === false && !escapeReported) {
        escapeReported = true;
        out.push(fromRule(RULES.dialogFocusEscapes, s.modal ?? s.target!, `Pressing Tab moved focus out of the open modal dialog to ${s.target!.selector}.`));
      }
      const prev = steps[i - 1];
      if (prev && !prev.fixed && !s.fixed && prev.docTop !== undefined && s.docTop !== undefined && s.docTop < prev.docTop - 150 && s.left !== undefined && prev.left !== undefined && s.left <= prev.left + 20 && orderReports < 3) {
        // Moving up and to the right is a new column, which is natural. Up and to the left goes backwards.
        orderReports++;
        out.push(fromRule(RULES.tabOrder, s.target!, `Focus moved from ${prev.target!.selector} up by ${Math.round(prev.docTop - s.docTop)}px to this element. Check that the order matches the visual reading order.`));
      }
    }

    for (const u of finish) {
      const rule = u.reason === 'cursor-pointer' ? RULES.unreachableReview : RULES.unreachable;
      const why = {
        'react-handler': 'It has a click handler but is not focusable. Use a <button> or <a href>, or add tabindex="0", a role and key handlers.',
        role: 'It has an interactive role but is not focusable. Add tabindex="0".',
        'native-negative-tabindex': 'It is a native control with tabindex="-1", so Tab skips it.',
        'cursor-pointer': 'It shows a pointer cursor but is not focusable. If it is clickable, make it a real control.',
      }[u.reason];
      out.push(fromRule(rule, u.target, why));
    }
    return { findings: out, truncated };
  }

  private async reflow(): Promise<RawFinding[]> {
    const { page } = this.opts;
    const vp = page.viewportSize();
    if (!vp) return [];
    if (vp.width <= 320) {
      return this.reflowAtCurrentSize();
    }
    await page.setViewportSize({ width: 320, height: vp.height });
    try {
      await page.waitForTimeout(250);
      return await this.reflowAtCurrentSize();
    } finally {
      await page.setViewportSize(vp);
      await page.waitForTimeout(100);
    }
  }

  private async reflowAtCurrentSize(): Promise<RawFinding[]> {
    const { page } = this.opts;
    const r = await page.evaluate(() => window.__checkpointA11y!.reflowCheck());
    if (!r.overflow) return [];
    const targets = r.offenders.length ? r.offenders : (await page.evaluate(() => window.__checkpointA11y!.inspect(['body']))).filter((x): x is DescribedElement => !!x);
    return targets.map((t) => fromRule(RULES.reflow, t, `At 320 CSS px the page scrolls horizontally by ${r.overflow}px; this element extends past the viewport.`));
  }

  private toOccurrence(f: RawFinding, checkpoint: string, url: string): IssueOccurrence {
    const normalizedSelector = normalizeSelector(f.target.selector);
    const a = f.target.attribution;
    const component = a.component;
    const owners = a.sourcePath && this.opts.state.codeowners.length ? ownersFor(this.opts.state.codeowners, a.sourcePath) : undefined;
    return {
      fingerprint: fingerprint({ ruleId: f.ruleId, component, normalizedSelector, flow: this.opts.flow, checkpoint }),
      rootCauseKey: rootCauseKey({ ruleId: f.ruleId, component, normalizedSelector }),
      ruleId: f.ruleId,
      source: f.source,
      kind: f.kind,
      impact: f.impact,
      wcag: f.wcag,
      standards: applicability(f.wcag),
      help: f.help,
      description: f.description,
      helpUrl: f.helpUrl,
      flow: this.opts.flow,
      checkpoint,
      url,
      selector: f.target.selector,
      normalizedSelector,
      html: f.target.html,
      attribution: { ...a, owners: owners?.length ? owners : undefined },
    };
  }

  /** One highlighted element screenshot and aria snapshot per fingerprint. */
  private async captureEvidence(occurrences: IssueOccurrence[], baseName: string): Promise<void> {
    const { page, config } = this.opts;
    const vp = page.viewportSize() ?? { width: 1280, height: 800 };
    const done = new Map<string, { screenshot?: string; aria?: string }>();
    for (const o of occurrences) {
      const prior = done.get(o.fingerprint);
      if (prior) {
        o.screenshot = prior.screenshot;
        o.ariaSnapshot = prior.aria;
        continue;
      }
      if (done.size >= config.checks.maxScreenshots) continue;
      const entry: { screenshot?: string; aria?: string } = {};
      done.set(o.fingerprint, entry);
      if (o.selector.includes('>>>')) continue;
      try {
        const box = await page.evaluate((sel) => window.__checkpointA11y!.highlight(sel), o.selector);
        if (box) {
          const x = Math.max(0, Math.floor(box.x - 60));
          const y = Math.max(0, Math.floor(box.y - 60));
          const width = Math.max(1, Math.min(vp.width - x, Math.ceil(box.width + 120)));
          const height = Math.max(1, Math.min(vp.height - y, Math.ceil(box.height + 120)));
          const rel = `artifacts/${baseName}--${o.fingerprint}.jpg`;
          await page.screenshot({ path: path.join(config.resultsDir, rel), type: 'jpeg', quality: 70, clip: { x, y, width, height } });
          entry.screenshot = rel;
        }
      } catch {
        /* evidence is best effort */
      } finally {
        await page.evaluate(() => window.__checkpointA11y!.unhighlight()).catch(() => undefined);
      }
      try {
        const snap = await page.locator(o.selector).first().ariaSnapshot({ timeout: 1000 });
        entry.aria = snap.length > 2000 ? snap.slice(0, 2000) + '\n…' : snap;
      } catch {
        /* element may be gone or not addressable */
      }
      o.screenshot = entry.screenshot;
      o.ariaSnapshot = entry.aria;
    }
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
