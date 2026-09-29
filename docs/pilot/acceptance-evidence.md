# Pilot Acceptance Evidence

Allowed status values: `automated/pass`, `manual/pass`, `blocked`, `not-run`.

## Technical gate — 2026-09-29 (Dev_RH, Tier 1 remediation)

Local/disposable verification on the development machine, not real-host acceptance.

- Backend `dotnet test` against a fresh PostgreSQL 16: 143 passed, 0 failed.
- `contract/`: `npm run lint` 0 errors; `npm run check:generated` clean.
- `frontend/`: `npm test` 121 unit tests + accessibility/auth/protocol checks passed; `check:types`,
  `format:check` passed; `npm run build && npm run check:production` passed.
- `frontend/`: `npm run test:e2e` 12 passed; `npx playwright test --config playwright.offline.config.ts`
  8 passed (incl. versioned service-worker cache and no cached fallback HTML).
- Image built from a clean `git archive` of HEAD; `deploy/scripts/smoke.sh` passed against it
  (proxy-mode Caddy stack: health, uncompressed SPA Content-Type, security headers, dev-login 404,
  forced password change, scene/patient/protocol/export).
- `deploy/scripts/backup.sh` + `verify-restore.sh` in an install-shaped scratch folder: backup,
  rotation (`BACKUP_KEEP`), non-destructive restore check passed; wrong deployment ID refused.
- Not yet done: deployment of this state to the LXC, real-device checks, NPMplus token-log check,
  Proxmox Backup Server job and PBS restore drill.

## Integrated technical gate — 2026-07-30 (historical, `pilot/blocker-closure` branch)

- `dotnet test Ambulanzsystem.slnx --no-build`: 63 passed, 0 failed, 0 skipped.
- From `contract/`, `npm run lint && npm run check:generated`: 0 Spectral errors, 83 unchanged
  pre-existing warnings, generated client clean.
- From `frontend/`, `npm test && npm run build`: static checks and production frontend
  build passed.
- From `frontend/`, `npm run test:e2e`: 11 passed, including two-browser SignalR state `live`.
- From `frontend/`, `npm run test:offline`: 1 passed.
- Production Compose config, fresh image build, and `./scripts/pilot-smoke.sh`: passed
  with loopback-only backend/database bindings.
- `./scripts/backup.sh` and `./scripts/verify-restore.sh`: passed; isolated restore
  matched one smoke scene, one patient, one export, and three audit rows.

## Functional acceptance

Last assessed 2026-07-30 on the `pilot/blocker-closure` line. Re-confirm each row against the
current release before the supervised exercise.

| Criterion | Status | Evidence |
|---|---|---|
| Admin can create an operation scene. | not-run | Admin UI exists; not exercised in this stream. |
| Admin can configure responder access windows. | not-run | Admin UI exists; not exercised in this stream. |
| Admin can generate and print responder QR codes. | not-run | Generation is automated; printing still requires a manual check. |
| Admin can generate and print patient QR codes. | not-run | Generation is automated; printing still requires a manual check. |
| Responder can authenticate by QR. | automated/pass | Generated responder QR story. |
| Responder can authenticate by username/password where assigned. | automated/pass | Real `responder-demo` credential story. |
| Responder can select operation scene. | automated/pass | Shared Playwright `selectFirstScene` flow. |
| Responder can scan patient QR. | automated/pass | Generated patient QR story. |
| Responder can manually create a patient without QR. | automated/pass | Real-backend and offline intake stories. |
| A wrongly attached patient QR can be reassigned. | automated/pass | Generated patient QR replacement assertion. |
| First scan creates exactly one patient. | automated/pass | Repeated scan returns the original patient ID. |
| Concurrent scans of the same patient QR create no duplicate patient. | automated/pass | Full backend suite includes the concurrent patient-QR regression. |
| Responder can complete triage. | automated/pass | Real-backend triage story. |
| Triage correction is possible and audit-logged. | automated/pass | Full backend suite covers triage correction history and single-write audit behavior. |
| Responder can mark body parts. | automated/pass | Real-backend body-region toggle story. |
| Situation room shows patients for the selected operation scene. | automated/pass | Two-browser realtime story. |
| Situation room shows teams with optional status. | not-run | UI fields exist; real team edit was not exercised. |
| Situation room rows open the correct patient Ambulanzprotokoll. | automated/pass | Click and Enter assertions in forced-change/navigation story. |
| Patient A and patient B have isolated Ambulanzprotokoll records. | automated/pass | Full backend suite passed the page-1 isolation regression. |
| Refresh restores the current Ambulanzprotokoll draft. | automated/pass | Offline identity/draft restart story. |
| Offline edits survive and sync after reconnect. | automated/pass | Real-backend Playwright covers offline triage replay, server state, restart, and protocol-draft rebinding. |
| Offline patient creation syncs after reconnect. | automated/pass | Provisional ID becomes a positive server ID. |
| Finalization succeeds with partial data. | automated/pass | Real-backend protocol story. |
| Leitstelle/Admin can correct finalized forms. | automated/pass | Full backend authorization/correction suite passed. |
| JSON export matches the default-state schema. | automated/pass | Full backend suite validates default-shaped export and canonical schema reference. |
| Print preview preserves page-1 section placement and readability. | not-run | Automated A4/layout assertions pass; print readability still requires a manual check. |

