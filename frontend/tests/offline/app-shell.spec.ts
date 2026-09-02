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

test('service worker bypasses dynamic endpoints and refreshes body-region data', async ({
  page,
}) => {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);

  const result = await page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((name) =>
      name.startsWith('ambulanzsystem-shell-'),
    )!;
    const cache = await caches.open(cacheName);
    const probe = `${Date.now()}-${Math.random()}`;
    const healthUrl = `/health?sw-probe=${probe}`;
    const hubUrl = `/hubs/scene?sw-probe=${probe}`;

    await fetch(healthUrl);
    await fetch(hubUrl);
    await cache.put(
      '/body-regions.json',
      new Response('{"stale":true}', {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const regions = await fetch('/body-regions.json').then((response) => response.json());

    return {
      healthCached: Boolean(await cache.match(healthUrl)),
      hubCached: Boolean(await cache.match(hubUrl)),
      regions,
    };
  });

  expect(result.healthCached).toBe(false);
  expect(result.hubCached).toBe(false);
  expect(result.regions.front).toContain('kopf_vorne');
});
