# Ambulanzsystem Backend

ASP.NET Core / EF Core / PostgreSQL.

## Run (dev)

```sh
docker compose up -d db
cd backend
dotnet run --project src/Ambulanzsystem.Api
```

Migrations and seeding run automatically on startup before the app serves traffic.

## Tests

```sh
docker compose up -d db
cd backend && dotnet test
```

Integration tests run against the same dev Postgres instance (not hermetic — shared DB
state across runs, see test file comments).
