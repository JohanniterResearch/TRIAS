#!/usr/bin/env bash
set -euo pipefail

restore_root=$(cd "$(dirname "$0")/.." && pwd)
restore_input=${1:?Usage: scripts/verify-restore.sh BACKUP.dump}
: "${COMPOSE_PROJECT_NAME:?Set COMPOSE_PROJECT_NAME to the intended running Compose project}"
: "${BACKUP_EXPECTED_DEPLOYMENT_ID:?Set BACKUP_EXPECTED_DEPLOYMENT_ID to the intended deployment identity}"
# Cryptographically random, not PID-derived: a PID is reused across processes, so a
# deterministic PID-based name can collide with a pre-existing (unrelated) database.
restore_database="ambulanzsystem_restore_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
compose=(docker compose -f "$restore_root/docker-compose.yml" -f "$restore_root/docker-compose.production.yml")

restore_created=0
cleanup() {
  # Only drop the database this invocation actually created — if createdb failed
  # because the generated name collided with a pre-existing database, that database
  # is not ours to remove.
  test "$restore_created" = 1 || return 0
  "${compose[@]}" exec -T db dropdb -U pls --if-exists "$restore_database" >/dev/null
}
trap cleanup EXIT

test -s "$restore_input"
"${compose[@]}" ps --status running --services db | grep -qx db
"${compose[@]}" exec -T db pg_restore --list <"$restore_input" >/dev/null
"${compose[@]}" exec -T db createdb -U pls "$restore_database"
restore_created=1
"${compose[@]}" exec -T db pg_restore -U pls -d "$restore_database" --no-owner --no-privileges <"$restore_input"

deployment_identity=$("${compose[@]}" exec -T db psql -U pls -d "$restore_database" -AtX -v ON_ERROR_STOP=1 \
  -v expected_deployment_id="$BACKUP_EXPECTED_DEPLOYMENT_ID" -c \
  "SELECT CASE WHEN EXISTS (SELECT 1 FROM operational_metadata WHERE key = 'deployment_id' AND value = :'expected_deployment_id') THEN 'ok' ELSE 'wrong-deployment' END;")
test "$deployment_identity" = ok || {
  echo "restore verification failed: deployment identity does not match BACKUP_EXPECTED_DEPLOYMENT_ID." >&2
  exit 1
}

evidence=$("${compose[@]}" exec -T db psql -U pls -d "$restore_database" -Atc \
  "SELECT
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('__EFMigrationsHistory', 'operation_scenes', 'patients', 'ambulanzprotokoll_exports', 'audit_logs')),
    (SELECT count(*) FROM operation_scenes WHERE name = 'Pilot smoke scene'),
    (SELECT count(*) FROM patients WHERE name = 'Pilot smoke patient'),
    (SELECT count(*) FROM ambulanzprotokoll_exports e JOIN patients p ON p.id = e.patient_id WHERE p.name = 'Pilot smoke patient'),
    (SELECT count(*) FROM audit_logs a JOIN patients p ON p.id = a.patient_id WHERE p.name = 'Pilot smoke patient');")
IFS='|' read -r schema_tables scenes patients exports audits <<<"$evidence"
test "$schema_tables" -eq 5
test "$scenes" -eq 1
test "$patients" -eq 1
test "$exports" -ge 1
test "$audits" -ge 1
echo "restore verified schema and smoke evidence: tables=$schema_tables scene=$scenes patient=$patients exports=$exports audits=$audits"
