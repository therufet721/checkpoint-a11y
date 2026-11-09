import { groupRootCauses } from './group';
import { CRITERIA, STANDARDS_NOTE, criterionLabel } from './standards';
import { IMPACT_ORDER, type Impact, type IssueGroup, type RulesetInfo, type Waiver } from './types';

export interface EvidenceRunSummary {
  at: string;
  commit?: string;
  branch?: string;
  open: number;
  newIssues?: number;
  fixed?: number;
  passed?: boolean;
}

export interface EvidenceInput {
  organization: string;
  project: string;
  generatedAt: string;
  period?: { from: string; to: string };
  ruleset: RulesetInfo;
  flows: { name: string; checkpoints: string[] }[];
  viewports: string[];
  openIssues: IssueGroup[];
  runs: EvidenceRunSummary[];
  fixedInPeriod: number;
  medianDaysToFix?: number;
  waivers: Waiver[];
  statement?: { organizationName: string; contactEmail?: string; serviceName?: string };
}

const esc = (s: string | number | undefined): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

/**
 * The evidence pack: a dated record of scope, results and process.
 * It is deliberately not phrased as a certificate. See the limitations section it renders.
 */
export function renderEvidenceHtml(input: EvidenceInput): string {
  const violations = input.openIssues.filter((i) => i.kind === 'violation');
  const review = input.openIssues.filter((i) => i.kind === 'needs-review');
  const bySeverity = countBy(violations, (i) => i.impact);
  const byCriterion = countBy(
    violations.flatMap((i) => (i.wcag.length ? i.wcag : ['best-practice'])),
    (c) => c,
  );
  const rootCauses = groupRootCauses(violations);
  const checked = input.runs.length;
  const passedRuns = input.runs.filter((r) => r.passed).length;
  const only21 = violations.filter((i) => i.standards.wcag21 && !i.standards.wcag22).length;
  const only22 = violations.filter((i) => i.standards.wcag22 && !i.standards.wcag21).length;
  const sevs: Impact[] = ['critical', 'serious', 'moderate', 'minor'];

  const st = input.statement;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Accessibility evidence: ${esc(input.project)}</title>
<style>
  body { font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; background: #fff; max-width: 860px; margin: 32px auto; padding: 0 16px; }
  h1 { font-size: 26px; margin-bottom: 4px; } h2 { font-size: 19px; margin-top: 32px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { background: #f3f3f3; } code { font: 13px ui-monospace, Menlo, monospace; background: #f3f3f3; padding: 1px 4px; border-radius: 3px; word-break: break-all; }
  .muted { color: #555; } .note { background: #fff6e0; border-left: 4px solid #a66b00; padding: 8px 12px; }
  .statement { border: 1px dashed #888; padding: 12px 16px; }
</style>
</head>
<body>
<header>
  <h1>Accessibility evidence pack</h1>
  <p class="muted">${esc(input.organization)} · ${esc(input.project)} · generated ${esc(input.generatedAt.slice(0, 10))}${input.period ? ` · period ${esc(input.period.from.slice(0, 10))} to ${esc(input.period.to.slice(0, 10))}` : ''}</p>
</header>
<main>
<p class="note">This document records the automated accessibility testing process and its results. It is not a certificate of conformance and not legal advice. ${esc(STANDARDS_NOTE)}</p>

<h2>1. Scope</h2>
<p>Standard: <strong>${esc(input.ruleset.standard)}</strong>, also reported against ${esc(input.ruleset.reportedAgainst.join(', '))}. Rule set version <code>${esc(input.ruleset.version)}</code>, axe-core <code>${esc(input.ruleset.axeVersion)}</code>. Viewports: ${esc(input.viewports.join(', ') || 'desktop')}.</p>
<table><thead><tr><th scope="col">User flow</th><th scope="col">Checkpoints tested</th></tr></thead><tbody>
${input.flows.map((f) => `<tr><td>${esc(f.name)}</td><td>${f.checkpoints.map(esc).join('<br>')}</td></tr>`).join('\n') || '<tr><td colspan="2">No flows recorded.</td></tr>'}
</tbody></table>
<p>At every checkpoint: axe-core rules for WCAG 2.0, 2.1 and 2.2 A/AA; a keyboard pass (reachability, visible focus, traps, focus not obscured); dialog and form-error state checks; reflow at 320 CSS px; and flow-level checks for WCAG 2.2 criteria 3.3.7, 3.3.8, 3.2.6 and 2.5.7.</p>

<h2>2. Process</h2>
<p>${checked} recorded run${checked === 1 ? '' : 's'} in this period${checked ? `, of which ${passedRuns} passed the "no new issues" gate` : ''}. Pull requests are checked automatically and fail when they introduce new blocking issues.</p>
${
  input.runs.length
    ? `<table><thead><tr><th scope="col">Date</th><th scope="col">Branch</th><th scope="col">Commit</th><th scope="col">Open</th><th scope="col">New</th><th scope="col">Fixed</th><th scope="col">Gate</th></tr></thead><tbody>
${input.runs
  .slice(0, 40)
  .map(
    (r) =>
      `<tr><td>${esc(r.at.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.branch)}</td><td><code>${esc(r.commit?.slice(0, 7))}</code></td><td>${r.open}</td><td>${esc(r.newIssues)}</td><td>${esc(r.fixed)}</td><td>${r.passed === undefined ? '' : r.passed ? 'passed' : 'failed'}</td></tr>`,
  )
  .join('\n')}
</tbody></table>`
    : ''
}

<h2>3. Current results</h2>
<p>${violations.length} open violation${violations.length === 1 ? '' : 's'} from ${rootCauses.length} root cause${rootCauses.length === 1 ? '' : 's'}, and ${review.length} finding${review.length === 1 ? '' : 's'} awaiting manual review. ${input.fixedInPeriod} issue${input.fixedInPeriod === 1 ? '' : 's'} fixed in the period${input.medianDaysToFix !== undefined ? `, median time to fix ${input.medianDaysToFix.toFixed(1)} days` : ''}.</p>
<p>Gap between standards: ${only22} open violation${only22 === 1 ? '' : 's'} apply only under WCAG 2.2, ${only21} only under WCAG 2.1.</p>
<table><thead><tr><th scope="col">Severity</th><th scope="col">Open violations</th></tr></thead><tbody>
${sevs.map((s) => `<tr><td>${s}</td><td>${bySeverity[s] ?? 0}</td></tr>`).join('\n')}
</tbody></table>
<table><thead><tr><th scope="col">WCAG criterion</th><th scope="col">Open violations</th></tr></thead><tbody>
${
  Object.entries(byCriterion)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<tr><td>${esc(c === 'best-practice' ? 'Best practice (no criterion)' : criterionLabel(c))}</td><td>${n}</td></tr>`)
    .join('\n') || '<tr><td colspan="2">None.</td></tr>'
}
</tbody></table>
<h3>Top root causes</h3>
<table><thead><tr><th scope="col">Issue</th><th scope="col">Component</th><th scope="col">Occurrences</th></tr></thead><tbody>
${
  rootCauses
    .slice(0, 15)
    .sort((a, b) => IMPACT_ORDER[b.impact] - IMPACT_ORDER[a.impact] || b.occurrences - a.occurrences)
    .map(
      (rc) =>
        `<tr><td>[${rc.impact}] ${esc(rc.help)}<br><span class="muted">${esc(rc.wcag.map((c) => `${c} ${CRITERIA[c]?.name ?? ''}`).join(', '))}</span></td><td>${rc.attribution.component ? `<code>${esc(rc.attribution.component)}</code><br><span class="muted">${esc(rc.attribution.sourcePath)}</span>` : `<code>${esc(rc.selector)}</code>`}</td><td>${rc.occurrences}</td></tr>`,
    )
    .join('\n') || '<tr><td colspan="3">None.</td></tr>'
}
</tbody></table>

<h2>4. Known limitations and waivers</h2>
<ul>
  <li>Automated checks detect only part of WCAG failures. Judgment criteria (accuracy of text alternatives, meaningful link text, logical reading order, helpfulness of error messages, screen reader output) require manual review.</li>
  <li>Only the flows and checkpoints listed in section 1 are tested. Content outside them is not covered.</li>
  <li>Findings marked "needs review" come from heuristic checks and are not counted as violations until confirmed.</li>
  <li>EN 301 549 requirements outside WCAG (for example clauses 5, 6 and 11.7 user preferences) are not tested.</li>
</ul>
${
  input.waivers.length
    ? `<table><thead><tr><th scope="col">Waived issue</th><th scope="col">Reason</th><th scope="col">By</th><th scope="col">Expires</th></tr></thead><tbody>
${input.waivers.map((w) => `<tr><td><code>${esc(w.match)}</code></td><td>${esc(w.reason)}</td><td>${esc(w.author)}</td><td>${esc(w.expires.slice(0, 10))}</td></tr>`).join('\n')}
</tbody></table>`
    : '<p>No active waivers.</p>'
}

<h2>5. Draft accessibility statement</h2>
<p class="muted">A starting point only. Adapt it to your organization and to the requirements of the relevant member state, and have it reviewed by counsel.</p>
<div class="statement">
<p><strong>Accessibility statement for ${esc(st?.serviceName ?? input.project)}</strong></p>
<p>${esc(st?.organizationName ?? input.organization)} is committed to making ${esc(st?.serviceName ?? input.project)} accessible in accordance with the European Accessibility Act and the applicable national law.</p>
<p><strong>Compliance status.</strong> This service is partially compliant with EN 301 549 and WCAG 2.2 Level AA because of the non-compliances listed below.</p>
<p><strong>Non-accessible content.</strong> ${
    rootCauses.length
      ? `<br>${rootCauses
          .slice(0, 10)
          .map((rc) => `• ${esc(rc.help)} (${esc(rc.wcag.join(', ') || 'best practice')})`)
          .join('<br>')}`
      : 'No known violations at the time of writing.'
  }</p>
<p><strong>How this statement was prepared.</strong> Automated testing of key user journeys on every code change, dated ${esc(input.generatedAt.slice(0, 10))}, [complemented by a manual review on DATE by REVIEWER].</p>
<p><strong>Feedback and contact.</strong> If you find an accessibility barrier, contact us at ${esc(st?.contactEmail ?? '[CONTACT EMAIL]')}. We aim to respond within [N] working days.</p>
<p><strong>Enforcement.</strong> [Name and contact details of the national enforcement or complaints body.]</p>
</div>
</main>
</body>
</html>`;
}
