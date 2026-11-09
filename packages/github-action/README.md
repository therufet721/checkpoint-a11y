# Checkpoint A11y GitHub Action

```yaml
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
      - run: CHECKPOINT_A11Y=1 npm run build && (npm start &) && npx wait-on http://localhost:3000
      - uses: <owner>/checkpoint-a11y/packages/github-action@v1
        with:
          token: ${{ secrets.CHECKPOINT_A11Y_TOKEN }}   # omit for local mode
          api-url: https://api.checkpoint-a11y.example
```

In local mode (no token) the baseline lives in `.checkpoint-a11y/baseline.json`. Commit it from the default branch so pull requests compare against it. Changes to it then show up in code review.
