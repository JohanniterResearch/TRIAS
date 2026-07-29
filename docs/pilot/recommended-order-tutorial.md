# Pilot Readiness Tutorial

This tutorial turns the recommended pilot-readiness order into concrete repository work.
Follow the phases in order. Do not start a real-patient pilot until every **public-pilot
exit criterion** is satisfied.

The rollout sequence remains:

1. internal demo with synthetic data;
2. supervised exercise;
3. public pilot with real patient data.

## Current Baseline

The current branch already has:

- reproducible OpenAPI lint/type generation and a typed frontend API boundary;
- completed protocol navigation, Admin user-list, team-field, and offline-ID workflows;
- real-stack browser tests for credentials, generated QR flows, forced password change,
  responder triage/protocol, offline replay/rebinding, and situation-room navigation;
- a production offline-shell test;
- a same-origin production image, isolated smoke, and verified backup/restore scripts;
- `docs/pilot/acceptance-evidence.md`, `operations.md`, this tutorial, runbook, and gate list.

The unresolved blockers are:

- Stream A backend security/audit work must be integrated and reviewed;
- the baseline backend still accepts a previously issued JWT after QR revocation;
- explicit situation-room reconnect and concurrent patient-QR browser evidence remain;
- monitoring thresholds and owner decisions remain incomplete;
- G1-G6 and G8 remain blocked until named owners sign.

## Working Rules

Before each phase:

```sh
git status -sb
git switch -c pilot/<short-phase-name>
```

Keep contract changes contract-first. If an HTTP request, response, error code, or schema
changes, update `contract/openapi.yaml` before backend/frontend code. Use one atomic commit
per phase and do not mix gate documents with application changes.

The common validation baseline is:

```sh
docker compose up -d db
cd backend && dotnet test Ambulanzsystem.slnx

cd ../frontend
nvm use 24
npm run test
npm run build
npm run check:production
npm run test:e2e
npm run test:offline

cd ../contract
npm run lint
npm run check:generated
```

## Phase 1: Enforce Scene-Scoped REST Access

### Goal

An Event-A QR or event-scoped responder must not read, modify, export, or reassign Event-B
data. Admin and Leitstelle retain global access. Permanent responders retain the access
defined by the current requirements.

### 1. Add failing integration coverage first

Create `backend/src/Ambulanzsystem.Tests/SceneAccessRestTests.cs` using the existing
`WebApplicationFactory<Program>` pattern from `SceneHubTests.cs`.

The fixture should create:

- two top-level scenes, Event A and Event B;
- one sub-site under Event A;
- patients and teams in both events;
- a responder login QR scoped to Event A;
- one authenticated Event-A QR client.

Prove both sides of the boundary:

- Event-A QR can access Event A and its sub-site;
- Event-A QR receives `403 Forbidden` for Event B.

Cover one request from each authorization shape:

| Shape | Representative request |
|---|---|
| scene query | `GET /api/persons?operationSceneId={eventB}` |
| requested target scene | `POST /api/persons/manual` for Event B |
| existing patient ID | protocol GET/PUT/export for an Event-B patient |
| body record | body-parts GET/PUT for an Event-B patient |
| team record | teams GET/PUT for Event B |
| QR movement | verify/reassign must not move a patient across event boundaries |

Do not write one test per controller method. A compact theory or shared assertion helper is
enough, provided every authorization shape above is represented.

Run the new test and confirm it fails before implementation:

```sh
cd backend
dotnet test Ambulanzsystem.slnx --filter FullyQualifiedName~SceneAccessRestTests
```

### 2. Reuse the existing authorization rule

Use `backend/src/Ambulanzsystem.Api/Auth/SceneAccess.cs` as the single rule. Do not create a
second scene-visibility implementation.

Apply it as follows:

- endpoints receiving `operationSceneId`: check the requested scene before querying or
  creating data;
- patient endpoints: load the patient, then check `patient.OperationSceneId`;
- team endpoints: load the team, then check `team.OperationSceneId`;
- QR verification that moves an existing patient: require access to both the current scene
  and requested target scene before changing either row.

Audit all relevant endpoints rather than only the initially reported ones:

