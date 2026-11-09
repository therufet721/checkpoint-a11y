import type { StandardsApplicability } from './types';

/** Bump whenever any check, mapping or fingerprint rule changes, so old evidence stays interpretable. */
export const RULESET_VERSION = '2026.11.0';

/** Criteria added in WCAG 2.1 (A and AA only). */
export const WCAG21_NEW = new Set([
  '1.3.4', '1.3.5', '1.4.10', '1.4.11', '1.4.12', '1.4.13', '2.1.4', '2.5.1', '2.5.2', '2.5.3', '2.5.4', '4.1.3',
]);

/** Criteria added in WCAG 2.2 (A and AA only). */
export const WCAG22_NEW = new Set(['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8']);

/** Criteria removed in WCAG 2.2. */
export const WCAG22_REMOVED = new Set(['4.1.1']);

export interface CriterionInfo {
  id: string;
  name: string;
  level: 'A' | 'AA';
}

/** Names for the criteria the tool can report. Unknown ids still work, they just render without a name. */
export const CRITERIA: Record<string, CriterionInfo> = Object.fromEntries(
  (
    [
      ['1.1.1', 'Non-text Content', 'A'],
      ['1.2.2', 'Captions (Prerecorded)', 'A'],
      ['1.3.1', 'Info and Relationships', 'A'],
      ['1.3.2', 'Meaningful Sequence', 'A'],
      ['1.3.4', 'Orientation', 'AA'],
      ['1.3.5', 'Identify Input Purpose', 'AA'],
      ['1.4.1', 'Use of Color', 'A'],
      ['1.4.2', 'Audio Control', 'A'],
      ['1.4.3', 'Contrast (Minimum)', 'AA'],
      ['1.4.4', 'Resize Text', 'AA'],
      ['1.4.10', 'Reflow', 'AA'],
      ['1.4.11', 'Non-text Contrast', 'AA'],
      ['1.4.12', 'Text Spacing', 'AA'],
      ['2.1.1', 'Keyboard', 'A'],
      ['2.1.2', 'No Keyboard Trap', 'A'],
      ['2.2.1', 'Timing Adjustable', 'A'],
      ['2.2.2', 'Pause, Stop, Hide', 'A'],
      ['2.4.1', 'Bypass Blocks', 'A'],
      ['2.4.2', 'Page Titled', 'A'],
      ['2.4.3', 'Focus Order', 'A'],
      ['2.4.4', 'Link Purpose (In Context)', 'A'],
      ['2.4.7', 'Focus Visible', 'AA'],
      ['2.4.11', 'Focus Not Obscured (Minimum)', 'AA'],
      ['2.5.3', 'Label in Name', 'A'],
      ['2.5.7', 'Dragging Movements', 'AA'],
      ['2.5.8', 'Target Size (Minimum)', 'AA'],
      ['3.1.1', 'Language of Page', 'A'],
      ['3.1.2', 'Language of Parts', 'AA'],
      ['3.2.6', 'Consistent Help', 'A'],
      ['3.3.1', 'Error Identification', 'A'],
      ['3.3.2', 'Labels or Instructions', 'A'],
      ['3.3.7', 'Redundant Entry', 'A'],
      ['3.3.8', 'Accessible Authentication (Minimum)', 'AA'],
      ['4.1.1', 'Parsing (removed in 2.2)', 'A'],
      ['4.1.2', 'Name, Role, Value', 'A'],
      ['4.1.3', 'Status Messages', 'AA'],
    ] as const
  ).map(([id, name, level]) => [id, { id, name, level }]),
);

/** axe tags look like "wcag143" or "wcag2411". */
export function criteriaFromAxeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...new Set(out)];
}

/** Which WCAG versions an issue counts against. Issues with no criteria (best practices) count against neither. */
export function applicability(criteria: string[]): StandardsApplicability {
  return {
    wcag21: criteria.some((c) => !WCAG22_NEW.has(c)),
    wcag22: criteria.some((c) => !WCAG22_REMOVED.has(c)),
  };
}

export function criterionLabel(id: string): string {
  const c = CRITERIA[id];
  return c ? `${id} ${c.name} (${c.level})` : id;
}

export const STANDARDS_NOTE =
  'Results are reported against WCAG 2.2 AA (EN 301 549 V4.1.1) and WCAG 2.1 AA (EN 301 549 V3.2.1). ' +
  'EN 301 549 contains requirements beyond WCAG, and automated checks cover only part of WCAG. ' +
  'A passing result is not a statement of conformance.';
