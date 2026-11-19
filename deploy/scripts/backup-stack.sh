#!/usr/bin/env bash
# Writes a verified pg_dump (custom format) of a Portainer-managed stack (docker-compose.portainer.yml).
#   sudo bash backup-stack.sh [OUTPUT.dump]   (default: $BACKUP_DIR/ambulanz-<UTC timestamp>.dump)
# Env: STACK (compose project / Portainer stack name, default ambulanzsystem),
#      BACKUP_DIR (default /var/backups/ambulanzsystem), BACKUP_KEEP (default 14).
# The stack has no .env on the host: the expected deployment ID is read from the running backend.
set -euo pipefail
umask 077

stack=${STACK:-ambulanzsystem}
dir=${BACKUP_DIR:-/var/backups/ambulanzsystem}

container() {
  docker ps -q --filter "label=com.docker.compose.project=$stack" \
    --filter "label=com.docker.compose.service=$1" --filter status=running
}
db=$(container db)
backend=$(container backend)
[ "$(wc -w <<<"$db")" -eq 1 ] || { echo "Refusing backup: no single running db container in stack '$stack'." >&2; exit 1; }
[ "$(wc -w <<<"$backend")" -eq 1 ] || { echo "Refusing backup: no single running backend container in stack '$stack'." >&2; exit 1; }

expected=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$backend" \
  | sed -n 's/^BACKUP_EXPECTED_DEPLOYMENT_ID=//p')
[ -n "$expected" ] || { echo "Refusing backup: backend has no BACKUP_EXPECTED_DEPLOYMENT_ID." >&2; exit 1; }

# The deployment ID is written immutably at first start, so a dump can never be taken from (or
# later mistaken for) another installation. psql only interpolates :'expected' in SQL from stdin.
identity=$(docker exec -i "$db" psql -U pls -d ambulanzsystem -AtX -v ON_ERROR_STOP=1 \
  -v expected="$expected" <<<"SELECT CASE WHEN EXISTS (SELECT 1 FROM operational_metadata WHERE key = 'deployment_id' AND value = :'expected') THEN 'ok' ELSE 'wrong-deployment' END;")
test "$identity" = ok || {
  echo "Refusing backup: database deployment identity does not match the backend." >&2
  exit 1
}

mkdir -p "$dir"
output=$(realpath -m "${1:-$dir/ambulanz-$(date -u +%Y%m%dT%H%M%SZ).dump}")
temporary=$(mktemp "$(dirname "$output")/.$(basename "$output").tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT
docker exec "$db" pg_dump -U pls -F c ambulanzsystem >"$temporary"
test -s "$temporary"
docker exec -i "$db" pg_restore --list <"$temporary" >/dev/null
mv -f "$temporary" "$output"
trap - EXIT
echo "backup written: $output"

# Rotation only touches files this script names; a manually named dump elsewhere is kept.
ls -1t "$dir"/ambulanz-*.dump 2>/dev/null | tail -n +"$((${BACKUP_KEEP:-14} + 1))" | xargs -r rm -f --