```sh
rg -n 'Authorize\(Policy = AuthPolicies\.TriageWrite\)|operationSceneId|patientId|idpatient' \
  backend/src/Ambulanzsystem.Api/Controllers
```

Return one consistent status for authenticated out-of-scope access. Prefer `403 Forbidden`
unless the contract is deliberately changed to conceal resource existence with `404`.

Expected files:

- `backend/src/Ambulanzsystem.Api/Auth/SceneAccess.cs`
- `backend/src/Ambulanzsystem.Api/Controllers/PersonsController.cs`
- `backend/src/Ambulanzsystem.Api/Controllers/BodyPartsController.cs`
- `backend/src/Ambulanzsystem.Api/Controllers/AmbulanzprotokollController.cs`
- `backend/src/Ambulanzsystem.Api/Controllers/TeamsController.cs`
- `backend/src/Ambulanzsystem.Tests/SceneAccessRestTests.cs`

### 3. Validate and commit

```sh
cd backend
dotnet test Ambulanzsystem.slnx --filter FullyQualifiedName~SceneAccessRestTests
dotnet test Ambulanzsystem.slnx

cd ..
git diff --check
git add backend/src/Ambulanzsystem.Api backend/src/Ambulanzsystem.Tests/SceneAccessRestTests.cs
git commit -m "Enforce scene-scoped REST access"
```

**Exit criterion:** the Event-A negative cases return `403`, same-event/sub-site cases pass,
and the full backend suite remains green.

## Phase 2: Close Authentication and Revocation Gaps

Keep QR revocation and forced-password enforcement in one phase because both belong to the
same server-side session-validity boundary. They may be two commits if reviewed separately.

### 1. Revalidate issued QR sessions

QR tokens already use the login-QR record ID as `sub`. Extend
`SecurityStampValidation.OnTokenValidated`:

1. read the token type;
2. for `qr`, parse `sub` as the `QrCodeLogin` ID;
3. load that record without tracking;
4. reject the token if the record is missing, revoked, or expired;
5. retain the existing security-stamp path for admin/Leitstelle/user tokens.

Add an integration test:

1. generate a responder login QR;
2. log in and verify its JWT can access a protected endpoint;
3. revoke the QR with an admin client;
4. reuse the already-issued JWT;
5. assert `401 Unauthorized`.

This test belongs in `AuthFlowTests.cs` or a narrowly named `QrRevocationTests.cs`.

### 2. Enforce password-change state in the API

The invariant is: a user with `RequiresPasswordChange=true` may change their own password
or end the session, but may not use normal admin/responder APIs.

Implement this once at the authenticated-request boundary. Reuse the user lookup already
performed during token validation; attach a `password_change_required` claim and reject
normal protected requests centrally. Allow only the minimum recovery endpoints, normally:

- `POST /api/users/change-password`;
- `POST /api/logout`;
- optionally `POST /api/validate-token` if the frontend needs it to route correctly.

Do not add checks to every controller.

Harden `UsersController.ChangePassword` at the same time:

- resolve the account from `User.SubjectId()`, not from the submitted username;
- if the username remains in the contract for compatibility, require it to match the
  authenticated account;
- enforce the existing frontend minimum password length on the server;
- keep security-stamp rotation and refresh-token revocation.

Decide whether responder accounts should require a first password change. The current API
sets the flag for every created role, while only admin login returns the flag. Resolve that
contract mismatch before changing response shapes.

Required tests:

- forced-change admin token receives `403` on an admin endpoint;
- forced-change responder behavior matches the owner decision;
- password change for the authenticated account succeeds;
- trying to change another username is rejected;
- the old access and refresh tokens are invalid after success.

### 3. Validate and commit

```sh
cd backend
dotnet test Ambulanzsystem.slnx --filter 'FullyQualifiedName~AuthFlowTests|FullyQualifiedName~QrRevocation'
dotnet test Ambulanzsystem.slnx

cd ..
git diff --check
git add contract/openapi.yaml backend/src/Ambulanzsystem.Api backend/src/Ambulanzsystem.Tests
git commit -m "Enforce server-side session restrictions"
```

Only stage `contract/openapi.yaml` if the contract actually changed.

