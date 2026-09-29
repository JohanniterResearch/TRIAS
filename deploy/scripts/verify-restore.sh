#!/usr/bin/env bash
# Restores a dump into a throwaway database inside the running db container and checks it.
#   sudo bash scripts/verify-restore.sh backups/ambulanz-XXXX.dump
# The live database is never touched; the scratch database is dropped on exit.
set -euo pipefail

root=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
input=$(realpath -m "${1:?Usage: scripts/verify-restore.sh BACKUP.dump}")
set -a; . "$root/.env"; set +a
: "${BACKUP_EXPECTED_DEPLOYMENT_ID:?BACKUP_EXPECTED_DEPLOYMENT_ID missing from .env}"
database="ambulanzsystem_restore_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
# COMPOSE_FILE in .env (proxy mode) holds paths relative to the install folder.
cd "$root"
compose=(docker compose)

created=0
cleanup() {
  # Only drop what this run created.
  test "$created" = 1 || return 0
  "${compose[@]}" exec -T db dropdb -U pls --if-exists "$database" >/dev/null
}
trap cleanup EXIT

test -s "$input"
"${compose[@]}" ps --status running --services db | grep -qx db
"${compose[@]}" exec -T db pg_restore --list <"$input" >/dev/null
"${compose[@]}" exec -T db createdb -U pls "$database"
created=1
"${compose[@]}" exec -T db pg_restore -U pls -d "$database" --no-owner --no-privileges <"$input"

query() { "${compose[@]}" exec -T db psql -U pls -d "$database" -AtX -v ON_ERROR_STOP=1 "$@"; }
# psql only interpolates :'expected' in SQL read from stdin, not in -c.
identity=$(query -v expected="$BACKUP_EXPECTED_DEPLOYMENT_ID" <<<"SELECT CASE WHEN EXISTS (SELECT 1 FROM operational_metadata WHERE key = 'deployment_id' AND value = :'expected') THEN 'ok' ELSE 'wrong-deployment' END;")
test "$identity" = ok || { echo "restore verification failed: deployment identity mismatch." >&2; exit 1; }

evidence=$(query -c "SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('__EFMigrationsHistory', 'operation_scenes', 'patients', 'ambulanzprotokoll_page1s', 'audit_logs')),
  (SELECT count(*) FROM \"__EFMigrationsHistory\"),
  (SELECT count(*) FROM operation_scenes),
  (SELECT count(*) FROM patients),
  (SELECT count(*) FROM audit_logs);")
IFS='|' read -r tables migrations scenes patients audits <<<"$evidence"
test "$tables" -eq 5 || { echo "restore verification failed: expected 5 core tables, found $tables." >&2; exit 1; }
test "$migrations" -ge 1
echo "restore verified: migrations=$migrations scenes=$scenes patients=$patients audit_logs=$audits"
