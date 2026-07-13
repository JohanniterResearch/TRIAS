# Ambulanzsystem Backend

ASP.NET Core / EF Core / PostgreSQL. See `docs/plan/backend-flow-claude.md` for the stage plan.

## Run (dev)

```sh
docker compose up -d db
cd backend
dotnet run --project src/Ambulanzsystem.Api
```

Migrations and seeding run automatically on startup before the app serves traffic.

## Run (prod)

```sh
JWT_SECRET=<32+ char secret> \
BOOTSTRAP_ADMIN_PASSWORD=<password> \
PLS_ALLOWED_ORIGINS=https://your-frontend.example \
docker compose --profile prod up -d --build
```

Startup fails fast (`Config/StartupValidation.cs`) if any of these are missing, or if
`Features:EnableDevLogin` is true in production.

## Tests

```sh
docker compose up -d db
cd backend && dotnet test
```

Integration tests run against the same dev Postgres instance (not hermetic — shared DB
state across runs, see test file comments).

## Backup / restore (NFR-OPS-05)

Data lives entirely in the `pgdata` Docker volume.

Backup:

```sh
docker compose exec db pg_dump -U pls -F c ambulanzsystem > backup-$(date +%Y%m%d).dump
```

Restore onto a fresh volume:

```sh
docker compose up -d db
docker compose exec -T db pg_restore -U pls -d ambulanzsystem --clean --if-exists < backup-20260713.dump
```

`--clean --if-exists` drops conflicting objects before restoring, so this is safe to run
against a db that already has the (empty) schema from the app's own migration-on-startup.
