# Internal Demo Runbook (pilot step 1 of demo → exercise → festival)

## Setup (one laptop, ~10 minutes)

```sh
docker compose -p ambulanz-demo up -d db
cd backend && dotnet run --project src/Ambulanzsystem.Api   # dev mode: migrates, seeds, serves
cd frontend && npm start                                    # http://localhost:4200
```

Dev seeding (`Bootstrap__SeedDevSampleData=true`, on by default in
`appsettings.Development.json`) creates:

- Admin `admin` / `dev-admin-password` (forced password change on first login)
- Responder `responder-demo` / `responder-demo`
- Scene "Demo-Event Wien" with 4 patients (one per triage color, geolocated in central Vienna)

## Demo script (~15 minutes)

1. **Admin flow** — log in as `admin`, complete the forced password change. Show scene
   list, create a sub-site under "Demo-Event Wien", generate a batch of patient QR codes
   and one responder login QR (printable sheet).
2. **Responder intake** — log in as `responder-demo` (or scan the responder QR on a
   phone), select the demo scene. Scan a patient QR → patient created. Scan the same code
   again on a second device → same patient, no duplicate.
3. **Triage** — set triage color, respiration, bleeding; mark body regions; capture
   location. Show that `blau` is not offered and corrections are possible.
4. **Ambulanzprotokoll** — open page 1 from the patient, fill a few fields, autosave,
   finalize with partial data (warnings, no block), export JSON (note the watermark).
5. **Situation room** — second browser window as admin: live patient table, triage counts,
   map markers. Change a triage color on the responder device → row updates without refresh.
6. **Offline** — airplane-mode the responder device, create a manual patient + edit a
   draft, reconnect → both sync; show the sync-status indicator.

## Reset between demos

```sh
docker compose -p ambulanz-demo down -v
docker compose -p ambulanz-demo up -d db   # wipes only the demo pgdata; backend reseeds on next start
```

## Rehearsal record

| Exercise | Actual | Result |
|---|---:|---|
| Production smoke (`deploy/scripts/smoke.sh`) | ~60 s | local pass 2026-09-29, archive-built image |
| Backup + non-destructive restore check | ~10 s | local pass 2026-09-29 (install-shaped scratch folder) |
| Real host: deploy, TLS via NPMplus, WebSocket, token-log check, rollback | not-run | Needs the LXC deploy of this release. |
| Proxmox Backup Server job + PBS restore to a test VMID | not-run | Proxmox admin. |
| Internal demo | not-run | Record operator start/end and observations. |
| Supervised exercise | blocked | Requires G1-G6 and G8 signatures. |

## Production host acceptance

Run these on the real host (through NPMplus, `https://<public-name>`) after each deploy and before
any supervised exercise. Operating details are in `deploy/README.md`.

1. `curl -fsS https://<public-name>/health` returns JSON with `status=healthy`, `database=healthy`.
2. `curl -sSI https://<public-name>/situation-room` (no `--compressed`) returns
   `Content-Type: text/html`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
3. `curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"role":"admin"}' https://<public-name>/api/dev-login`
   returns `404`.
4. Admin login, scene creation, patient creation and protocol export succeed through the public name.
5. Two browsers show live SignalR propagation; stopping the backend for 2 minutes switches the
   situation room to polling and it returns to `live` afterwards.
6. `scripts/verify-signalr-token-logging.sh` passes against the NPMplus access log.
7. `systemctl list-timers ambulanz-backup.timer` shows the next run; `sudo bash scripts/backup.sh`
   and `sudo bash scripts/verify-restore.sh backups/<newest>.dump` pass.
8. Record the image tag (`VERSION`), operator, date and deviations in the rehearsal record above.
