import { IMPACT_ORDER, type IssueGroup, type IssueOccurrence, type RootCause, type RunResult } from './types';

export function allOccurrences(run: RunResult): IssueOccurrence[] {
  return run.flows.flatMap((f) => f.checkpoints.flatMap((c) => c.issues));
}

/** Collapses occurrences sharing a fingerprint into one issue with a count. Keeps the worst impact. */
export function groupOccurrences(occurrences: IssueOccurrence[]): IssueGroup[] {
  const map = new Map<string, IssueGroup>();
  for (const o of occurrences) {
    const g = map.get(o.fingerprint);
    if (!g) {
      map.set(o.fingerprint, {
        fingerprint: o.fingerprint,
        rootCauseKey: o.rootCauseKey,
        ruleId: o.ruleId,
        source: o.source,
        kind: o.kind,
        impact: o.impact,
        wcag: o.wcag,
        standards: o.standards,
        help: o.help,
        description: o.description,
        helpUrl: o.helpUrl,
        flow: o.flow,
        checkpoint: o.checkpoint,
        url: o.url,
        selector: o.selector,
        html: o.html,
        attribution: o.attribution,
        occurrences: 1,
        screenshot: o.screenshot,
        ariaSnapshot: o.ariaSnapshot,
      });
      continue;
    }
    g.occurrences++;
    if (IMPACT_ORDER[o.impact] > IMPACT_ORDER[g.impact]) g.impact = o.impact;
    if (o.kind === 'violation') g.kind = 'violation';
    g.screenshot ??= o.screenshot;
    g.ariaSnapshot ??= o.ariaSnapshot;
  }
  return sortIssues([...map.values()]);
}

export function sortIssues<T extends { impact: IssueGroup['impact']; kind: IssueGroup['kind']; ruleId: string }>(
  issues: T[],
): T[] {
  return [...issues].sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'violation' ? -1 : 1) ||
      IMPACT_ORDER[b.impact] - IMPACT_ORDER[a.impact] ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

/** One entry per (rule, component): the view that answers "what do we actually have to fix?" */
export function groupRootCauses(
  groups: Pick<
    IssueGroup,
    'fingerprint' | 'rootCauseKey' | 'ruleId' | 'impact' | 'kind' | 'help' | 'helpUrl' | 'wcag' | 'attribution' | 'selector' | 'flow' | 'checkpoint' | 'occurrences'
  >[],
): RootCause[] {
  const map = new Map<string, RootCause>();
  for (const g of groups) {
    let rc = map.get(g.rootCauseKey);
    if (!rc) {
      rc = {
        key: g.rootCauseKey,
        ruleId: g.ruleId,
        impact: g.impact,
        kind: g.kind,
        help: g.help,
        helpUrl: g.helpUrl,
        wcag: g.wcag,
        attribution: g.attribution,
        selector: g.selector,
        fingerprints: [],
        locations: [],
        occurrences: 0,
      };
      map.set(g.rootCauseKey, rc);
    }
    rc.fingerprints.push(g.fingerprint);
    rc.locations.push({ flow: g.flow, checkpoint: g.checkpoint });
    rc.occurrences += g.occurrences;
    if (IMPACT_ORDER[g.impact] > IMPACT_ORDER[rc.impact]) rc.impact = g.impact;
    if (g.kind === 'violation') rc.kind = 'violation';
  }
  return sortIssues([...map.values()]).sort((a, b) => b.occurrences - a.occurrences || 0);
}
