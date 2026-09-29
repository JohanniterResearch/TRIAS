# ADR 0001 — Stay on .NET 8 past its end of support

- **Status:** proposed — needs the operations owner's acceptance (see gate G6 sign-off owners)
- **Date:** 2026-09-29
- **Deciders:** project lead (proposed); operations owner (to accept)

## Context

The backend runs on ASP.NET Core / EF Core 8 (`net8.0`, `mcr.microsoft.com/dotnet/aspnet:8.0`).
Microsoft ends support for .NET 8 on **10 November 2026**. After that date there are no security
patches for the runtime, the ASP.NET Core base image or the EF Core 8 / Npgsql 8 packages.

An upgrade to .NET 10 (LTS, supported until November 2028) was considered and deferred by the
project lead on 2026-09-29 so the pilot work is not mixed with a runtime migration.

## Decision

Stay on .NET 8 for the pilot. Until the upgrade:

- Take every .NET 8 patch release up to end of support. Dependabot (NuGet and Docker) raises
  them weekly; rebuild the bundle so the `aspnet:8.0` base image is refreshed.
- Keep the attack surface small: the API is only reachable through Caddy/NPMplus, the container
  runs as non-root, and a strict CSP is in place.

## Upgrade triggers (any one starts the migration to .NET 10)

1. The first security advisory after 2026-11-10 that affects ASP.NET Core, Kestrel, System.Text.Json,
   EF Core or Npgsql as used here.
2. Moving from the supervised pilot to regular production use.
3. **Revisit date: 2027-01-31** at the latest.

## Consequences

- Running unsupported software with patient data after 2026-11-10 is an accepted risk that the
  operations owner must sign; without that signature this ADR does not apply and the upgrade is
  required before production.
- The upgrade itself is mechanical (target framework, EF Core/Npgsql 10, base images, `dotnet-ef`
  tool version) but needs the full test, E2E and restore verification again.
