import { expect, test } from '@playwright/test';

test('production app shell reloads offline after first visit', async ({ context, page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'QR Login' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'QR Login' })).toBeVisible();
});
