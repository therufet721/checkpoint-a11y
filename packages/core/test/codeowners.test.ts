import { describe, expect, it } from 'vitest';
import { ownersFor, parseCodeowners } from '../src/codeowners';

const rules = parseCodeowners(`
# comment
*                     @org/frontend
*.css                 @org/styling
/packages/ui/         @org/design-system
apps/**/checkout/     @org/payments   # inline comment
docs/*.md             @org/docs
Button.tsx            @alice
`);

describe('CODEOWNERS', () => {
  it('falls back to the catch-all', () => expect(ownersFor(rules, 'apps/web/src/index.ts')).toEqual(['@org/frontend']));
  it('matches anchored directories', () => expect(ownersFor(rules, 'packages/ui/src/Card.tsx')).toEqual(['@org/design-system']));
  it('matches ** directories', () => expect(ownersFor(rules, 'apps/shop/src/checkout/Form.tsx')).toEqual(['@org/payments']));
  it('lets the last match win', () => expect(ownersFor(rules, 'packages/ui/src/Button.tsx')).toEqual(['@alice']));
  it('does not cross directories with a single star', () => expect(ownersFor(rules, 'docs/a/b.md')).toEqual(['@org/frontend']));
  it('matches extensions anywhere', () => expect(ownersFor(rules, 'apps/web/a.css')).toEqual(['@org/styling']));
});
