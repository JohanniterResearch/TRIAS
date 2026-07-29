#!/usr/bin/env bash
set -euo pipefail

restore_root=$(cd "$(dirname "$0")/.." && pwd)
restore_input=${1:?Usage: scripts/verify-restore.sh BACKUP.dump}
restore_database="ambulanzsystem_restore_$$"

cleanup() {
  docker compose -f "$restore_root/docker-compose.yml" -f "$restore_root/docker-compose.production.yml" \
    exec -T db dropdb -U pls --if-exists "$restore_database" >/dev/null
}
trap cleanup EXIT

docker compose -f "$restore_root/docker-compose.yml" -f "$restore_root/docker-compose.production.yml" \
  exec -T db createdb -U pls "$restore_database"
docker compose -f "$restore_root/docker-compose.yml" -f "$restore_root/docker-compose.production.yml" \
  exec -T db pg_restore -U pls -d "$restore_database" --no-owner --no-privileges <"$restore_input"

evidence=$(docker compose -f "$restore_root/docker-compose.yml" -f "$restore_root/docker-compose.production.yml" \
  exec -T db psql -U pls -d "$restore_database" -Atc \
  "SELECT
    (SELECT count(*) FROM operation_scenes WHERE name = 'Pilot smoke scene'),
    (SELECT count(*) FROM patients WHERE name = 'Pilot smoke patient'),
    (SELECT count(*) FROM ambulanzprotokoll_exports e JOIN patients p ON p.id = e.patient_id WHERE p.name = 'Pilot smoke patient'),
    (SELECT count(*) FROM audit_logs a JOIN patients p ON p.id = a.patient_id WHERE p.name = 'Pilot smoke patient');")
IFS='|' read -r scenes patients exports audits <<<"$evidence"
test "$scenes" -eq 1
test "$patients" -eq 1
test "$exports" -ge 1
test "$audits" -ge 1
echo "restore verified known smoke evidence: scene=$scenes patient=$patients exports=$exports audits=$audits"
