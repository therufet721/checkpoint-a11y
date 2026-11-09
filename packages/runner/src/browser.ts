/**
 * Code that runs inside the page under test.
 *
 * installBrowserLib is serialised with Function.prototype.toString by page.evaluate, so it must not
 * reference anything from module scope. Everything it needs is defined inside it.
 */

export interface DescribedElement {
  selector: string;
  html: string;
  attribution: {
    method: 'build-plugin' | 'react-fiber' | 'angular-debug' | 'selector';
    component?: string;
    sourcePath?: string;
    line?: number;
    stack?: string[];
  };
  excluded: boolean;
}

export interface KbStep {
  kind: 'body' | 'element';
  idx?: number;
  target?: DescribedElement;
  docTop?: number;
  left?: number;
  fixed?: boolean;
  focusVisible?: boolean | null;
  obscuredBy?: DescribedElement | null;
  modal?: DescribedElement | null;
  inModal?: boolean | null;
}

export interface UnreachableFinding {
  target: DescribedElement;
  reason: 'react-handler' | 'role' | 'native-negative-tabindex' | 'cursor-pointer';
}

export interface LibFinding {
  rule: string;
  target: DescribedElement;
  detail?: string;
}

export interface FilledField {
  key: string;
  label: string;
  filled: boolean;
  target: DescribedElement;
}

export interface CheckpointA11yBrowserLib {
  version: number;
  setExclude(selectors: string[]): void;
  describe(el: Element): DescribedElement;
  inspect(selectors: string[]): (DescribedElement | null)[];
  kbStart(): { modalOpen: boolean; candidates: number };
  kbStep(): KbStep;
  kbFinish(truncated: boolean): UnreachableFinding[];
  dialogChecks(): LibFinding[];
  formErrorChecks(): LibFinding[];
  authChecks(): LibFinding[];
  dragChecks(): LibFinding[];
  filledFields(): FilledField[];
  helpOrder(selectors: string[]): { index: number; target: DescribedElement }[];
  reflowCheck(): { overflow: number; offenders: DescribedElement[] };
  highlight(selector: string): { x: number; y: number; width: number; height: number } | null;
  unhighlight(): void;
}

declare global {
  interface Window {
    __checkpointA11y?: CheckpointA11yBrowserLib;
  }
}

