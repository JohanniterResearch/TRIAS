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
| Production smoke | 18.80 s | pass, 2026-07-29 |
| Backup | 1.64 s | pass, PostgreSQL custom format |
| Isolated restore | 1.09 s | pass: 1 scene, 1 patient, 1 export, 5 audit rows |
| Internal demo | not-run | Record operator start/end and observations. |
| Supervised exercise | blocked | Requires G1-G6 and G8 signatures. |
