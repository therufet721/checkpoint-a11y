import { describe, expect, it } from 'vitest';
import { baselineFromRun, diffAgainstBaseline, nextBaseline } from '../src/diff';
import { fingerprint, rootCauseKey } from '../src/fingerprint';
import { groupOccurrences, groupRootCauses } from '../src/group';
import type { IssueOccurrence, RunResult } from '../src/types';

function occ(p: Partial<IssueOccurrence> & { ruleId: string; flow?: string; checkpoint?: string; component?: string }): IssueOccurrence {
  const flow = p.flow ?? 'checkout';
  const checkpoint = p.checkpoint ?? 'cart';
  const normalizedSelector = p.normalizedSelector ?? 'button';
  const component = p.component;
  return {
    fingerprint: fingerprint({ ruleId: p.ruleId, component, normalizedSelector, flow, checkpoint }),
    rootCauseKey: rootCauseKey({ ruleId: p.ruleId, component, normalizedSelector }),
    ruleId: p.ruleId,
    source: 'axe',
    kind: p.kind ?? 'violation',
    impact: p.impact ?? 'serious',
    wcag: ['4.1.2'],
    standards: { wcag21: true, wcag22: true },
    help: 'Buttons must have discernible text',
    description: '',
    flow,
    checkpoint,
    url: 'http://x',
    selector: p.selector ?? 'button',
    normalizedSelector,
    html: '<button></button>',
    attribution: component ? { method: 'build-plugin', component } : { method: 'selector' },
  };
}

function run(issues: IssueOccurrence[]): RunResult {
  return {
    schemaVersion: 1,
    tool: { name: 'checkpoint-a11y', version: 't' },
    ruleset: { version: 't', axeVersion: 't', standard: 'WCAG 2.2 AA', reportedAgainst: [] },
    startedAt: '',
    finishedAt: '',
    git: {},
    flows: [{ name: 'checkout', status: 'passed', durationMs: 0, checkpoints: [{ flow: 'checkout', name: 'cart', url: '', viewport: { name: 'd', width: 1, height: 1 }, durationMs: 0, issues }] }],
  };
}

describe('fingerprint', () => {
  it('is the same for the same component regardless of selector', () => {
    const a = occ({ ruleId: 'button-name', component: 'IconButton', normalizedSelector: 'header button' });
    const b = occ({ ruleId: 'button-name', component: 'IconButton', normalizedSelector: 'footer button' });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
  it('differs per checkpoint but shares a root cause key', () => {
    const a = occ({ ruleId: 'button-name', component: 'IconButton', checkpoint: 'product' });
    const b = occ({ ruleId: 'button-name', component: 'IconButton', checkpoint: 'cart' });
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.rootCauseKey).toBe(b.rootCauseKey);
  });
});

describe('grouping', () => {
  it('collapses occurrences into one group with a count', () => {
    const groups = groupOccurrences([occ({ ruleId: 'button-name', component: 'X' }), occ({ ruleId: 'button-name', component: 'X' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.occurrences).toBe(2);
  });
  it('builds one root cause across checkpoints', () => {
    const groups = groupOccurrences([
      occ({ ruleId: 'button-name', component: 'X', checkpoint: 'a' }),
      occ({ ruleId: 'button-name', component: 'X', checkpoint: 'b' }),
      occ({ ruleId: 'color-contrast', component: 'Y' }),
    ]);
    const rcs = groupRootCauses(groups);
    expect(rcs).toHaveLength(2);
    expect(rcs.find((r) => r.ruleId === 'button-name')!.locations).toHaveLength(2);
  });
});

describe('diffAgainstBaseline', () => {
  const existing = occ({ ruleId: 'color-contrast', component: 'Price' });
  const fixed = occ({ ruleId: 'image-alt', component: 'Logo' });
  const added = occ({ ruleId: 'button-name', component: 'IconButton' });
  const baseline = baselineFromRun(run([existing, fixed]));

  it('classifies new, fixed and existing', () => {
    const d = diffAgainstBaseline(groupOccurrences([existing, added]), baseline);
    expect(d.newIssues.map((i) => i.ruleId)).toEqual(['button-name']);
    expect(d.fixedIssues.map((i) => i.ruleId)).toEqual(['image-alt']);
    expect(d.existingIssues.map((i) => i.ruleId)).toEqual(['color-contrast']);
    expect(d.passed).toBe(false);
  });
  it('never fails on existing issues', () => {
    expect(diffAgainstBaseline(groupOccurrences([existing]), baseline).passed).toBe(true);
  });
  it('passes without a baseline', () => {
    const d = diffAgainstBaseline(groupOccurrences([added]), null);
    expect(d.passed).toBe(true);
    expect(d.newIssues).toHaveLength(1);
  });
  it('respects the serious threshold', () => {
    const moderate = occ({ ruleId: 'region', impact: 'moderate', component: 'Main' });
    const d = diffAgainstBaseline(groupOccurrences([moderate]), baseline, { failOn: 'serious', failOnReview: false, waivers: [] });
    expect(d.passed).toBe(true);
    expect(d.nonBlocking[0]!.reason).toMatch(/below the serious/);
  });
  it('does not block on needs-review by default', () => {
    const r = occ({ ruleId: 'ca11y-tab-order', kind: 'needs-review', component: 'Nav' });
    expect(diffAgainstBaseline(groupOccurrences([r]), baseline).passed).toBe(true);
  });
  it('honours unexpired waivers and ignores expired ones', () => {
    const policy = (expires: string) => ({
      failOn: 'any' as const,
      failOnReview: false,
      waivers: [{ match: added.rootCauseKey, reason: 'vendor fix due', expires }],
    });
    const now = new Date('2026-11-09');
    expect(diffAgainstBaseline(groupOccurrences([added]), baseline, { policy: policy('2026-12-01'), now }).passed).toBe(true);
    expect(diffAgainstBaseline(groupOccurrences([added]), baseline, { policy: policy('2026-11-01'), now }).passed).toBe(false);
  });
  it('does not report issues at checkpoints that did not run as fixed', () => {
    const d = diffAgainstBaseline([], baseline, { executed: new Set(['other\u001fcheckpoint']) });
    expect(d.fixedIssues).toHaveLength(0);
    const d2 = diffAgainstBaseline([], baseline, { executed: new Set(['checkout\u001fcart']) });
    expect(d2.fixedIssues).toHaveLength(2);
  });
});

describe('nextBaseline', () => {
  it('carries over issues from checkpoints that did not run', () => {
    const a = occ({ ruleId: 'image-alt', component: 'Logo', flow: 'login', checkpoint: 'form' });
    const prev = baselineFromRun({ ...run([]), flows: [{ name: 'login', status: 'passed', durationMs: 0, checkpoints: [{ flow: 'login', name: 'form', url: '', viewport: { name: 'd', width: 1, height: 1 }, durationMs: 0, issues: [a] }] }] });
    const b = occ({ ruleId: 'button-name', component: 'X' });
    const next = nextBaseline(prev, run([b]));
    expect(next.issues.map((i) => i.ruleId).sort()).toEqual(['button-name', 'image-alt']);
  });
});
