# Ambulanzsystem V1

Digital support system for Johanniter Wien event ambulance operations: operation
scenes, QR-based responder/patient intake, START triage recording, situation-room
overview, and a paper-mirror digital Ambulanzprotokoll (page 1).

## Running

Database:

```sh
docker compose up -d db
```

Mock API (frontend development before the real backend exists):

```sh
cd contract && npm install && npm run mock   # serves http://localhost:4010
```

Backend and frontend run instructions land with stages B1 / F1.

Production deployment, smoke, reverse-proxy, backup, and restore instructions are in
[`docs/pilot/operations.md`](docs/pilot/operations.md).

## Contract rules

- `contract/openapi.yaml` is the single source of truth for the API. Generated
  clients only — no hand-written endpoint URLs in the frontend.
- Contract changes after sync point S1 are explicit, reviewed edits to `contract/`
  before any implementation change.
- Canonical triage values: `rot | gelb | gruen | schwarz` (ASCII; UI displays `grün`).
- Body-map region keys come from `contract/body-regions.json` — never inferred from
  API responses.
