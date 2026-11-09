# Contributing

```bash
pnpm install
pnpm --filter @checkpoint-a11y/runner exec playwright install chromium
pnpm build
pnpm test
```

False positives are the most valuable reports you can send. Please include the rule id, the HTML snippet, what you expected and, if you can, a minimal HTML page that reproduces it. Fixtures live in `packages/runner/test/fixtures`.
