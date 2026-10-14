// Service worker registration (parity plan WP 6.2), as in the Ambulanzsystem client.
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
    // The first install also claims the page; only a replaced worker means a new deploy.
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) showUpdateBanner();
    });
    return;
  }
  // ponytail: a worker from an earlier production build on this origin (e.g. `vite preview` on
  // the same port) survives dev-server restarts and serves stale chunks. Dev never wants one:
  // unregister it and drop its caches, which survive unregister() on their own.
  void navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => void registration.unregister()));
  void globalThis.caches?.keys().then((keys) => keys.forEach((key) => void caches.delete(key)));
}

// Not an automatic reload: the user may be mid-form. Unsent writes are already in IndexedDB.
function showUpdateBanner(): void {
  if (document.querySelector('.update-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.textContent = 'Eine neue Version ist verfügbar. ';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Neu laden';
  button.addEventListener('click', () => window.location.reload());
  banner.append(button);
  document.body.append(banner);
}
