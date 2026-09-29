// scripts/generate-shell-manifest.mjs replaces the placeholder with a hash of the build, so every
// deploy installs a new worker and drops the previous shell cache.
const cacheName = 'ambulanzsystem-shell-__BUILD_HASH__';
const shell = ['/', '/index.html', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then(async (cache) => {
    const index = await fetch('/index.html');
    // Never install a shell built from an error page (e.g. a proxy 502 during a deploy).
    if (!index.ok) throw new Error(`index.html: HTTP ${index.status}`);
    const manifest = await fetch('/shell-manifest.json').then((response) => response.json());
    await cache.put('/index.html', index);
    await cache.addAll([...new Set([...shell.filter((path) => path !== '/index.html'), ...manifest])]);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET'
    || url.origin !== location.origin
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/hubs/')
    || url.pathname === '/health'
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  // Contract-owned runtime data is intentionally non-hashed. Prefer the network so a
  // deployment can update it without waiting for a shell cache-name change, but retain the
  // last validated response for offline use.
  if (url.pathname === '/body-regions.json') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(cacheName);
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          return caches.match(request);
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      // Only keep real assets: an error, or the SPA fallback's index.html served for a missing
      // chunk, would otherwise be replayed for that URL forever.
      const type = response.headers.get('content-type') ?? '';
      if (response.ok && !type.includes('text/html')) {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
