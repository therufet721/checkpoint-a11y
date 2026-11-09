import { flow } from '@checkpoint-a11y/runner';

flow('checkout', async ({ page, a11y }) => {
  await page.goto('/');
  await a11y.checkpoint('home');

  await page.goto('/products/blue-shirt');
  await a11y.checkpoint('product page');

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await a11y.checkpoint('cart drawer open');

  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Continue' }).click();
  await a11y.checkpoint('checkout with validation errors');
});