**Exit criterion:** live QR revocation is immediate, forced-change tokens cannot use normal
APIs, and password changes are bound to the authenticated account.

## Phase 3: Complete High-Signal Pilot Acceptance Coverage

Do not translate every acceptance sentence into its own test. Add the smallest workflows
that prove multiple requirements together.

### Backend integration tests

Add or extend tests for:

1. **Two-device merge:** older and newer timestamps update different protocol/triage fields;
   newer values win conflicts while older non-empty values still fill empty fields.
2. **Export schema:** validate the complete export `formState` against the canonical default
   shape/schema instead of checking only two top-level branches.
3. **Finalized correction:** Admin/Leitstelle correction succeeds and an unrelated responder
   remains forbidden.
4. **Invalid external input:** malformed coordinates, unknown body keys, wrong protocol leaf
   types, and out-of-scope IDs fail without partial writes.

### Browser tests

Extend `frontend/tests/e2e/pilot-flow.spec.ts` with a few end-to-end stories:

1. admin generates a responder QR and patient QR; the rendered QR is non-empty and the
   responder logs in with the generated value;
2. patient QR scan and reassignment reach the correct patient and never duplicate it;
3. situation-room row click and Enter key open the correct protocol;
4. protocol draft survives reload, offline editing, and reconnect replay;
5. reconnect after a missed live update refetches the scene snapshot.

Keep print parity partly manual. Browser automation should verify the print stylesheet,
A4 ratio, required section presence, no overflow, and hidden toolbars. A named medical owner
must still compare labels, order, and placement to the source paper form.

### Coverage ledger

Create `docs/pilot/acceptance-evidence.md` with one row per acceptance criterion from
`docs/project-overview-rebuild-codex.md`:

| Criterion | Evidence | Status | Owner |
|---|---|---|---|
| Example: concurrent QR scan creates one patient | `PatientQrConcurrencyTests` | automated/pass | technical |

Use only `automated/pass`, `manual/pass`, `blocked`, or `not-run`. Do not mark a criterion
complete based only on implementation inspection.

### Validate and commit

```sh
cd backend && dotnet test Ambulanzsystem.slnx
cd ../frontend
npm run test:e2e
npm run test:offline

cd ..
git diff --check
git add backend/src/Ambulanzsystem.Tests frontend/tests docs/pilot/acceptance-evidence.md
git commit -m "Complete pilot acceptance coverage"
```

**Exit criterion:** every master-plan S2-S5 acceptance item has recorded automated or manual
evidence, with no unexplained `not-run` entries.

## Phase 4: Build a Rehearsable Production Path

### 1. Produce one same-origin artifact

The Angular production configuration uses same-origin `/api` and `/hubs` URLs. The smallest
deployment is therefore one container that serves the Angular build and the ASP.NET API.

Extend the existing `backend/Dockerfile` with a Node build stage:

1. install frontend dependencies with `npm ci`;
2. run `npm run build`;
3. copy `frontend/dist/ambulanzsystem-frontend/browser` into the API image at `wwwroot`;
4. enable static files and SPA fallback in `Program.cs`;
5. keep `/api`, `/hubs`, and `/health` mapped normally.

This avoids adding an Nginx container solely to connect two already same-origin components.
TLS should still terminate at the chosen host/reverse proxy; document who owns that layer.

### 2. Remove insecure production defaults

Production must reject:

- the `dev-only-password` database password;
- empty/short JWT secrets;
- empty bootstrap admin password;
- missing allowed origins when cross-origin hosting is used;
- enabled development login/helper features.

Preserve convenient defaults for the development `db` service. Use either a production
compose override or explicit production validation rather than making local development
depend on secrets.

### 3. Add an executable production smoke check

Create `scripts/pilot-smoke.sh` that:

1. starts the production profile with explicit test secrets;
2. waits for `/health`;
3. loads `/` and verifies the Angular shell is returned;
4. verifies `/api/dev-login` is unavailable;
5. verifies security headers;
6. performs one authenticated API request;
7. stops the test stack without deleting unrelated volumes.

Do not put real secrets in the script or repository.

### 4. Turn backup notes into a restore drill

