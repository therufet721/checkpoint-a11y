import type { Impact, IssueKind, RuleSource } from '@checkpoint-a11y/core';

export interface RuleMeta {
  id: string;
  source: RuleSource;
  kind: IssueKind;
  impact: Impact;
  wcag: string[];
  help: string;
  helpUrl: string;
}

const U = (slug: string) => `https://www.w3.org/WAI/WCAG22/Understanding/${slug}`;

/** Checks Checkpoint A11y adds on top of axe-core. Every id is prefixed so it can never collide with an axe rule. */
export const RULES = {
  focusNotVisible: {
    id: 'ca11y-focus-not-visible', source: 'keyboard', kind: 'violation', impact: 'serious', wcag: ['2.4.7'],
    help: 'Keyboard focus must be visible', helpUrl: U('focus-visible'),
  },
  focusObscured: {
    id: 'ca11y-focus-obscured', source: 'keyboard', kind: 'violation', impact: 'serious', wcag: ['2.4.11'],
    help: 'Focused element must not be fully hidden by sticky or fixed content', helpUrl: U('focus-not-obscured-minimum'),
  },
  unreachable: {
    id: 'ca11y-keyboard-unreachable', source: 'keyboard', kind: 'violation', impact: 'serious', wcag: ['2.1.1'],
    help: 'Interactive element cannot be reached with the keyboard', helpUrl: U('keyboard'),
  },
  unreachableReview: {
    id: 'ca11y-keyboard-unreachable-review', source: 'keyboard', kind: 'needs-review', impact: 'moderate', wcag: ['2.1.1'],
    help: 'Element looks clickable but cannot be reached with the keyboard', helpUrl: U('keyboard'),
  },
  focusTrap: {
    id: 'ca11y-focus-trap', source: 'keyboard', kind: 'violation', impact: 'critical', wcag: ['2.1.2'],
    help: 'Keyboard focus is trapped', helpUrl: U('no-keyboard-trap'),
  },
  tabOrder: {
    id: 'ca11y-tab-order', source: 'keyboard', kind: 'needs-review', impact: 'minor', wcag: ['2.4.3'],
    help: 'Tab order jumps backwards against the visual order', helpUrl: U('focus-order'),
  },
  dialogFocusNotMoved: {
    id: 'ca11y-dialog-focus-not-moved', source: 'state', kind: 'violation', impact: 'serious', wcag: ['2.4.3'],
    help: 'Focus must move into a dialog when it opens', helpUrl: U('focus-order'),
  },
  dialogFocusEscapes: {
    id: 'ca11y-dialog-focus-escapes', source: 'state', kind: 'violation', impact: 'serious', wcag: ['2.4.3'],
    help: 'Focus must stay inside an open modal dialog', helpUrl: U('focus-order'),
  },
  dialogNotModal: {
    id: 'ca11y-dialog-not-modal', source: 'state', kind: 'needs-review', impact: 'moderate', wcag: ['1.3.1'],
    help: 'Dialog is not marked modal, so content behind it stays reachable', helpUrl: U('info-and-relationships'),
  },
  errorNotAssociated: {
    id: 'ca11y-error-not-associated', source: 'state', kind: 'violation', impact: 'serious', wcag: ['3.3.1', '1.3.1'],
    help: 'Invalid field has no error message linked to it', helpUrl: U('error-identification'),
  },
  errorTextNotLinked: {
    id: 'ca11y-error-text-not-linked', source: 'state', kind: 'needs-review', impact: 'moderate', wcag: ['3.3.1', '1.3.1'],
    help: 'Error text is shown next to a field but not linked to it', helpUrl: U('error-identification'),
  },
  reflow: {
    id: 'ca11y-reflow', source: 'layout', kind: 'violation', impact: 'serious', wcag: ['1.4.10'],
    help: 'Content must reflow at 320 CSS pixels without horizontal scrolling', helpUrl: U('reflow'),
  },
  authPasteBlocked: {
    id: 'ca11y-auth-paste-blocked', source: 'wcag22', kind: 'violation', impact: 'serious', wcag: ['3.3.8'],
    help: 'Password field blocks paste, which breaks password managers', helpUrl: U('accessible-authentication-minimum'),
  },
  authAutocomplete: {
    id: 'ca11y-auth-autocomplete', source: 'wcag22', kind: 'needs-review', impact: 'moderate', wcag: ['3.3.8', '1.3.5'],
    help: 'Login field lacks an autocomplete value that password managers rely on', helpUrl: U('accessible-authentication-minimum'),
  },
  authCaptcha: {
    id: 'ca11y-auth-captcha', source: 'wcag22', kind: 'needs-review', impact: 'serious', wcag: ['3.3.8'],
    help: 'CAPTCHA present: confirm an alternative that is not a cognitive test exists', helpUrl: U('accessible-authentication-minimum'),
  },
  redundantEntry: {
    id: 'ca11y-redundant-entry', source: 'wcag22', kind: 'needs-review', impact: 'moderate', wcag: ['3.3.7'],
    help: 'Information entered earlier in this flow is asked for again', helpUrl: U('redundant-entry'),
  },
  consistentHelp: {
    id: 'ca11y-consistent-help', source: 'wcag22', kind: 'violation', impact: 'moderate', wcag: ['3.2.6'],
    help: 'Help mechanisms appear in a different relative order than on other pages', helpUrl: U('consistent-help'),
  },
  dragging: {
    id: 'ca11y-dragging', source: 'wcag22', kind: 'needs-review', impact: 'moderate', wcag: ['2.5.7'],
    help: 'Drag interaction found: confirm a single-pointer alternative exists', helpUrl: U('dragging-movements'),
  },
} satisfies Record<string, RuleMeta>;
