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

counts=$(docker compose -f "$restore_root/docker-compose.yml" -f "$restore_root/docker-compose.production.yml" \
  exec -T db psql -U pls -d "$restore_database" -Atc \
  'SELECT (SELECT count(*) FROM operation_scenes), (SELECT count(*) FROM patients), (SELECT count(*) FROM ambulanzprotokoll_exports), (SELECT count(*) FROM audit_logs);')
IFS='|' read -r scenes patients exports audits <<<"$counts"
test "$scenes" -gt 0
test "$patients" -gt 0
test "$exports" -gt 0
test "$audits" -gt 0
echo "restore verified: scenes=$scenes patients=$patients exports=$exports audits=$audits"
