# Checkpoint A11y

Accessibility checks for real user journeys, in CI. Checkpoint A11y walks the flows that matter (login, search, cart, checkout), checks every step against **WCAG 2.2 AA**, points each issue at the **React component and source line** that causes it, and fails a pull request only when it **adds new issues**, so teams with an existing backlog can switch it on today.

```
New: 2  Fixed: 0  Existing: 26
  ✗ [critical] image-alt: Images must have alternative text
      at <PromoBanner> src/components/PromoBanner.tsx:4
  ✗ [serious] ca11y-reflow: Content must reflow at 320 CSS pixels without horizontal scrolling
      at <PromoBanner> src/components/PromoBanner.tsx:4
Checkpoint A11y: FAILED (2 new blocking issues)
```

## Why another accessibility tool

- **Flows, not URLs.** Most scanners crawl public pages. The problems that lock people out live behind interaction: a cart drawer that does not take focus, a quantity stepper made of `<div>`s, focus lost after "Remove". Checkpoint A11y scans at each step of a scripted journey.
- **Beyond axe-core.** It runs axe-core, then adds a real keyboard pass (focus visible, reachable, trapped, obscured by sticky headers), dialog and form-error state checks, reflow at 320 px, and flow-level checks for the WCAG 2.2 criteria axe does not cover (3.3.7, 3.3.8, 3.2.6, 2.5.7).
- **Component attribution.** A babel plugin stamps components in your CI build, so issues read `<IconButton> in IconButton.tsx:4, owner @design-system` instead of `div > div:nth-child(3) > button`. Owners come from `CODEOWNERS`.
- **No new debt.** The main branch records a baseline. Pull requests fail only on issues that are not in it. Existing issues are reported, never blocking. Fixed issues are celebrated.
- **Runs in your CI.** Nothing leaves your pipeline. No account needed.

## Quick start

```bash
npm i -D @checkpoint-a11y/runner @checkpoint-a11y/babel-plugin
npx playwright install chromium
npx checkpoint-a11y init        # config, an example flow, a GitHub workflow
```

```ts
// a11y/checkout.flow.ts
import { flow } from '@checkpoint-a11y/runner';

flow('checkout', async ({ page, a11y }) => {
  await page.goto('/products/blue-shirt');
  await a11y.checkpoint('product page');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await a11y.checkpoint('cart drawer open');
});
```

```bash
npx checkpoint-a11y run --update-baseline   # on main: record what exists today
npx checkpoint-a11y run --comment           # on PRs: fail only on new issues
```

Already have Playwright tests? Swap the import and add checkpoints:

```ts
import { test } from '@checkpoint-a11y/runner/playwright';
test('checkout', async ({ page, a11y }) => { /* existing steps */ await a11y.checkpoint('cart'); });
```
```bash
npx playwright test && npx checkpoint-a11y gate --comment
```

### Component attribution

Enable the plugin for the CI build only, with `root` set to the repo root so paths match `CODEOWNERS`:

```ts
// vite.config.ts
react({ babel: { plugins: process.env.CHECKPOINT_A11Y ? [['@checkpoint-a11y/babel-plugin', { root: repoRoot }]] : [] } })
```

Without it, the runner falls back to React fiber names (development builds), Angular's debug API, then the CSS selector.

### Where to run it

| Your setup | How |
|---|---|
| App can be built and served in CI | `npm start &`, wait for the port, run against `http://localhost:…`. Mock the backend or point at staging. |
| Preview deployments (Vercel, Netlify, …) | Run on `deployment_status`, with `CHECKPOINT_A11Y_BASE_URL` set to the preview URL. |
| Shared staging only | Run after each staging deploy to catch regressions within minutes of a merge. |
| Existing Playwright suite | Use the fixture above. |

### Protected environments

Checkpoint A11y never tries to evade bot protection. You grant access, and the runner stops with instructions if it is served a block or challenge page instead of your app:

```ts
access: {
  headers: { 'x-waf-bypass': process.env.WAF_BYPASS_KEY! }, // sent only to your own origin, never to third parties
  userAgentSuffix: 'CheckpointA11y (+allowlist-42)',
  httpCredentials: { username: 'qa', password: process.env.STAGING_PW! },
},
auth: { setup: 'a11y/auth.setup.ts' }, // log in once, reuse the session in every flow
```

## What runs at each checkpoint

| Check | Rule ids | WCAG |
|---|---|---|
| axe-core, all A/AA tags for 2.0, 2.1, 2.2 | axe ids | many |
| Keyboard: focus visible, unreachable controls (incl. React `onClick` divs), traps, focus escaping a modal, tab order | `ca11y-focus-not-visible`, `-keyboard-unreachable`, `-focus-trap`, `-dialog-focus-escapes`, `-tab-order` | 2.4.7, 2.1.1, 2.1.2, 2.4.3 |
| Focus not obscured by sticky or fixed content | `ca11y-focus-obscured` | 2.4.11 |
| Dialog focus moved in, dialog marked modal | `ca11y-dialog-focus-not-moved`, `-dialog-not-modal` | 2.4.3, 1.3.1 |
| Form errors linked to fields | `ca11y-error-not-associated`, `-error-text-not-linked` | 3.3.1, 1.3.1 |
| Reflow at 320 CSS px | `ca11y-reflow` | 1.4.10 |
| Accessible authentication | `ca11y-auth-*` | 3.3.8, 1.3.5 |
| Redundant entry, consistent help, dragging | `ca11y-redundant-entry`, `-consistent-help`, `-dragging` | 3.3.7, 3.2.6, 2.5.7 |

Heuristic checks report as **needs review** and never block unless `gate.failOnReview` is set.

## Try the demo

```bash
pnpm install && pnpm build && pnpm --filter @checkpoint-a11y/runner exec playwright install chromium
cd examples/demo-shop && node scripts/demo.mjs
```

It builds a small shop with planted bugs, records a baseline, then builds a "pull request" that adds a promo banner, and the gate fails on exactly the two issues that banner introduces.

## Packages

| Package | |
|---|---|
| [`@checkpoint-a11y/runner`](packages/runner) | Flows, checks, CLI, Playwright fixture, PR comment |
| [`@checkpoint-a11y/babel-plugin`](packages/babel-plugin) | Component stamping for attribution |
| [`@checkpoint-a11y/core`](packages/core) | Fingerprints, baseline diff, WCAG 2.1/2.2 mapping, reports |
| [`packages/github-action`](packages/github-action) | Composite GitHub Action |

## Limits, stated plainly

Automated checks find only part of WCAG failures. Judgement criteria (is the alt text accurate, is the reading order logical, does the screen reader output make sense) need a human. A passing gate is **not** a statement of conformance with WCAG, EN 301 549 or the European Accessibility Act.

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
