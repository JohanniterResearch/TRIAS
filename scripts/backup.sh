#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_root=$(cd "$(dirname "$0")/.." && pwd)
backup_output=${1:?Usage: scripts/backup.sh OUTPUT.dump}
backup_directory=$(dirname "$backup_output")
backup_name=$(basename "$backup_output")
backup_temporary=$(mktemp "$backup_directory/.${backup_name}.tmp.XXXXXX")

cleanup() {
  rm -f "$backup_temporary"
}
trap cleanup EXIT

docker compose -f "$backup_root/docker-compose.yml" -f "$backup_root/docker-compose.production.yml" up -d --wait db
docker compose -f "$backup_root/docker-compose.yml" -f "$backup_root/docker-compose.production.yml" \
  exec -T db pg_dump -U pls -F c ambulanzsystem >"$backup_temporary"
test -s "$backup_temporary"
mv -f "$backup_temporary" "$backup_output"
trap - EXIT
echo "backup written: $backup_output"
