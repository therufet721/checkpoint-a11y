import { criterionLabel } from './standards';
import type { GateDiff, IssueGroup } from './types';

export const COMMENT_MARKER = '<!-- checkpoint-a11y:pr-comment -->';

const IMPACT_ICON: Record<string, string> = { critical: '🔴', serious: '🟠', moderate: '🟡', minor: '⚪' };

function escapeMd(s: string): string {
  return s.replace(/[|<>]/g, (c) => ({ '|': '\\|', '<': '&lt;', '>': '&gt;' })[c]!);
}

function where(i: Pick<IssueGroup, 'attribution' | 'selector'>): string {
  const a = i.attribution;
  if (a.component) {
    const src = a.sourcePath ? ` in \`${a.sourcePath}${a.line ? `:${a.line}` : ''}\`` : '';
    const owners = a.owners?.length ? ` · owner ${a.owners.join(', ')}` : '';
    return `\`<${a.component}>\`${src}${owners}`;
  }
  return `\`${escapeMd(i.selector).slice(0, 120)}\``;
}

function issueRow(i: IssueGroup, reason?: string): string {
  const wcag = i.wcag.map(criterionLabel).join(', ') || 'best practice';
  const count = i.occurrences > 1 ? ` (${i.occurrences}×)` : '';
  const note = reason ? `<br><sub>Not blocking: ${escapeMd(reason)}</sub>` : '';
  const review = i.kind === 'needs-review' ? ' · _needs review_' : '';
  return `| ${IMPACT_ICON[i.impact] ?? ''} ${i.impact} | **${escapeMd(i.help)}**${count}${review}<br><sub>${escapeMd(wcag)}</sub>${note} | ${where(i)} | ${escapeMd(i.flow)} → ${escapeMd(i.checkpoint)} |`;
}

export interface CommentOptions {
  dashboardUrl?: string;
  maxRows?: number;
  commit?: string;
}

/** The single PR comment, updated in place on every run. */
export function renderPrComment(diff: GateDiff, opts: CommentOptions = {}): string {
  const max = opts.maxRows ?? 25;
  const reasons = new Map(diff.nonBlocking.map((n) => [n.fingerprint, n.reason]));
  const lines: string[] = [COMMENT_MARKER];

  const status = !diff.hasBaseline
    ? '⚪ **Checkpoint A11y: baseline not found.** Every issue below is reported as new, and nothing blocks. Merge to the main branch to record the baseline.'
    : diff.passed
      ? `✅ **Checkpoint A11y passed.** No new blocking accessibility issues.`
      : `❌ **Checkpoint A11y failed.** ${diff.blocking.length} new blocking issue${diff.blocking.length === 1 ? '' : 's'}.`;
  lines.push(status, '');
  lines.push(
    `| New | Fixed | Existing |`,
    `|---|---|---|`,
    `| ${diff.newIssues.length} | ${diff.fixedIssues.length} | ${diff.existingIssues.length} |`,
    '',
  );

  if (diff.newIssues.length) {
    lines.push(`### New issues`, '', `| Impact | Issue | Where | Flow → checkpoint |`, `|---|---|---|---|`);
    for (const i of diff.newIssues.slice(0, max)) lines.push(issueRow(i, reasons.get(i.fingerprint)));
    if (diff.newIssues.length > max) lines.push(``, `…and ${diff.newIssues.length - max} more.`);
    lines.push('');
  }

  if (diff.fixedIssues.length) {
    lines.push(`### 🎉 Fixed`, '');
    for (const i of diff.fixedIssues.slice(0, max)) {
      lines.push(`- ~~${escapeMd(i.help)}~~ at ${where(i)} (${escapeMd(i.flow)} → ${escapeMd(i.checkpoint)})`);
    }
    if (diff.fixedIssues.length > max) lines.push(`- …and ${diff.fixedIssues.length - max} more.`);
    lines.push('');
  }

  if (diff.existingIssues.length) {
    lines.push(
      `<details><summary>${diff.existingIssues.length} existing issue${diff.existingIssues.length === 1 ? '' : 's'} (not blocking)</summary>`,
      '',
      `| Impact | Issue | Where | Flow → checkpoint |`,
      `|---|---|---|---|`,
    );
    for (const i of diff.existingIssues.slice(0, max)) lines.push(issueRow(i));
    lines.push('', `</details>`, '');
  }

  const footer: string[] = [];
  if (opts.dashboardUrl) footer.push(`[Open in dashboard](${opts.dashboardUrl})`);
  if (opts.commit) footer.push(`commit \`${opts.commit.slice(0, 7)}\``);
  footer.push('Tested against WCAG 2.2 AA. Automated checks cover only part of WCAG.');
  lines.push(`<sub>${footer.join(' · ')}</sub>`);
  return lines.join('\n');
}

/** Plain-text summary for terminal output. */
export function renderTerminalSummary(diff: GateDiff): string {
  const out: string[] = [];
  const reasons = new Map(diff.nonBlocking.map((n) => [n.fingerprint, n.reason]));
  out.push(`New: ${diff.newIssues.length}  Fixed: ${diff.fixedIssues.length}  Existing: ${diff.existingIssues.length}`);
  for (const i of diff.newIssues) {
    const at = i.attribution.component
      ? `<${i.attribution.component}>${i.attribution.sourcePath ? ` ${i.attribution.sourcePath}${i.attribution.line ? `:${i.attribution.line}` : ''}` : ''}`
      : i.selector;
    const r = reasons.get(i.fingerprint);
    out.push(
      `  ${r ? '·' : '✗'} [${i.impact}] ${i.ruleId}: ${i.help}${i.occurrences > 1 ? ` (${i.occurrences}x)` : ''}`,
      `      at ${at}`,
      `      in ${i.flow} → ${i.checkpoint}${r ? `  (not blocking: ${r})` : ''}`,
    );
  }
  for (const i of diff.fixedIssues) out.push(`  ✓ fixed ${i.ruleId} in ${i.flow} → ${i.checkpoint}`);
  if (!diff.hasBaseline) out.push('', 'No baseline found: the gate passes. Record one with `checkpoint-a11y run --update-baseline` on the main branch.');
  out.push('', diff.passed ? 'Checkpoint A11y: PASSED' : `Checkpoint A11y: FAILED (${diff.blocking.length} new blocking issue${diff.blocking.length === 1 ? '' : 's'})`);
  return out.join('\n');
}
