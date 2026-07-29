# Pilot Operations Guide

## Production configuration

The Linux host needs Docker Compose and an existing TLS reverse proxy. Set all required
values explicitly:

```sh
export COMPOSE_PROJECT_NAME=ambulanz-production
export DB_PASSWORD='<database password>'
export JWT_SECRET='<at least 32 random characters>'
export BOOTSTRAP_ADMIN_PASSWORD='<bootstrap Admin password>'
export PLS_ALLOWED_ORIGINS='https://ambulanz.example'
export APP_HOST_PORT=5000
export DB_HOST_PORT=5434

docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile prod up -d --build
```

The production overlay disables DEV login and demo seeding. The bootstrap Admin is the
only expected initial account after Stream A is integrated.

## Reverse proxy

TLS terminates at the existing same-host proxy. Forward the original scheme and host, proxy
ordinary HTTP requests to `127.0.0.1:${APP_HOST_PORT}`, and allow WebSocket upgrades for
`/hubs/scene`. Monitor `GET /health`; do not rewrite `/api`, `/hubs`, or `/health` to the
Angular shell. Both application and database ports are bound to loopback. ASP.NET Core
trusts forwarded headers from the loopback proxy by default; configure explicit known
proxy addresses if the proxy runs elsewhere.

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
storage.

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