export function installBrowserLib(): void {
  const LIB_VERSION = 3;
  const w = window as unknown as Window & { ng?: { getOwningComponent?: (el: Element) => unknown } };
  if (w.__checkpointA11y && w.__checkpointA11y.version === LIB_VERSION) return;

  let excludeSelector = '';

  const isElement = (n: unknown): n is Element => !!n && (n as Node).nodeType === 1;

  function cssEscape(s: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&');
  }

  function cssPath(el: Element): string {
    if (el.id && document.querySelectorAll('#' + cssEscape(el.id)).length === 1) return '#' + cssEscape(el.id);
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id && document.querySelectorAll('#' + cssEscape(node.id)).length === 1) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch {
        /* keep walking */
      }
      node = parent;
    }
    return parts.join(' > ');
  }

  function snippet(el: Element): string {
    const html = el.outerHTML || '';
    if (html.length <= 400) return html;
    const open = html.slice(0, html.indexOf('>') + 1);
    return (open.length < 400 ? open : open.slice(0, 397)) + '…';
  }

  function reactKey(el: Element, prefix: string): string | undefined {
    for (const k in el) if (k.startsWith(prefix)) return k;
    return undefined;
  }

  function reactProps(el: Element): Record<string, unknown> | undefined {
    const k = reactKey(el, '__reactProps$');
    return k ? ((el as unknown as Record<string, Record<string, unknown>>)[k]) : undefined;
  }

  type Fiber = { type?: unknown; return?: Fiber | null; _debugSource?: { fileName?: string; lineNumber?: number } };

  function fiberName(type: unknown): string | undefined {
    if (!type) return undefined;
    if (typeof type === 'function') {
      const t = type as { displayName?: string; name?: string };
      return t.displayName || t.name || undefined;
    }
    if (typeof type === 'object') {
      const t = type as { displayName?: string; render?: { displayName?: string; name?: string }; type?: unknown };
      if (t.displayName) return t.displayName;
      if (t.render) return t.render.displayName || t.render.name || undefined; // forwardRef
      if (t.type) return fiberName(t.type); // memo
    }
    return undefined;
  }

  function attribution(el: Element): DescribedElement['attribution'] {
    const stack: string[] = [];
    let first: Element | null = null;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = n.getAttribute('data-a11y-cmp');
      if (c) {
        if (!first) first = n;
        if (stack[stack.length - 1] !== c) stack.push(c);
        if (stack.length >= 8) break;
      }
    }
    if (first) {
      const src = first.getAttribute('data-a11y-src') || '';
      const i = src.lastIndexOf(':');
      const line = i > 0 ? Number(src.slice(i + 1)) : NaN;
      return {
        method: 'build-plugin',
        component: stack[0],
        sourcePath: i > 0 && !Number.isNaN(line) ? src.slice(0, i) : src || undefined,
        line: Number.isNaN(line) ? undefined : line,
        stack,
      };
    }

    // Fallback 1: React fiber tree (development builds give the best names).
    let depth = 0;
    for (let n: Element | null = el; n && depth < 25; n = n.parentElement, depth++) {
      const k = reactKey(n, '__reactFiber$') || reactKey(n, '__reactInternalInstance$');
      if (!k) continue;
      let fiber = (n as unknown as Record<string, Fiber>)[k] as Fiber | null | undefined;
      const names: string[] = [];
      let source: Fiber['_debugSource'];
      while (fiber && names.length < 6) {
        if (typeof fiber.type !== 'string') {
          const name = fiberName(fiber.type);
          // Production builds minify names to one or two letters; those are noise, not attribution.
          if (name && name.length > 2 && /^[A-Z]/.test(name) && !/^(Fragment|Suspense|StrictMode|Provider|Consumer|Context)$/.test(name)) {
            names.push(name);
            if (!source && fiber._debugSource) source = fiber._debugSource;
          }
        }
        fiber = fiber.return;
      }
      if (names.length) {
        return {
          method: 'react-fiber',
          component: names[0],
          stack: names,
          sourcePath: source?.fileName,
          line: source?.lineNumber,
        };
      }
      break;
    }

    // Fallback 2: Angular debug API (development mode only).
    try {
      if (w.ng && typeof w.ng.getOwningComponent === 'function') {
        const cmp = w.ng.getOwningComponent(el) as { constructor?: { name?: string } } | null;
        const name = cmp && cmp.constructor && cmp.constructor.name;
        if (name) return { method: 'angular-debug', component: name.replace(/^_/, ''), stack: [name] };
      }
    } catch {
      /* ignore */
    }
    return { method: 'selector' };
  }

  function describe(el: Element): DescribedElement {
    let excluded = false;
    if (excludeSelector) {
      try {
        excluded = !!el.closest(excludeSelector);
      } catch {
        excluded = false;
      }
    }
    return { selector: cssPath(el), html: snippet(el), attribution: attribution(el), excluded };
  }

  function isVisible(el: Element): boolean {
    const anyEl = el as Element & { checkVisibility?: (o: object) => boolean };
    if (typeof anyEl.checkVisibility === 'function' && !anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function isHiddenFromAll(el: Element): boolean {
    return !!el.closest('[inert],[aria-hidden="true"]');
  }

  const NATIVE_FOCUSABLE =
    'a[href],area[href],button,input:not([type="hidden"]),select,textarea,summary,iframe,[contenteditable=""],[contenteditable="true"],audio[controls],video[controls]';
  const WIDGET_ROLES = [
    'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'option',
    'slider', 'spinbutton', 'combobox', 'textbox', 'treeitem', 'searchbox',
  ];
  const COMPOSITES = '[role="tablist"],[role="menu"],[role="menubar"],[role="listbox"],[role="radiogroup"],[role="toolbar"],[role="grid"],[role="tree"],[role="treegrid"]';

  function isDisabled(el: Element): boolean {
    return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || !!el.closest('fieldset[disabled]');
  }

  function styleSig(el: Element | null, pseudo?: string): string {
    if (!el) return '';
    const cs = getComputedStyle(el, pseudo);
    return [
      cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.outlineOffset, cs.boxShadow, cs.borderTopColor, cs.borderBottomColor,
      cs.borderLeftColor, cs.borderTopWidth, cs.borderBottomWidth, cs.backgroundColor, cs.color, cs.textDecorationLine, cs.transform,
      pseudo ? cs.content + cs.width + cs.height + cs.backgroundColor : '',
    ].join('|');
  }

  function fullSig(el: Element): string {
    return styleSig(el) + '#' + styleSig(el, '::before') + '#' + styleSig(el, '::after') + '#' + styleSig(el.parentElement);
  }

  function fixedAncestor(el: Element | null): Element | null {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') return n;
    }
    return null;
  }

  function openModal(): Element | null {
    const candidates = Array.from(document.querySelectorAll('dialog,[aria-modal="true"]'));
    for (const d of candidates) {
      let modal = d.getAttribute('aria-modal') === 'true';
      try {
        modal = modal || d.matches(':modal');
      } catch {
        /* :modal unsupported */
      }
      if (modal && isVisible(d)) return d;
    }
    return null;
  }

  type KbState = {
    styles: WeakMap<Element, string>;
    ids: Map<Element, number>;
    startEl: Element | null;
    styleEl: HTMLStyleElement;
    modal: Element | null;
    scroll: [number, number];
  };
  let kb: KbState | null = null;

  function candidates(root: Element | Document): Element[] {
    const sel = NATIVE_FOCUSABLE + ',[tabindex],' + WIDGET_ROLES.map((r) => '[role="' + r + '"]').join(',');
    const set = new Set<Element>(Array.from(root.querySelectorAll(sel)));
    // React elements with click handlers and cursor:pointer elements are added lazily in kbFinish.
    return Array.from(set).filter((el) => isVisible(el) && !isHiddenFromAll(el) && !isDisabled(el));
  }

  function obscuredBy(el: Element): Element | null {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const pts = [
      [0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85],
    ]
      .map(([fx, fy]) => [r.left + r.width * fx!, r.top + r.height * fy!] as const)
      .filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    if (!pts.length) return null;
    let coverer: Element | null = null;
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return null;
      if (hit === el || el.contains(hit) || hit.contains(el)) return null;
      const fixed = fixedAncestor(hit);
      if (!fixed || fixed.contains(el)) return null;
      coverer = fixed;
    }
    return coverer;
  }

  function labelText(el: Element): string {
    const input = el as HTMLInputElement;
    const fromLabels = input.labels && input.labels.length ? Array.from(input.labels).map((l) => l.textContent || '').join(' ') : '';
    const aria = el.getAttribute('aria-label') || '';
    return (fromLabels || aria || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ');
  }

  function idrefsResolve(el: Element, attr: string): Element[] {
    return (el.getAttribute(attr) || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e);
  }

  const lib: CheckpointA11yBrowserLib = {
    version: LIB_VERSION,

    setExclude(selectors: string[]) {
      excludeSelector = selectors.filter(Boolean).join(',');
    },

    describe,

    inspect(selectors: string[]) {
      return selectors.map((s) => {
        try {
          const el = document.querySelector(s);
          return el ? describe(el) : null;
        } catch {
          return null;
        }
      });
    },

    kbStart() {
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-checkpoint-a11y', '');
      styleEl.textContent = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important;caret-color:transparent!important}';
      document.head.appendChild(styleEl);
      const modal = openModal();
      const startEl = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      if (!modal && startEl && (startEl as HTMLElement).blur) (startEl as HTMLElement).blur();
      const styles = new WeakMap<Element, string>();
      const list = candidates(document);
      for (const el of list) styles.set(el, fullSig(el));
      kb = { styles, ids: new Map(), startEl, styleEl, modal, scroll: [scrollX, scrollY] };
      return { modalOpen: !!modal, candidates: list.length };
    },

    kbStep(): KbStep {
      const state = kb!;
      let el = document.activeElement;
      // Descend into open shadow roots.
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { kind: 'body' };
      let idx = state.ids.get(el);
      const firstVisit = idx === undefined;
      if (idx === undefined) {
        idx = state.ids.size;
        state.ids.set(el, idx);
      }
      if (!firstVisit) return { kind: 'element', idx };
      const r = el.getBoundingClientRect();
      let focusVisible: boolean | null = null;
      if (el.tagName !== 'IFRAME') {
        // Compare the element with itself, focused and unfocused, at this moment. A snapshot taken at the
        // start goes stale on pages with carousels, animations or re-rendering components, which
        // produced false "focus not visible" reports.
        const focusedSig = fullSig(el);
        const h = el as HTMLElement;
        h.blur();
        const unfocusedSig = fullSig(el);
        h.focus({ preventScroll: true });
        if (document.activeElement === el) focusVisible = focusedSig !== unfocusedSig;
        else {
          const before = state.styles.get(el);
          focusVisible = before !== undefined && el !== state.startEl ? focusedSig !== before : null;
        }
      }
      const cover = obscuredBy(el);
      const modal = openModal();
      return {
        kind: 'element',
        idx,
        target: describe(el),
        docTop: r.top + scrollY,
        left: r.left + scrollX,
        fixed: !!fixedAncestor(el),
        focusVisible,
        obscuredBy: cover ? describe(cover) : null,
        modal: modal ? describe(modal) : null,
        inModal: modal ? modal.contains(el) : null,
      };
    },

    kbFinish(truncated: boolean) {
      const state = kb!;
      const out: UnreachableFinding[] = [];
      const reached = Array.from(state.ids.keys());
      const root: Element | Document = state.modal || document;
      const isReachedRelated = (el: Element) => reached.some((r) => r === el || el.contains(r) || r.contains(el));

      const report = (el: Element, reason: UnreachableFinding['reason']) => {
        if (out.length < 25) out.push({ target: describe(el), reason });
      };

      if (!truncated) {
        const seen = new Set<Element>();
        // 1. Native focusables and widget roles that Tab never reached.
        for (const el of candidates(root)) {
          if (isReachedRelated(el)) continue;
          const composite = el.closest(COMPOSITES);
          if (composite && reached.some((r) => composite.contains(r))) continue; // roving tabindex
          if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
            const group = document.querySelectorAll('input[type="radio"][name="' + cssEscape(el.name) + '"]');
            if (Array.from(group).some((g) => reached.includes(g))) continue;
          }
          if (el.tagName === 'IFRAME' || el.matches('[tabindex]:not([role]):not(' + NATIVE_FOCUSABLE + ')')) {
            // A bare tabindex="-1" container is a programmatic focus target, not a control.
            continue;
          }
          const native = el.matches(NATIVE_FOCUSABLE);
          if (native && (el as HTMLElement).tabIndex >= 0) continue; // focusable; maybe beyond a trap, reported elsewhere
          seen.add(el);
          report(el, native ? 'native-negative-tabindex' : 'role');
        }
        // 2. Elements with React click handlers that are not focusable.
        const all = Array.from(root.querySelectorAll('div,span,li,img,svg,td,tr,p,section,article,label,i'));
        for (const el of all.slice(0, 5000)) {
          if (seen.has(el) || el.matches(NATIVE_FOCUSABLE) || el.hasAttribute('tabindex') || el.closest(NATIVE_FOCUSABLE)) continue;
          if (el.tagName === 'LABEL') continue; // labels forward clicks to their control
          const props = reactProps(el);
          const hasHandler = props && (typeof props.onClick === 'function' || typeof props.onMouseDown === 'function' || typeof props.onPointerDown === 'function');
          const hasAttrHandler = el.hasAttribute('onclick');
          if ((hasHandler || hasAttrHandler) && isVisible(el) && !isHiddenFromAll(el) && !isReachedRelated(el)) {
            seen.add(el);
            report(el, 'react-handler');
          }
        }
        // 3. cursor:pointer with no other signal. Heuristic, reported for review.
        for (const el of all.slice(0, 3000)) {
          if (seen.has(el) || el.matches(NATIVE_FOCUSABLE) || el.hasAttribute('tabindex') || el.closest(NATIVE_FOCUSABLE + ',[role]')) continue;
          if (getComputedStyle(el).cursor !== 'pointer') continue;
          if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
          if (el.querySelector(NATIVE_FOCUSABLE) || !isVisible(el) || isHiddenFromAll(el) || isReachedRelated(el)) continue;
          if (el.tagName === 'LABEL') continue;
          report(el, 'cursor-pointer');
        }
      }

      state.styleEl.remove();
      try {
        if (state.startEl && (state.startEl as HTMLElement).focus) (state.startEl as HTMLElement).focus({ preventScroll: true });
        else if (document.activeElement && (document.activeElement as HTMLElement).blur) (document.activeElement as HTMLElement).blur();
      } catch {
        /* ignore */
      }
      scrollTo(state.scroll[0], state.scroll[1]);
      kb = null;
      return out;
    },

    dialogChecks() {
      const out: LibFinding[] = [];
      const dialogs = Array.from(document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')).filter(
        (d) => isVisible(d) && !isHiddenFromAll(d),
      );
      let active = document.activeElement;
      while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
      for (const d of dialogs) {
        if (!active || !d.contains(active)) {
          out.push({ rule: 'dialog-focus-not-moved', target: describe(d) });
        }
        const isModalish = d.getAttribute('aria-modal') === 'true' || d.tagName === 'DIALOG';
        if (!isModalish && d.getAttribute('role') === 'dialog') {
          // A visible dialog without aria-modal lets screen reader users wander into the page behind it.
          out.push({ rule: 'dialog-not-modal', target: describe(d) });
        }
      }
      return out;
    },

    formErrorChecks() {
      const out: LibFinding[] = [];
      const fields = Array.from(document.querySelectorAll('[aria-invalid="true"]')).filter(isVisible);
      for (const f of fields) {
        const refs = [...idrefsResolve(f, 'aria-describedby'), ...idrefsResolve(f, 'aria-errormessage')];
        const hasText = refs.some((r) => (r.textContent || '').trim().length > 0);
        if (!hasText) out.push({ rule: 'error-not-associated', target: describe(f), detail: labelText(f) });
      }
      // Visible error text next to a field that is not programmatically linked to it.
      const errorish = Array.from(
        document.querySelectorAll('[role="alert"],[class*="error" i],[class*="invalid" i],[id*="error" i]'),
      ).filter((e) => {
        const text = (e.textContent || '').trim();
        return text.length > 1 && text.length < 200 && isVisible(e) && !e.matches('input,select,textarea,form');
      });
      const flagged = new Set<Element>(fields);
      for (const e of errorish) {
        let container: Element | null = e.parentElement;
        let input: Element | null = null;
        for (let i = 0; i < 3 && container && !input; i++, container = container.parentElement) {
          const inputs = container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]),select,textarea');
          if (inputs.length === 1) input = inputs[0]!;
          else if (inputs.length > 1) break;
        }
        if (!input || flagged.has(input)) continue;
        const refs = [...idrefsResolve(input, 'aria-describedby'), ...idrefsResolve(input, 'aria-errormessage')];
        const linked = refs.some((r) => r === e || r.contains(e) || e.contains(r));
        const inLabel = (input as HTMLInputElement).labels && Array.from((input as HTMLInputElement).labels!).some((l) => l.contains(e));
        if (!linked && !inLabel) {
          flagged.add(input);
          out.push({ rule: 'error-text-not-linked', target: describe(input), detail: (e.textContent || '').trim().slice(0, 120) });
        }
      }
      return out;
    },

    authChecks() {
      const out: LibFinding[] = [];
      const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(isVisible) as HTMLInputElement[];
      for (const p of passwords) {
        let prevented = false;
        try {
          const dt = new DataTransfer();
          const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
          p.dispatchEvent(ev);
          prevented = ev.defaultPrevented;
        } catch {
          /* ignore */
        }
        if (prevented) out.push({ rule: 'auth-paste-blocked', target: describe(p) });
        const ac = (p.getAttribute('autocomplete') || '').toLowerCase();
        if (!/(current|new)-password/.test(ac)) out.push({ rule: 'auth-password-autocomplete', target: describe(p), detail: ac || '(none)' });
      }
      if (passwords.length) {
        const form = passwords[0]!.form || document;
        const user = Array.from(form.querySelectorAll('input[type="email"],input[type="text"],input:not([type])')).filter(isVisible)[0];
        if (user) {
          const ac = (user.getAttribute('autocomplete') || '').toLowerCase();
          if (!/username|email/.test(ac)) out.push({ rule: 'auth-username-autocomplete', target: describe(user), detail: ac || '(none)' });
        }
      }
      const captcha = Array.from(
        document.querySelectorAll(
          'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],.g-recaptcha,.h-captcha,.cf-turnstile,[class*="captcha" i],[id*="captcha" i]',
        ),
      ).filter(isVisible)[0];
      if (captcha) out.push({ rule: 'auth-captcha', target: describe(captcha) });
      return out;
    },

    dragChecks() {
      const out: LibFinding[] = [];
      const sel =
        '[draggable="true"],[data-rbd-drag-handle-draggable-id],[data-rfd-drag-handle-draggable-id],[aria-roledescription*="sortable" i],[aria-roledescription*="draggable" i],[data-swapy-item],.sortable-handle,.drag-handle';
      const found = new Set<Element>(Array.from(document.querySelectorAll(sel)).filter(isVisible));
      for (const el of Array.from(document.querySelectorAll('div,li,span,tr,img')).slice(0, 4000)) {
        const props = reactProps(el);
        if (props && typeof props.onDragStart === 'function' && isVisible(el)) found.add(el);
      }
      // One finding per component is enough; the fingerprint collapses repeats anyway.
      for (const el of Array.from(found).slice(0, 10)) out.push({ rule: 'dragging-alternative', target: describe(el) });
      return out;
    },

    filledFields() {
      const out: FilledField[] = [];
      const skipTypes = /^(hidden|password|checkbox|radio|file|submit|button|reset|image|range|color)$/;
      const fields = Array.from(document.querySelectorAll('input,select,textarea')).filter(
        (f) => isVisible(f) && !skipTypes.test((f as HTMLInputElement).type || ''),
      ) as HTMLInputElement[];
      for (const f of fields) {
        const ac = (f.getAttribute('autocomplete') || '').toLowerCase().replace(/^section-\S+\s+/, '').replace(/^(shipping|billing)\s+/, '');
        const label = labelText(f);
        const key = ac && ac !== 'on' && ac !== 'off' ? 'ac:' + ac : f.name ? 'name:' + f.name.toLowerCase() : label ? 'label:' + label.toLowerCase() : '';
        if (!key) continue;
        out.push({ key, label: label || f.name || ac, filled: !!(f.value && f.value.trim()), target: describe(f) });
      }
      return out;
    },

    helpOrder(selectors: string[]) {
      const found: { index: number; el: Element }[] = [];
      selectors.forEach((s, index) => {
        try {
          const el = Array.from(document.querySelectorAll(s)).find(isVisible);
          if (el) found.push({ index, el });
        } catch {
          /* invalid selector, ignore */
        }
      });
      found.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      return found.map((f) => ({ index: f.index, target: describe(f.el) }));
    },

    reflowCheck() {
      const de = document.documentElement;
      const width = de.clientWidth;
      const scrollWidth = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0);
      const overflow = scrollWidth - width;
      if (overflow <= 1) return { overflow: 0, offenders: [] };
      const exempt = 'table,pre,code,canvas,video,[role="grid"],[role="application"],[data-ca11y-reflow-exempt]';
      const offenders: Element[] = [];
      const all = Array.from(document.body.querySelectorAll('*')).slice(0, 6000);
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.right <= width + 1 || r.width < 1 || r.height < 1) continue;
        if (el.closest(exempt)) continue;
        if (getComputedStyle(el).position === 'fixed') continue;
        // Skip if an ancestor clips or scrolls horizontally: that does not cause page scrolling.
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
            clipped = true;
            break;
          }
        }
        if (clipped) continue;
        // Report the outermost overflowing element only.
        if (offenders.some((o) => o.contains(el))) continue;
        const parent = el.parentElement;
        if (parent && parent !== document.body && parent.getBoundingClientRect().right > width + 1) continue;
        offenders.push(el);
        if (offenders.length >= 5) break;
      }
      return { overflow, offenders: offenders.map(describe) };
    },

    highlight(selector: string) {
      lib.unhighlight();
      let el: Element | null = null;
      try {
        el = document.querySelector(selector);
      } catch {
        return null;
      }
      if (!el || !isElement(el)) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      const box = document.createElement('div');
      box.setAttribute('data-ca11y-highlight', '');
      Object.assign(box.style, {
        position: 'fixed', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px',
        outline: '3px solid #e5007a', outlineOffset: '0', background: 'rgba(229,0,122,0.08)', zIndex: '2147483647', pointerEvents: 'none',
      });
      document.body.appendChild(box);
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },

    unhighlight() {
      document.querySelectorAll('[data-ca11y-highlight]').forEach((n) => n.remove());
    },
  };

  w.__checkpointA11y = lib;
}
