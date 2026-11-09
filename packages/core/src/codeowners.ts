/**
 * CODEOWNERS matching with GitHub semantics: gitignore-style patterns, and the last matching rule wins.
 */
export interface CodeownersRule {
  pattern: string;
  owners: string[];
  regex: RegExp;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function patternToRegex(pattern: string): RegExp {
  let p = pattern.trim();
  const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    if (ch === '*') {
      if (p[i + 1] === '*') {
        const atSegmentStart = i === 0 || p[i - 1] === '/';
        const followedBySlash = p[i + 2] === '/';
        if (atSegmentStart && followedBySlash) {
          re += '(?:.*/)?'; // "**/" matches zero or more directories
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += escapeRegex(ch);
    }
  }

  const prefix = anchored ? '^' : '^(?:.*/)?';
  // A pattern matches the path itself, or everything below it when it names a directory.
  const suffix = dirOnly ? '/.*$' : '(?:/.*)?$';
  return new RegExp(prefix + re + suffix);
}

export function parseCodeowners(content: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line || line.startsWith('[')) continue; // skip comments and GitLab section headers
    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern) continue;
    rules.push({ pattern, owners, regex: patternToRegex(pattern) });
  }
  return rules;
}

export function ownersFor(rules: CodeownersRule[], path: string): string[] {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  let owners: string[] = [];
  for (const rule of rules) if (rule.regex.test(normalized)) owners = rule.owners;
  return owners;
}
