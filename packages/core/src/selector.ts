/**
 * Strips the parts of a CSS selector that change between unrelated builds or DOM edits:
 * positional pseudo-classes, generated class names, and generated ids.
 * The result is only used for fingerprinting, never to query the DOM.
 */
/** Prefixes used by CSS-in-JS and framework tooling for hashed class names. */
const GENERATED_CLASS_PREFIXES: RegExp[] = [
  /^css-[a-z0-9]+$/i, // emotion
  /^sc-[a-z0-9]+$/i, // styled-components
  /^jsx-\d+$/, // styled-jsx
  /^svelte-[a-z0-9]+$/i,
  /^ng-tns-c\d+-\d+$/, // angular animations
  /^ng-star-inserted$/,
  /^_[a-z0-9]{5,}$/i, // vite css modules
];

function isGeneratedClass(name: string): boolean {
  if (GENERATED_CLASS_PREFIXES.some((re) => re.test(name))) return true;
  // CSS modules: "Button_root__a1b2c", "button-module--x1y2z". Only a suffix containing a digit counts
  // as a hash, so "btn-primary" survives.
  const m = /^.+?[_-]{1,2}([a-z0-9]{5,})$/i.exec(name);
  if (m) return /\d/.test(m[1]!);
  // Bare hashes like "a1b2c3".
  return /^[a-z0-9]{6,}$/i.test(name) && /\d/.test(name) && /[a-z]/i.test(name);
}

function isGeneratedId(id: string): boolean {
  return (
    /^:r[0-9a-z]+:$/.test(id) || // React useId
    /^(radix|headlessui|mui|react-aria|downshift|rc|ember|mat|cdk|ngx|chakra)[-:_]/i.test(id) ||
    /\d{2,}/.test(id) || // contains a run of digits
    /^[a-f0-9-]{16,}$/i.test(id) // uuid-ish
  );
}

/** Splits on commas and combinators while respecting quotes, brackets and parentheses. */
function tokenize(selector: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of selector) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
      if (cur) tokens.push(cur);
      cur = '';
      if (ch !== ' ') tokens.push(ch);
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function normalizeCompound(compound: string): string {
  let s = compound
    .replace(/:nth-(child|of-type|last-child|last-of-type)\([^)]*\)/g, '')
    .replace(/:(first|last|only)-(child|of-type)/g, '');
  s = s.replace(/#((?:\\.|[\w-])+)/g, (m, id: string) => (isGeneratedId(id.replace(/\\/g, '')) ? '' : m));
  s = s.replace(/\.((?:\\.|[\w-])+)/g, (m, cls: string) => (isGeneratedClass(cls.replace(/\\/g, '')) ? '' : m));
  // Attribute values that look generated (e.g. [id="radix-1"]) are reduced to presence checks.
  s = s.replace(/\[([\w-]+)(?:[~|^$*]?=)("[^"]*"|'[^']*'|[^\]]*)\]/g, (m, attr: string, val: string) => {
    const v = val.replace(/^["']|["']$/g, '');
    return isGeneratedId(v) ? `[${attr}]` : m;
  });
  return s || '*';
}

export function normalizeSelector(selector: string): string {
  return selector
    .split(',')
    .map((part) =>
      tokenize(part.trim())
        .map((t) => (t === '>' || t === '+' || t === '~' ? t : normalizeCompound(t)))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join(', ');
}
