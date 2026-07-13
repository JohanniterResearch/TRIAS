const cacheName = 'ambulanzsystem-shell-v2';
const shell = ['/', '/index.html', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then(async (cache) => {
    const index = await fetch('/index.html');
    const html = await index.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map((match) => match[1]);
    await cache.put('/index.html', index);
    await cache.addAll([...new Set([...shell.filter((path) => path !== '/index.html'), ...assets])]);
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
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(cacheName).then((cache) => cache.put(request, copy));
      return response;
    })),
  );
});
