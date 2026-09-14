const cacheName = 'ambulanzsystem-shell-v4';
const shell = ['/', '/index.html', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then(async (cache) => {
    const index = await fetch('/index.html');
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
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
      return response;
    })(),
  );
});
