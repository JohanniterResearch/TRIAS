# Pilot Gate Items — Owner Sign-off Required

These block the *pilot*, not the build (master-plan "human/organizational gate items").
None are code tasks. Each needs a named owner and a decision before the first exercise
with real patient data.

| # | Item | Detail | Owner | Status |
|---|------|--------|-------|--------|
| G1 | Legal basis | Define the legal basis for processing patient/medical data (GDPR Art. 6/9) | | open |
| G2 | Retention period | 7 years (NFR-PRIV-05) vs 10 years (Sanitätergesetz) conflict — legal sign-off; value is config, not code | | open |
| G3 | Medical governance | Sign-off on the record-only triage UI (D1: no guided mSTaRT decision tree) | | open |
| G4 | Pilot scale (OD-06) | Max patients, responders, simultaneous devices, scan-to-record time, situation-room update delay, offline recovery expectations, training time | | open |
| G5 | Device/browser matrix | Minimum supported devices and browsers for responders and situation room | | open |
| G6 | Sign-off owners | Who accepts functional/safety/test acceptance for the pilot | | open |
| G7 | External integrations | Whether Johanniter/Vienna-dispatch/hospital/archival integration is required (affects post-pilot roadmap only) | | open |
| G8 | Device-loss policy | Explicitly out of scope in V1 (NFR-PRIV-10) — owner must acknowledge | | open |

Decisions already locked (owner-confirmed 2026-07-08, see `docs/plan/master-plan.md`):
triage colors incl. `gruen` spelling (D1/D5), role model (D2), offline depth (D3),
stack (D4), event model (D6), audit scope (D7), scene deletion default (OD-02),
screenshot policy (NFR-SEC-11: watermarking only).