## Safety acceptance

| Criterion | Status | Evidence |
|---|---|---|
| No major page-1 section moves between tablet and laptop. | not-run | The 800 px assertion passes; a laptop-width comparison was not run. |
| Visible paper labels and abbreviations are preserved. | automated/pass | `npm run check:protocol`. |
| Checkbox order matches the paper-oriented spec. | automated/pass | `npm run check:protocol`. |
| Body map, GCS, measures, AMPLE, and disposition remain on the same page. | automated/pass | `npm run check:protocol` and production build. |
| Draft mode never blocks emergency documentation due to missing fields. | automated/pass | Partial finalization story. |
| Invalid external input is rejected at trust boundaries. | automated/pass | API trust-boundary suite rejects unknown/malformed triage, location, timestamp, and protocol values without side effects. |
| Production rejects insecure default bootstrap configuration. | automated/pass | Required-variable Compose interpolation and production startup validation passed. |

## Test acceptance

| Criterion | Status | Evidence |
|---|---|---|
| Unauthorized API access returns unauthorized. | automated/pass | Full backend suite proves revoked QR and user sessions fail on the next request. |
| Admin-only endpoints reject responder sessions. | automated/pass | Full backend authorization suite passed. |
| Page-1 first GET returns default draft for existing patient without form. | automated/pass | Full backend page-1 acceptance suite passed. |
| Page-1 PUT/GET roundtrip preserves nested JSON. | automated/pass | Recursive page-1 roundtrip test passed. |
| Page-1 records are isolated per patient. | automated/pass | Full backend page-1 isolation test passed. |
| Finalize with partial form succeeds. | automated/pass | Real-backend protocol story. |
| Every page-1 bind path exists in the default state. | automated/pass | `npm run check:protocol`. |
| Every page-1 bind path survives backend roundtrip unchanged. | automated/pass | Recursive canonical-leaf roundtrip test passed. |
| Existing triage/body workflows continue to work. | automated/pass | Real-backend triage/body Playwright story. |
| Situation room row click and keyboard activation open page 1. | automated/pass | Click and Enter assertions. |
| Offline/local draft selection chooses newer local or server record by timestamp. | automated/pass | Restart-safe provisional-to-real draft story. |

## Additional S2-S5 evidence

| Criterion | Status | Evidence |
|---|---|---|
| Admin forced password change completes and the new password works. | automated/pass | Focused Playwright story passed. |
| Refresh succeeds for a real responder credential. | automated/pass | Refresh endpoint assertion passed. |
| Self-cancel revokes the live responder token. | automated/pass | Post-cancel validation returns 401. |
| Admin revocation immediately invalidates a QR session. | automated/pass | Backend session-security suite and Playwright QR story both return 401 after revocation. |
| Marker activation opens the correct protocol and Back restores scene context. | automated/pass | Focused Leaflet/navigation story passed. |
| Application restart retains the rebound protocol draft. | automated/pass | New page in the same browser context restores the real-ID draft. |
| Situation-room reconnect performs a full snapshot refetch. | automated/pass | The command browser disconnects while a patient is created, then receives that missed patient from the rejoined scene snapshot. |
| Production image serves the Angular shell and preserves API/health routing. | automated/pass | Isolated production smoke passed on 2026-07-29. |
| Backup restores into an isolated database with required evidence. | automated/pass | Restore matched the named smoke scene and patient plus their export and audit rows. |
