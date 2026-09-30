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

test('service worker bypasses dynamic endpoints', async ({ page }) => {
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

    return {
      healthCached: Boolean(await cache.match(healthUrl)),
      hubCached: Boolean(await cache.match(hubUrl)),
    };
  });

  expect(result.healthCached).toBe(false);
  expect(result.hubCached).toBe(false);
});

test('service worker uses a build-versioned cache and never caches fallback HTML as an asset', async ({
  page,
}) => {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();

  const result = await page.evaluate(async () => {
    const cacheName = (await caches.keys()).find((name) =>
      name.startsWith('ambulanzsystem-shell-'),
    )!;
    // The dist server answers a missing chunk with index.html (200, text/html), like the API's
    // SPA fallback does after a deploy removed an old chunk.
    const missing = `/missing-chunk-${Date.now()}.js`;
    await fetch(missing);
    const cache = await caches.open(cacheName);
    return { cacheName, missingCached: Boolean(await cache.match(missing)) };
  });

  expect(result.cacheName).toMatch(/^ambulanzsystem-shell-[0-9a-f]{16}$/);
  expect(result.missingCached).toBe(false);
});
