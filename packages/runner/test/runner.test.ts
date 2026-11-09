import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowResult, IssueOccurrence } from '@checkpoint-a11y/core';
import { resolveConfig, type RunState } from '../src/config';
import { runFlow } from '../src/run';

const FIXTURES = path.join(__dirname, 'fixtures');
let server: http.Server;
let baseURL: string;
let browser: Browser;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ca11y-test-'));

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, (req.url ?? '/').split('?')[0]!.replace(/^\//, '') || 'good.html');
    if (!fs.existsSync(file)) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': 'text/html' }).end(fs.readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

function config() {
  const c = resolveConfig({ baseURL, outputDir: out, help: ['a[href="/help"]'] }, out);
  fs.mkdirSync(path.join(c.resultsDir, 'artifacts'), { recursive: true });
  return c;
}

async function scan(page: string, extra?: (p: import('playwright').Page) => Promise<void>): Promise<{ result: FlowResult; issues: IssueOccurrence[] }> {
  const cfg = config();
  const state: RunState = { codeowners: [], helpOrders: [] };
  const result = await runFlow(
    browser,
    {
      name: `scan ${page}`,
      options: {},
      fn: async ({ page: p, a11y }) => {
        await p.goto(`/${page}`);
        if (extra) await extra(p);
        await a11y.checkpoint('page');
      },
    },
    cfg,
    state,
    cfg.viewports[0]!,
    false,
  );
  if (result.error) throw new Error(result.error);
  return { result, issues: result.checkpoints.flatMap((c) => c.issues) };
}

const rules = (issues: IssueOccurrence[]) => [...new Set(issues.map((i) => i.ruleId))].sort();

describe('runner against real pages', () => {
  it('finds the planted problems on the bad page', async () => {
    const { issues, result } = await scan('bad.html');
    const found = rules(issues);
    for (const expected of [
      'button-name',
      'image-alt',
      'ca11y-focus-not-visible',
      'ca11y-keyboard-unreachable',
      'ca11y-error-not-associated',
      'ca11y-auth-paste-blocked',
      'ca11y-reflow',
      'ca11y-dialog-focus-not-moved',
      'ca11y-focus-obscured',
    ]) {
      expect(found, `expected ${expected} in ${found.join(', ')}`).toContain(expected);
    }
    expect(result.checkpoints[0]!.skipped ?? []).toEqual([]);
  }, 60_000);

  it('attributes issues to stamped components', async () => {
    const { issues } = await scan('bad.html');
    const buttonName = issues.find((i) => i.ruleId === 'button-name')!;
    expect(buttonName.attribution).toMatchObject({ method: 'build-plugin', component: 'IconButton', sourcePath: 'src/ui/IconButton.tsx', line: 5 });
    const ghost = issues.find((i) => i.ruleId === 'ca11y-focus-not-visible' && i.attribution.component === 'GhostButton');
    expect(ghost?.attribution.sourcePath).toBe('packages/ui/src/GhostButton.tsx');
  }, 60_000);

  it('captures evidence', async () => {
    const { issues, result } = await scan('bad.html');
    expect(result.checkpoints[0]!.screenshot).toBeTruthy();
    const withShot = issues.filter((i) => i.screenshot);
    expect(withShot.length).toBeGreaterThan(3);
    expect(fs.existsSync(path.join(out, 'results', withShot[0]!.screenshot!))).toBe(true);
  }, 60_000);

  it('reports no violations on the clean page', async () => {
    const { issues } = await scan('good.html');
    const violations = issues.filter((i) => i.kind === 'violation');
    expect(violations.map((v) => `${v.ruleId}: ${v.selector}`)).toEqual([]);
  }, 60_000);

  it('produces identical fingerprints on a second run', async () => {
    const a = await scan('bad.html');
    const b = await scan('bad.html');
    expect(a.issues.map((i) => i.fingerprint).sort()).toEqual(b.issues.map((i) => i.fingerprint).sort());
  }, 90_000);

  it('detects a keyboard trap', async () => {
    const { issues } = await scan('trap.html');
    expect(rules(issues)).toContain('ca11y-focus-trap');
  }, 60_000);

  it('accepts a correct native modal dialog', async () => {
    const { issues } = await scan('modal-good.html', async (p) => p.click('#open'));
    const found = rules(issues);
    for (const bad of ['ca11y-focus-trap', 'ca11y-dialog-focus-escapes', 'ca11y-dialog-focus-not-moved']) expect(found).not.toContain(bad);
  }, 60_000);

  it('detects focus escaping an aria-modal dialog', async () => {
    const { issues } = await scan('modal-leaky.html', async (p) => p.click('#open'));
    expect(rules(issues)).toContain('ca11y-dialog-focus-escapes');
    expect(rules(issues)).not.toContain('ca11y-dialog-focus-not-moved');
  }, 60_000);
});
