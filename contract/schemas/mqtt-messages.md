# MQTT feed (optional, schema version 1)

Compatibility feed of the former PLS backend (PLS parity plan WP 7.1). Off by default
(`Mqtt:Enabled`); no consumer exists today (plan decision D6). Like the realtime hub it is a
best-effort mirror of committed state: the database is the source of truth, a publish never
fails or delays an API write, and a broker outage shows as `mqtt: degraded` on `/health`.

## Delivery

- Published after every committed patient change that also notifies the realtime hub
  (`SceneNotifier.PatientUpdatedAsync`): manual and QR intake, triage colour and flags,
  respiration, location, body regions, Ambulanzprotokoll saves.
- QoS 1 (at least once), retained. Consumers must tolerate duplicates and use
  `eventTimestamp` to order.
- During a broker outage the backend keeps at most `Mqtt:PendingQueueCapacity` (default 200)
  patients queued; when full the oldest is dropped. On reconnect each queued patient is
  published with its current state (not the state at the time of the change).
- Broker access: `allow_anonymous false`; the backend user may only write `pls/#`
  (`deploy/mosquitto/acl`). Consumers get their own read-only user when one exists.

## Topics

### `pls/v1/patients/{patientId}`

```json
{
  "schemaVersion": 1,
  "eventTimestamp": "2026-10-09T12:00:00Z",
  "patientId": 42,
  "triagefarbe": "grün",
  "atmung": true,
  "blutung": false,
  "radialispuls": null,
  "transport": null,
  "dringend": null,
  "kontaminiert": null,
  "longitude": 16.37,
  "latitude": 48.2,
  "bodyParts": { "bauch_vorne": 1, "kopf_vorne": 0 },
  "operationSceneId": 7
}
```

- `triagefarbe`: `rot`, `gelb`, `grün`, `schwarz` or null (`blau` does not exist in the Ambulanzsystem). Green is published as `grün`,
  the spelling of the PLS contract, although the API uses `gruen`.
- `bodyParts`: **Ambulanzsystem region keys** (`contract/body-regions.json`), not the PLS keys;
  the PLS → Ambulanzsystem mapping is lossy (parity plan §5.2). Changed without a schema version
  bump because no consumer exists (D6); revisit if one appears.
- Privacy: `name` is published only with `Mqtt:RedactName=false`. `longitude`/`latitude` are
  omitted with `Mqtt:RedactLocation=true`. The legacy `Mqtt:RedactPersonalData=true` omits both.

### `pls/v1/scenes/{sceneId}/patients`

```json
{ "schemaVersion": 1, "eventTimestamp": "2026-10-09T12:00:00Z", "sceneId": 7, "patientIds": [41, 42] }
```

The ids of all patients currently in the operation scene, published with every patient message
of that scene. When a patient moves to another scene or is removed, the previous scene's list is published
again without it (the publisher remembers the last scene per patient while it runs; after a
backend restart the old list is corrected with the next change in that scene). A removed
patient's own topic is cleared with an empty retained message.

Tests: `backend/src/Ambulanzsystem.Tests/MqttContractTests.cs`.
