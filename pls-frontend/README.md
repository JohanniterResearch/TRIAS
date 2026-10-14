# PLS frontend

React UI of the PLS triage system, running on the Ambulanzsystem backend (`../backend`).

## Canonical specification

`docs/specs/ambulanzprotokoll_page1.json` is authoritative for the protocol page;
`page1SpecAlignment.test.ts` checks the form against it.

## Local development

```sh
docker compose up -d db                                   # repo root, PostgreSQL on 5434
cd backend && dotnet run --project src/Ambulanzsystem.Api # http://127.0.0.1:5042
cd pls-frontend && npm ci && npm run dev                  # Vite proxies /api, /hubs, /health
```

The Development configuration seeds `admin` / `dev-admin-password`, `responder-demo` /
`responder-demo` and the event "Demo-Event Wien" (`Bootstrap:SeedDevSampleData`). Set
`PLS_BACKEND_URL` to proxy to another backend.

## API types and codecs

`src/api/openapi-types.ts` is generated from `../contract/openapi.yaml`; never edit it.

```sh
npm --prefix ../contract run generate:pls        # regenerate
npm --prefix ../contract run check:generated:pls # fail on drift
```

Vocabulary differences are translated in one place each:

- `src/api/codecs/triage.ts`: `gruen` <-> `grün`; `blau` is not writable.
- `src/api/codecs/bodyMap.ts`: PLS drawing regions <-> Ambulanzsystem regions (lossy groups,
  pending clinical sign-off).
- `src/features/ambulanzprotokoll-page1/ambulanzValueMap.ts`: protocol option codes <->
  schema values.

## Verification

`scripts/verify.sh` runs every check (lint, unit tests, build, contract drift, backend tests,
Playwright) and stops on the first failure.
