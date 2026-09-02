import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');

const assertLiveRegion = (path, content, role, live) => {
  assert.match(
    source(path),
    new RegExp(`<[^>]+role=["']${role}["'][^>]+aria-live=["']${live}["'][^>]*>[^<]*${content}`),
    `${path}: ${content} must use role="${role}" and aria-live="${live}"`,
  );
};

for (const path of [
  'auth/pages/admin-login-page.ts',
  'auth/pages/change-password-page.ts',
  'auth/pages/login-page.ts',
  'auth/components/dev-access.development.ts',
  'responder/pages/body-map-page.ts',
  'responder/pages/patient-choice-page.ts',
  'responder/pages/patient-scan-page.ts',
  'responder/pages/role-selection-page.ts',
  'responder/pages/triage-page.ts',
  'shared/qr-scanner.ts',
  'admin/pages/admin-dashboard.ts',
  'situation/pages/situation-room-page.ts',
]) {
  assertLiveRegion(path, '{{ error', 'alert', 'assertive');
}

assertLiveRegion('responder/pages/patient-choice-page.ts', '{{ message', 'status', 'polite');
assertLiveRegion('responder/pages/triage-page.ts', '{{ message', 'status', 'polite');
assertLiveRegion('admin/pages/admin-dashboard.ts', '{{ message', 'status', 'polite');
assertLiveRegion('situation/pages/situation-room-page.ts', '{{ realtimeState', 'status', 'polite');
assertLiveRegion('shared/qr-scanner.ts', 'Kamera aktiv', 'status', 'polite');
assertLiveRegion('protokoll/pages/ambulanzprotokoll-page.ts', '{{ saveState', 'status', 'polite');

const protocol = source('protokoll/pages/ambulanzprotokoll-page.ts');
assert.match(
  protocol,
  /<ul class="form-error" role="alert" aria-live="assertive">/,
  'protocol warnings must be announced assertively',
);

const sync = source('sync/sync-indicator.ts');
assert.match(sync, /role="status" aria-live="polite"/, 'sync status must be announced politely');
assert.match(
  sync,
  /role="alert" aria-live="assertive"/,
  'sync failures must be announced assertively',
);
assert.equal(
  (sync.match(/role="alert"/g) ?? []).length,
  1,
  'sync failures must have exactly one assertive announcement region',
);

console.log('Live-region accessibility checks passed.');
