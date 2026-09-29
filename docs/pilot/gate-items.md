# Pilot Gate Items — Owner Sign-off Required

Status reviewed 2026-09-29: no owner decisions recorded since 2026-09-09. The live instance holds
synthetic data only; real patient data stays blocked until G1–G6 and G8 are signed.

These block the *pilot*, not the build (master-plan "human/organizational gate items").
None are code tasks. Each needs a named owner and a decision before the first exercise
with real patient data.

| # | Item | Detail | Owner | Decision | Date | Evidence | Status |
|---|------|--------|-------|----------|------|----------|--------|
| G1 | Legal basis | Define the legal basis for processing patient/medical data (GDPR Art. 6/9) | | | | | blocked |
| G2 | Retention period | 7 years (NFR-PRIV-05) vs 10 years (Sanitätergesetz) conflict — legal sign-off; value is config, not code | | | | | blocked |
| G3 | Medical governance | Sign-off on the record-only triage UI (D1: no guided mSTaRT decision tree) | | | | | blocked |
| G4 | Pilot scale (OD-06) | Max patients, responders, simultaneous devices, scan-to-record time, situation-room update delay, offline recovery expectations, training time | | | | | blocked |
| G5 | Device/browser matrix | Minimum supported devices and browsers for responders and situation room | | | | | blocked |
| G6 | Sign-off owners | Who accepts functional/safety/test acceptance for the pilot | | | | | blocked |
| G7 | External integrations | Whether Johanniter/Vienna-dispatch/hospital/archival integration is required | | Post-pilot unless an owner makes it mandatory | | | post-pilot |
| G8 | Device-loss policy | Explicitly out of scope in V1 (NFR-PRIV-10) — owner must acknowledge | | | | | blocked |

Decisions already locked (owner-confirmed 2026-07-08, see `docs/plan/master-plan.md`):
triage colors incl. `gruen` spelling (D1/D5), role model (D2), offline depth (D3),
stack (D4), event model (D6), audit scope (D7), scene deletion default (OD-02),
screenshot policy (NFR-SEC-11: watermarking only).
