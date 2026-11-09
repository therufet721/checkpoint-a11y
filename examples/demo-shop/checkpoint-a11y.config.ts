import { defineConfig } from '@checkpoint-a11y/runner';

export default defineConfig({
  baseURL: 'http://localhost:4173',
  // Source paths stamped by the babel plugin and CODEOWNERS are both relative to the repo root.
  rootDir: '../..',
  flows: ['a11y/**/*.flow.ts'],
  viewports: [{ name: 'desktop', width: 1280, height: 800 }],
  gate: { failOn: 'serious' },
  help: ['a[href="/help"]', 'a[href="/contact"]'],
  waivers: [],
});
