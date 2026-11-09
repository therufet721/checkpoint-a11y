// End-to-end demo of the "no new debt" gate:
//   1. build the shop, record the baseline (main branch)
//   2. build it again with a regression (a pull request), run the gate, see it fail on the new issue only
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Call the built CLI directly. npx would fall back to the npm registry if the workspace link is missing,
// and its failure exit code (1) is indistinguishable from "gate failed".
const CLI = path.resolve('node_modules/@checkpoint-a11y/runner/dist/cli.js');
if (!fs.existsSync(CLI)) {
  console.error(`Runner not built (${CLI} missing). Run \`pnpm build\` at the repo root first.`);
  process.exit(1);
}

const run = (cmd, args, env = {}) => {
  console.log(`\n$ ${[cmd, ...args].join(' ')}`);
  return spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } }).status;
};
const must = (code, what) => {
  if (code !== 0) { console.error(`\n${what} failed (exit ${code}).`); process.exit(1); }
};

async function withPreview(fn) {
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch('http://localhost:4173'); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  try { return await fn(); } finally { server.kill(); }
}

must(run('npx', ['vite', 'build', '--logLevel', 'warn'], { CHECKPOINT_A11Y: '1' }), 'Build');
const baselineCode = await withPreview(() => run('node', [CLI, 'run', '--update-baseline', '--offline']));
must(baselineCode, 'Baseline run');

console.log('\n──────── simulating a pull request that adds a promo banner ────────');
must(run('npx', ['vite', 'build', '--logLevel', 'warn'], { CHECKPOINT_A11Y: '1', VITE_REGRESSION: '1' }), 'Regression build');
const code = await withPreview(() => run('node', [CLI, 'run', '--offline']));
console.log(`\nGate exit code: ${code} (1 means the PR is blocked)`);
if (code !== 1) {
  console.error('Expected the gate to block the regression build (exit code 1).');
  process.exit(1);
}
