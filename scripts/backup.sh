#!/usr/bin/env bash
set -euo pipefail

backup_root=$(cd "$(dirname "$0")/.." && pwd)
backup_output=${1:?Usage: scripts/backup.sh OUTPUT.dump}

docker compose -f "$backup_root/docker-compose.yml" -f "$backup_root/docker-compose.production.yml" up -d db
docker compose -f "$backup_root/docker-compose.yml" -f "$backup_root/docker-compose.production.yml" \
  exec -T db pg_dump -U pls -F c ambulanzsystem >"$backup_output"
test -s "$backup_output"
echo "backup written: $backup_output"
