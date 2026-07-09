# Realtime Contract — SignalR (Stage 0, frozen)

Semantics (master-plan default): **best-effort dashboard refresh**, not durable delivery.
DB writes are the source of truth; the hub pushes after commit; clients recover missed
messages by refetching the scene snapshot on every (re)connect. Publish failures never
fail an API write (NFR-SAFE-03).

## Hub

- Path: `/hubs/scene`
- Auth: same JWT bearer as the API (query string `access_token` per SignalR convention).
  Any authenticated session (TriageWrite policy) may join groups within its scene scope;
  joining a scene outside the session's event subtree is rejected.

## Client → server methods

| Method | Args | Behavior |
|--------|------|----------|
| `JoinScene` | `sceneId: number` | Adds the connection to the scene group and immediately sends `SceneSnapshot` to the caller. This is also the reconnect recovery path. |
| `LeaveScene` | `sceneId: number` | Removes the connection from the group. |

## Server → client messages

All messages carry `schemaVersion` (currently `"1"`) and `eventTimestamp` (ISO 8601 UTC).

### `SceneSnapshot` — sent to the caller on JoinScene

```json
{
  "schemaVersion": "1",
  "eventTimestamp": "2026-07-09T12:00:00Z",
  "sceneId": 1,
  "patients": [ /* Patient objects, exactly the openapi.yaml Patient schema */ ],
  "teams":    [ /* Team objects, exactly the openapi.yaml Team schema */ ]
}
```

### `PatientUpdated` — broadcast to the scene group

Sent after commit on: patient creation (QR verify or manual), triage color change,
respiration change, location change, body-part toggle, protocol status change.
Full current snapshot of the one patient (not a delta):

```json
{
  "schemaVersion": "1",
  "eventTimestamp": "2026-07-09T12:00:00Z",
  "sceneId": 1,
  "created": false,
  "patient": { /* Patient object per openapi.yaml */ },
  "bodyParts": { "kopf_vorne": 0, "...": 0 },
  "protokollStatus": "draft"
}
```

If the backend's `RedactPersonalData` flag is set, `patient.name`,
`patient.longitudePatient`, and `patient.latitudePatient` are `null` in
broadcasts (recreation spec §2.5).

### `TeamUpdated` — broadcast to the scene group

```json
{
  "schemaVersion": "1",
  "eventTimestamp": "2026-07-09T12:00:00Z",
  "sceneId": 1,
  "team": { /* Team object per openapi.yaml */ }
}
```

### `ScenePatientList` — broadcast to the scene group

Sent when the set of patients in a scene changes (creation, scene re-link):

```json
{
  "schemaVersion": "1",
  "eventTimestamp": "2026-07-09T12:00:00Z",
  "sceneId": 1,
  "patientIds": [1, 2, 3]
}
```

## Client obligations (frontend, F6)

- On connect AND every reconnect: `JoinScene` → replace local state with `SceneSnapshot`.
- Apply `PatientUpdated`/`TeamUpdated` as upserts keyed by ID; ignore messages with an
  `eventTimestamp` older than local state for that entity.
- If the hub is unreachable, degrade to polling `GET /api/persons?operationSceneId=`.
