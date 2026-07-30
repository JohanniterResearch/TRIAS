# Pilot Operations Guide

## Production configuration

The Linux host needs Docker Compose and an existing TLS reverse proxy. Set all required
values explicitly:

```sh
export COMPOSE_PROJECT_NAME=ambulanz-production
export BACKEND_IMAGE=ambulanzsystem-backend:2026-07-30
export DB_PASSWORD='<database password>'
export JWT_SECRET='<at least 32 random characters>'
export BOOTSTRAP_ADMIN_PASSWORD='<bootstrap Admin password>'
export PLS_ALLOWED_ORIGINS='https://ambulanz.example'
export APP_HOST_PORT=5000
export DB_HOST_PORT=5434

docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile prod build backend
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile prod up -d
```

The production overlay disables DEV login and demo seeding. The bootstrap Admin is the
only expected initial account after Stream A is integrated. In production the backend and
database both bind only to `127.0.0.1`, so the host reverse proxy is the only intended
public entrypoint.

## Reverse proxy

TLS terminates at the existing same-host proxy. Forward the original scheme and host, proxy
ordinary HTTP requests to `127.0.0.1:${APP_HOST_PORT}`, and allow WebSocket upgrades for
`/hubs/scene`. Monitor `GET /health`; do not rewrite `/api`, `/hubs`, or `/health` to the
Angular shell. Both application and database ports are bound to loopback. ASP.NET Core
trusts forwarded headers from the loopback proxy by default; configure explicit known
proxy addresses if the proxy runs elsewhere. A copy-ready host sample lives in
`docs/pilot/nginx.conf.example`; replace every `OWNER_SET_*` placeholder before use.

## Monitoring defaults

Use these initial thresholds until named operational owners approve replacements:

- Poll `https://OWNER_SET_FQDN/health` every 60 seconds; alert critical after three
  consecutive failures.
- Alert on any unexpected backend or database container restart.
- Alert when API 5xx responses exceed 2% for five minutes with at least 20 requests.
- Warn at 80% disk usage and alert critical at 90%.
- Alert on any backup failure or when the newest successful backup is older than 26 hours.
- Warn when the TLS certificate has fewer than 30 days remaining and alert critical below
  14 days.

After Admin login, use `GET /api/metrics` to inspect `dbErrors`,
`realtimePendingQueue`, and `realtimeDroppedMessages` before and after an exercise.
Inspect `docker compose ... logs backend db` for every failed deploy, non-200 health result,
or unexpected container restart. The owner must still supply the notification recipient and
escalation path before any real-data pilot.

Default owner placeholders that still require host-side completion:

- `OWNER_SET_FQDN`
- `OWNER_SET_APP_HOST_PORT`
- `OWNER_SET_ALERT_TARGET`
- `OWNER_SET_LOG_RETENTION`

## Smoke

The smoke script uses only its Compose project, builds the production image, waits for
health, loads the Angular shell, checks security headers and DEV-login absence, changes
the isolated bootstrap password, performs authenticated requests, and creates synthetic
scene/patient/protocol/export/audit evidence.

```sh
export COMPOSE_PROJECT_NAME=ambulanz-smoke-$(date +%Y%m%d%H%M%S)
./scripts/pilot-smoke.sh
```

It refuses an existing project volume, stops its containers, and keeps its named database
volume for the restore drill.

## Backup and isolated restore drill

With the same environment values and Compose project used for smoke:

```sh
./scripts/backup.sh /tmp/ambulanz-pilot.dump
./scripts/verify-restore.sh /tmp/ambulanz-pilot.dump
```

Backups use PostgreSQL custom format and are created with owner-only permissions. Restore
verification creates a temporary database inside the same PostgreSQL container and checks
the named smoke scene and patient plus their protocol export and audit evidence. It drops
only that temporary database afterward. Retained dumps must use encrypted, access-controlled
storage. The repository scripts stop at the dump file; encryption destination, key
ownership, retention, and off-host replication remain explicit owner-supplied settings.

## Deploy, compatibility, and rollback

Use one immutable backend image tag per rollout and keep the previous accepted tag until the
next drill completes.

1. Build or refresh the candidate image tag:

```sh
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile prod build backend
```

2. Before replacing the live stack, run the minimum isolated compatibility drill on a fresh
   Compose project with the candidate image and an approved rehearsal dump:

```sh
export COMPOSE_PROJECT_NAME=ambulanz-compat-$(date +%Y%m%d%H%M%S)
export BACKEND_IMAGE=ambulanzsystem-backend:2026-07-30
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile prod up -d
./scripts/verify-restore.sh /path/to/approved-rehearsal.dump
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile prod down -v
```

   This proves the candidate image can start its own stack and that the rehearsal dump still
   restores cleanly with the current scripts. It does not by itself prove full application
   compatibility with restored production data.
3. Roll forward on the real host only after the acceptance checks in `docs/pilot/runbook.md`
   pass against the actual FQDN.
4. Roll back by re-exporting the previous accepted `BACKEND_IMAGE` tag and starting the prod
   profile without `--build` and without `-v`. Do not delete the production `pgdata` volume
   during rollback.
5. If the candidate image has already run database migrations, authorize rollback only after
   confirming the previous image is schema-compatible with the migrated database or after
   restoring an approved encrypted backup into an isolated rehearsal environment first.
6. Rollback authorization must come from named owners before touching a real-data pilot host:
   `OWNER_SET_TECHNICAL_APPROVER`, `OWNER_SET_MEDICAL_APPROVER`, and
   `OWNER_SET_DATA_PROTECTION_APPROVER`.

After the drill, remove only the smoke project:

```sh
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile prod down -v
```

## Timings and owner values

| Exercise | Actual | Evidence |
|---|---:|---|
| Production smoke | 18.80 s | Passed 2026-07-29 in `ambulanz-smoke-2` (cached image build). |
| Backup | 1.64 s | PostgreSQL custom dump passed 2026-07-29. |
| Isolated restore verification | 1.09 s | Named smoke scene/patient, 1 export, and 3 related audit rows matched in the final review. |
| Internal demo | not-run | Owner records start/end. |
| Supervised exercise | blocked | Requires G1-G6 and G8 signatures. |

Owners must supply RPO, RTO, retention, supported devices/browsers, scale limits, and
medical/legal decisions. The scripts do not invent those values.
