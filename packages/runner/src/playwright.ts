/**
 * Use Checkpoint A11y inside an existing @playwright/test suite:
 *
 *   import { test, expect } from '@checkpoint-a11y/runner/playwright';
 *   test('checkout', async ({ page, a11y }) => {
 *     await page.goto('/cart');
 *     await a11y.checkpoint('cart');
 *   });
 *
 * Then run `npx playwright test && npx checkpoint-a11y gate`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test as base } from '@playwright/test';
import type { FlowResult } from '@checkpoint-a11y/core';
import { A11y } from './checkpoint';
import { loadConfig, newRunState, type ResolvedConfig, type RunState } from './config';

let shared: Promise<{ config: ResolvedConfig; state: RunState }> | undefined;
function setup() {
  shared ??= loadConfig(process.env.CHECKPOINT_A11Y_CWD ?? process.cwd(), process.env.CHECKPOINT_A11Y_CONFIG).then(async (config) => {
    await fs.mkdir(path.join(config.resultsDir, 'flows'), { recursive: true });
    await fs.mkdir(path.join(config.resultsDir, 'artifacts'), { recursive: true });
    return { config, state: newRunState(config) };
  });
  return shared;
}

const fileSafe = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80);

export const test = base.extend<{ a11y: A11y }>({
  a11y: async ({ page }, use, testInfo) => {
    const { config, state } = await setup();
    const vp = page.viewportSize() ?? { width: 1280, height: 800 };
    const projectName = testInfo.project.name || 'default';
    const flowName = testInfo.titlePath.slice(1).join(' › ');
    const multiProject = (testInfo.config.projects?.length ?? 1) > 1;
    const a11y = new A11y({
      page,
      flow: flowName,
      viewport: { name: projectName, width: vp.width, height: vp.height },
      qualifyByViewport: multiProject,
      config,
      state,
    });
    const started = Date.now();
    await use(a11y);
    if (!a11y.checkpoints.length) return;
    const result: FlowResult = {
      name: flowName,
      file: path.relative(config.rootDir, testInfo.file),
      status: testInfo.status === 'passed' || testInfo.status === 'skipped' ? 'passed' : 'error',
      error: testInfo.error?.message,
      durationMs: Date.now() - started,
      checkpoints: a11y.checkpoints,
    };
    const name = `${fileSafe(flowName)}--${fileSafe(projectName)}.json`;
    await fs.writeFile(path.join(config.resultsDir, 'flows', name), JSON.stringify(result, null, 2));
  },
});

export { expect } from '@playwright/test';
