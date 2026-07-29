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
DB_PASSWORD=<database password> \
JWT_SECRET=<32+ character secret> \
BOOTSTRAP_ADMIN_PASSWORD=<password> \
PLS_ALLOWED_ORIGINS=https://your-frontend.example \
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --profile prod up -d --build
```

Startup fails fast (`Config/StartupValidation.cs`) if any of these are missing, or if
`Features:EnableDevLogin` is true in production. The production image serves the Angular
browser bundle from the API origin; `/api`, `/hubs`, and `/health` remain backend routes.

## Tests

```sh
docker compose up -d db
cd backend && dotnet test
```

Integration tests run against the same dev Postgres instance (not hermetic — shared DB
state across runs, see test file comments).

## Backup / restore (NFR-OPS-05)

Use the rehearsable scripts and instructions in `docs/pilot/operations.md`.
