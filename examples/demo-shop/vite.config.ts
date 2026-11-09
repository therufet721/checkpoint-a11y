import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [
    react({
      babel: {
        // Stamp components only in the CI build. Paths are relative to the repo root so CODEOWNERS matches.
        plugins: process.env.CHECKPOINT_A11Y ? [['@checkpoint-a11y/babel-plugin', { root: repoRoot }]] : [],
      },
    }),
  ],
});
