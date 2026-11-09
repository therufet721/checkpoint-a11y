import fs from 'node:fs/promises';
import path from 'node:path';

const CONFIG = `import { defineConfig } from '@checkpoint-a11y/runner';

export default defineConfig({
  // A preview deployment or local server. Override in CI with CHECKPOINT_A11Y_BASE_URL.
  baseURL: 'http://localhost:3000',
  flows: ['a11y/**/*.flow.ts'],
  viewports: [{ name: 'desktop', width: 1280, height: 800 }],
  gate: {
    // 'any' fails on every new violation, 'serious' only on serious and critical, 'none' warns only.
    failOn: 'serious',
  },
  // Help links or widgets that must keep the same relative order on every page (WCAG 3.2.6).
  help: ['a[href*="help"]', 'a[href*="contact"]'],
  waivers: [
    // { match: '<fingerprint or root cause key>', reason: 'Third-party widget, vendor fix due', expires: '2026-12-31' },
  ],
});
`;

const FLOW = `import { flow } from '@checkpoint-a11y/runner';

flow('home', async ({ page, a11y }) => {
  await page.goto('/');
  await a11y.checkpoint('home page');
});
`;

const WORKFLOW = `name: Accessibility
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      # Build with CHECKPOINT_A11Y=1 so the babel plugin stamps components, then serve the app.
      - run: CHECKPOINT_A11Y=1 npm run build && (npm run start &) && npx wait-on http://localhost:3000
      - run: npx checkpoint-a11y run --comment \${{ github.ref == 'refs/heads/main' && '--update-baseline' || '' }}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          CHECKPOINT_A11Y_TOKEN: \${{ secrets.CHECKPOINT_A11Y_TOKEN }}
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: checkpoint-a11y-results, path: .checkpoint-a11y/results }
`;

async function writeIfMissing(file: string, content: string, log: (m: string) => void): Promise<void> {
  try {
    await fs.access(file);
    log(`  exists   ${file}`);
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    log(`  created  ${file}`);
  }
}

export async function init(cwd: string, log: (m: string) => void): Promise<void> {
  await writeIfMissing(path.join(cwd, 'checkpoint-a11y.config.ts'), CONFIG, log);
  await writeIfMissing(path.join(cwd, 'a11y', 'home.flow.ts'), FLOW, log);
  await writeIfMissing(path.join(cwd, '.github', 'workflows', 'checkpoint-a11y.yml'), WORKFLOW, log);
  log('\nNext: add @checkpoint-a11y/babel-plugin to your CI build, write flows in a11y/, then run `npx checkpoint-a11y run --update-baseline` on main.');
}
