import { transformSync } from '@babel/core';
import { describe, expect, it } from 'vitest';
import plugin from '../src/index';

function transform(code: string, filename = '/repo/packages/ui/src/Button.tsx', opts: Record<string, unknown> = {}) {
  const out = transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [[plugin, { root: '/repo', ...opts }]],
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    parserOpts: { plugins: ['jsx'] },
  });
  return out!.code!;
}

describe('babel plugin', () => {
  it('stamps a function component root', () => {
    const code = transform(`export function PrimaryButton() {\n  return <button className="x">Go</button>;\n}`);
    expect(code).toContain('data-a11y-cmp="PrimaryButton"');
    expect(code).toContain('data-a11y-src="packages/ui/src/Button.tsx:2"');
  });

  it('stamps arrow components wrapped in memo and forwardRef', () => {
    const code = transform(`const IconButton = React.memo(React.forwardRef((p, ref) => <button ref={ref} />));`);
    expect(code).toContain('data-a11y-cmp="IconButton"');
  });

  it('descends through other components to the first host elements', () => {
    const code = transform(`function Checkout() { return <Layout title="x"><form><input/></form></Layout>; }`);
    expect(code).toMatch(/<form data-a11y-cmp="Checkout"/);
    expect(code).not.toMatch(/<input data-a11y-cmp/);
    expect(code).not.toMatch(/<Layout[^>]*data-a11y-cmp/);
  });

  it('handles fragments, conditionals, logical and map', () => {
    const code = transform(`
      function List({ items, open }) {
        if (!items.length) return <p>Empty</p>;
        return <>{open ? <ul>{items.map(i => <li key={i}>{i}</li>)}</ul> : <span/>}{open && <aside/>}</>;
      }`);
    for (const tag of ['p', 'ul', 'span', 'aside']) expect(code).toMatch(new RegExp(`<${tag} data-a11y-cmp="List"`));
    // li is inside a stamped ul, so it inherits through the DOM
    expect(code).not.toMatch(/<li[^>]*data-a11y-cmp/);
  });

  it('ignores nested non-component functions and lowercase functions', () => {
    const code = transform(`function helper() { return <div/>; }\nfunction Card() { const render = () => <b/>; return <section/>; }`);
    expect(code).not.toMatch(/<div data-a11y/);
    expect(code).not.toMatch(/<b data-a11y/);
    expect(code).toMatch(/<section data-a11y-cmp="Card"/);
  });

  it('names anonymous default exports after the file', () => {
    const code = transform(`export default () => <main/>;`, '/repo/apps/web/src/checkout-page.tsx');
    expect(code).toContain('data-a11y-cmp="CheckoutPage"');
  });

  it('stamps class components', () => {
    const code = transform(`class Legacy extends React.Component { render() { return <div/>; } }`);
    expect(code).toContain('data-a11y-cmp="Legacy"');
  });

  it('can be disabled and skips node_modules', () => {
    expect(transform(`function A() { return <div/>; }`, undefined, { enabled: false })).not.toContain('data-a11y');
    expect(transform(`function A() { return <div/>; }`, '/repo/node_modules/x/A.tsx')).not.toContain('data-a11y');
  });
});
