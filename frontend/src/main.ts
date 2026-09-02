import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

if ('serviceWorker' in navigator) {
  if (environment.production) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
  } else {
    // ponytail: a service worker registered by an earlier production build on this same
    // origin/port (e.g. `ng serve --configuration production`, or the prod Docker image on
    // :4200) survives across dev-server restarts and hijacks its navigation/chunk requests —
    // symptom: routes appear stuck, POSTs fail with ERR_CONNECTION_REFUSED. Dev mode never
    // wants a service worker, so clean up any stale one on every load instead of requiring a
    // manual DevTools unregister. Unregistering alone isn't enough — its Cache Storage entries
    // (cacheName 'ambulanzsystem-shell-v3' in public/sw.js) survive unregister() and get reused
    // the moment anything re-registers a worker with that same name, so drop the caches too.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((reg) => reg.unregister()));
    caches?.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
  }
}
