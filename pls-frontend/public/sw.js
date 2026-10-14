// App shell for offline use (parity plan WP 6.2), ported from the Ambulanzsystem client.
// scripts/generate-shell-manifest.mjs replaces the placeholder with a hash of the build, so every
// deploy installs a new worker and drops the previous shell cache.
const cacheName = 'pls-shell-__BUILD_HASH__';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then(async (cache) => {
    const index = await fetch('/index.html', { cache: 'no-store' });
    // Never install a shell built from an error page (e.g. a proxy 502 during a deploy).
    if (!index.ok) throw new Error(`index.html: HTTP ${index.status}`);
    const manifest = await fetch('/shell-manifest.json', { cache: 'no-store' }).then((response) => response.json());
    await cache.put('/index.html', index);
    await cache.addAll(manifest);
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
  // Never cached: the API, the realtime hub and the health check always go to the network.
  if (
    request.method !== 'GET'
    || url.origin !== location.origin
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/hubs/')
    || url.pathname === '/health'
  ) {
    return;
  }

  // Pages: network first, the cached shell when offline or when the proxy answers for a missing
  // backend (5xx); the SPA router takes over.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => (response.status >= 500 ? (await caches.match('/index.html')) ?? response : response))
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Hashed assets: cache first.
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
