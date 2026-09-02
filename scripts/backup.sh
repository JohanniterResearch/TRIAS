#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_root=$(cd "$(dirname "$0")/.." && pwd)
backup_output=${1:?Usage: scripts/backup.sh OUTPUT.dump}
: "${COMPOSE_PROJECT_NAME:?Set COMPOSE_PROJECT_NAME to the intended running Compose project}"
: "${BACKUP_EXPECTED_DEPLOYMENT_ID:?Set BACKUP_EXPECTED_DEPLOYMENT_ID to the intended deployment identity}"
backup_directory=$(dirname "$backup_output")
backup_name=$(basename "$backup_output")
backup_temporary=$(mktemp "$backup_directory/.${backup_name}.tmp.XXXXXX")
compose=(docker compose -f "$backup_root/docker-compose.yml" -f "$backup_root/docker-compose.production.yml")

cleanup() {
  rm -f "$backup_temporary"
}
trap cleanup EXIT

"${compose[@]}" ps --status running --services db | grep -qx db || {
  echo "Refusing backup: db is not running in Compose project $COMPOSE_PROJECT_NAME." >&2
  exit 1
}

identity=$("${compose[@]}" exec -T db psql -U pls -d ambulanzsystem -AtX -v ON_ERROR_STOP=1 -c \
  "SELECT CASE WHEN current_database() = 'ambulanzsystem'
    AND to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL
    AND to_regclass('public.operation_scenes') IS NOT NULL
    AND EXISTS (SELECT 1 FROM operation_scenes)
    THEN 'ok' ELSE 'wrong-target' END;")
test "$identity" = ok || {
  echo "Refusing backup: database identity, schema, or operational scene sentinel does not match ambulanzsystem." >&2
  exit 1
}

deployment_identity=$("${compose[@]}" exec -T db psql -U pls -d ambulanzsystem -AtX -v ON_ERROR_STOP=1 \
  -v expected_deployment_id="$BACKUP_EXPECTED_DEPLOYMENT_ID" -c \
  "SELECT CASE WHEN EXISTS (SELECT 1 FROM operational_metadata WHERE key = 'deployment_id' AND value = :'expected_deployment_id') THEN 'ok' ELSE 'wrong-deployment' END;")
test "$deployment_identity" = ok || {
  echo "Refusing backup: deployment identity does not match BACKUP_EXPECTED_DEPLOYMENT_ID." >&2
  exit 1
}

"${compose[@]}" exec -T db pg_dump -U pls -F c ambulanzsystem >"$backup_temporary"
test -s "$backup_temporary"
"${compose[@]}" exec -T db pg_restore --list <"$backup_temporary" >/dev/null
mv -f "$backup_temporary" "$backup_output"
trap - EXIT
echo "backup written: $backup_output"