The commands in `backend/README.md` are a starting point, not recovery evidence. Add scripts
or documented commands that:

- create a timestamped PostgreSQL custom-format backup;
- write it to an access-controlled encrypted destination;
- restore into a fresh test database/volume;
- verify a known scene, patient, protocol export, and audit row;
- record duration and result in `docs/pilot/acceptance-evidence.md`.

Owners must set RPO, RTO, backup frequency, retention, encryption/key ownership, and restore
drill cadence before a real-data pilot.

### 5. Document operations

Add `docs/pilot/operations.md` covering:

- hosting target and TLS termination;
- secret source and rotation;
- migration/startup behavior;
- health, logs, metrics, and alert thresholds;
- deploy, rollback, and failed-migration response;
- backup/restore and post-event archive handoff;
- realtime outage, map-tile outage, and lost-device procedures.

### Validate and commit

```sh
docker compose config
docker compose --profile prod build
./scripts/pilot-smoke.sh
# Run the documented backup/restore drill here.

git diff --check
git add backend/Dockerfile backend/src/Ambulanzsystem.Api/Program.cs docker-compose.yml \
  scripts docs/pilot/operations.md docs/pilot/acceptance-evidence.md
git commit -m "Add production pilot delivery and recovery path"
```

**Exit criterion:** a clean machine can build and start the complete application, pass the
smoke test, and restore verified data from a backup using documented commands.

## Phase 5: Close Human and Operational Gates

Update `docs/pilot/gate-items.md`; do not create a competing gate list.

Before an exercise with real patient data, record a named owner, decision, date, and evidence
for:

- G1 legal basis;
- G2 retention period;
- G3 medical approval of record-only triage;
- G4 measurable pilot scale and timing thresholds;
- G5 supported device/browser matrix;
- G6 functional, safety, technical, and go/no-go sign-off owners;
- G8 device-loss/local-data risk acceptance.

Clarify G7 separately. It is described as post-pilot roadmap scope, so it should not block
the pilot unless an owner explicitly makes an external integration mandatory.

Minimum measurable G4 values should include:

- maximum patients, responders, and simultaneous devices;
- maximum acceptable scan-to-record time;
- maximum situation-room update delay;
- maximum offline recovery/sync time;
- minimum supported browser/OS/device versions;
- responder training time and competency check;
- event abort/fallback triggers.

Commit decisions separately from code:

```sh
git add docs/pilot/gate-items.md docs/pilot/acceptance-evidence.md
git commit -m "Record pilot gate decisions"
```

**Exit criterion:** G1-G6 and G8 are signed; thresholds are measurable; no status is merely
`open` or ownerless.

## Phase 6: Rehearse the Rollout

### Internal demo

Run `docs/pilot/runbook.md` with synthetic data. Record actual timings, failures, screenshots
of print output, browser/device versions, and operator observations in the acceptance ledger.

### Supervised exercise

Use the intended device count and network conditions, but synthetic patients unless the
legal owner explicitly approves otherwise. Exercise:

- two simultaneous scans of one patient QR;
- temporary API/network loss and reconnect;
- expired and revoked responder access;
- device refresh/app restart with a local draft;
- situation-room reconnect after missed updates;
- map-tile outage;
- backup and restore;
- operator fallback to the paper process.

Any critical/high defect resets the affected gate to `blocked` and requires a repeated
exercise after the fix.

### Public-pilot go/no-go review

The named sign-off owners review:

- the acceptance ledger;
- all open defects and accepted residual risks;
- gate decisions;
- production smoke and restore evidence;
- exercise results;
- rollback and paper-fallback readiness.

Only then mark the public pilot `GO`.

## Final Review Phase

Before closing each implementation phase:

1. inspect the staged diff and confirm every file belongs to the phase;
2. verify contract-first changes where applicable;
3. run the narrow regression test, then the full relevant suite;
4. run `git diff --check`;
5. have a reviewer check authorization, data-loss behavior, and missing negative tests;
6. record remaining risks in the acceptance ledger rather than hiding them in commit prose.

The smallest safe first slice is Phase 1: add the failing two-event REST authorization test,
then route every relevant controller through the existing `SceneAccess` rule.
