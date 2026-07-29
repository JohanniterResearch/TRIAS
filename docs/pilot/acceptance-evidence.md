# Pilot Acceptance Evidence

Allowed status values: `automated/pass`, `manual/pass`, `blocked`, `not-run`.

## Functional acceptance

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
| Concurrent scans of the same patient QR create no duplicate patient. | not-run | Sequential duplicate proof passes; concurrent backend proof belongs to Stream A. |
| Responder can complete triage. | automated/pass | Real-backend triage story. |
| Triage correction is possible and audit-logged. | blocked | Audit detail is owned by Stream A and awaits integration. |
| Responder can mark body parts. | automated/pass | Real-backend body-region toggle story. |
| Situation room shows patients for the selected operation scene. | automated/pass | Two-browser realtime story. |
| Situation room shows teams with optional status. | not-run | UI fields exist; real team edit was not exercised. |
| Situation room rows open the correct patient Ambulanzprotokoll. | automated/pass | Click and Enter assertions in forced-change/navigation story. |
| Patient A and patient B have isolated Ambulanzprotokoll records. | not-run | Backend integration suite not run in this stream. |
| Refresh restores the current Ambulanzprotokoll draft. | automated/pass | Offline identity/draft restart story. |
| Offline edits survive and sync after reconnect. | not-run | Triage replay and draft rebinding pass separately; end-to-end server-state replay evidence is still required. |
| Offline patient creation syncs after reconnect. | automated/pass | Provisional ID becomes a positive server ID. |
| Finalization succeeds with partial data. | automated/pass | Real-backend protocol story. |
| Leitstelle/Admin can correct finalized forms. | blocked | Scene/ownership authorization is owned by Stream A. |
| JSON export matches the default-state schema. | not-run | Contract/static checks pass; export content comparison not run. |
| Print preview preserves page-1 section placement and readability. | not-run | Automated A4/layout assertions pass; print readability still requires a manual check. |

## Safety acceptance

| Criterion | Status | Evidence |
|---|---|---|
| No major page-1 section moves between tablet and laptop. | not-run | The 800 px assertion passes; a laptop-width comparison was not run. |
| Visible paper labels and abbreviations are preserved. | automated/pass | `npm run check:protocol`. |
| Checkbox order matches the paper-oriented spec. | automated/pass | `npm run check:protocol`. |
| Body map, GCS, measures, AMPLE, and disposition remain on the same page. | automated/pass | `npm run check:protocol` and production build. |
| Draft mode never blocks emergency documentation due to missing fields. | automated/pass | Partial finalization story. |
| Invalid external input is rejected at trust boundaries. | blocked | Stream A validation tests await integration. |
| Production rejects insecure default bootstrap configuration. | automated/pass | Required-variable Compose interpolation and production startup validation passed. |

## Test acceptance

| Criterion | Status | Evidence |
|---|---|---|
| Unauthorized API access returns unauthorized. | blocked | Revoked QR currently returns 200 on baseline; Stream A must make it 401. |
| Admin-only endpoints reject responder sessions. | not-run | Backend integration suite not run in this stream. |
| Page-1 first GET returns default draft for existing patient without form. | not-run | Backend integration suite not run in this stream. |
| Page-1 PUT/GET roundtrip preserves nested JSON. | not-run | Backend integration suite not run in this stream. |
| Page-1 records are isolated per patient. | not-run | Backend integration suite not run in this stream. |
| Finalize with partial form succeeds. | automated/pass | Real-backend protocol story. |
| Every page-1 bind path exists in the default state. | automated/pass | `npm run check:protocol`. |
| Every page-1 bind path survives backend roundtrip unchanged. | not-run | Backend integration suite not run in this stream. |
| Existing triage/body workflows continue to work. | automated/pass | Real-backend triage/body Playwright story. |
| Situation room row click and keyboard activation open page 1. | automated/pass | Click and Enter assertions. |
| Offline/local draft selection chooses newer local or server record by timestamp. | automated/pass | Restart-safe provisional-to-real draft story. |

## Additional S2-S5 evidence

| Criterion | Status | Evidence |
|---|---|---|
| Admin forced password change completes and the new password works. | automated/pass | Focused Playwright story passed. |
| Refresh succeeds for a real responder credential. | automated/pass | Refresh endpoint assertion passed. |
| Self-cancel revokes the live responder token. | automated/pass | Post-cancel validation returns 401. |
| Admin revocation immediately invalidates a QR session. | blocked | Regression assertion receives 200 on baseline; requires Stream A live QR revalidation. |
| Marker activation opens the correct protocol and Back restores scene context. | automated/pass | Focused Leaflet/navigation story passed. |
| Application restart retains the rebound protocol draft. | automated/pass | New page in the same browser context restores the real-ID draft. |
| Situation-room reconnect performs a full snapshot refetch. | automated/pass | The command browser disconnects while a patient is created, then receives that missed patient from the rejoined scene snapshot. |
| Production image serves the Angular shell and preserves API/health routing. | automated/pass | Isolated production smoke passed on 2026-07-29. |
| Backup restores into an isolated database with required evidence. | automated/pass | Restore matched the named smoke scene and patient plus their export and audit rows. |
