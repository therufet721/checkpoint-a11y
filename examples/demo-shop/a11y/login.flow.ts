import { flow } from '@checkpoint-a11y/runner';

flow('login', async ({ page, a11y }) => {
  await page.goto('/login');
  await a11y.checkpoint('login form');
});
