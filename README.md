# Ambulanzsystem V1

Digital support system for Johanniter Wien event ambulance operations: operation
scenes, QR-based responder/patient intake, START triage recording, situation-room
overview, and a paper-mirror digital Ambulanzprotokoll (page 1).

## Spin up a demo/dev instance

Run through in order. Each step assumes the previous one is still running.

- [ ] **Database** — `docker compose up -d db` (Postgres on host port `5434`; override
      with `DB_HOST_PORT`/`DB_PASSWORD` env vars if that port is taken).
- [ ] **Backend** — `cd backend && dotnet run --project src/Ambulanzsystem.Api`
      (applies EF migrations and seeds on startup). Serves `http://localhost:5042`,
      Swagger UI at `/swagger`.
  - Development seeding (`appsettings.Development.json`) creates `admin` /
    `dev-admin-password` and a demo responder `responder-demo` / `responder-demo`,
    plus sample scene data (`Bootstrap:SeedDevSampleData`).
- [ ] **Frontend** — `cd frontend && npm install && npm start` — serves
      `http://localhost:4200`, proxies `/api` and `/hubs` (SignalR) to the backend
      via `proxy.conf.json`.
- [ ] **Log in** — open `http://localhost:4200`, sign in as `admin` (or
      `responder-demo` for the responder flow).

Only the frontend dev server needs restarting after Angular changes; backend changes
need `dotnet run` restarted (or `dotnet watch run`).

### Admin login not working?

`admin` / `dev-admin-password` is only seeded on a **first** startup against an
**empty** `Users` table — `dotnet run` reseeds nothing on later runs. In order of
likelihood:

- [ ] **First load after a production build on `localhost:4200`.** Development startup now
      unregisters stale service workers and deletes their caches automatically. Reload once
      if the old worker controlled the initial navigation; no manual DevTools cleanup should
      be needed.
- [ ] **Stale backend/frontend process still holding the port.** A leftover
      `dotnet run` or `ng serve` from an earlier attempt keeps serving old code/data
      while the new one fails to bind (or you don't notice it didn't restart).
      Check and kill: `ss -ltnp | grep -E ':4200|:5042'`.
- [ ] **Reused Postgres volume from a previous demo.** If the admin password was
      already changed (forced first-login change) or `Bootstrap:AdminPassword` was
      customized on an earlier run, `dev-admin-password` no longer matches — the
      seeder only runs once per volume. Reset: `docker compose down -v && docker
      compose up -d db`, then restart the backend to reseed fresh.
- [ ] **Browser Network tab** — check the `POST /api/admin-login` response. `401`
      means the credentials genuinely don't match (see above); a request stuck
      pending or a CORS/network error points at the backend not being reachable
      through the frontend proxy at all.

### Mock API only (frontend work before/without a live backend)

```sh
cd contract && npm install && npm run mock   # serves http://localhost:4010
```

## Contract rules

- `contract/openapi.yaml` is the single source of truth for the API. Generated
  clients only — no hand-written endpoint URLs in the frontend.
- Contract changes after sync point S1 are explicit, reviewed edits to `contract/`
  before any implementation change.
- Canonical triage values: `rot | gelb | gruen | schwarz` (ASCII; UI displays `grün`).
- Body-map region keys come from `contract/body-regions.json` — never inferred from
  API responses.
