#!/usr/bin/env bash
# Writes a verified pg_dump (custom format) of the running install.
#   sudo bash scripts/backup.sh [OUTPUT.dump]   (default: backups/ambulanz-<UTC timestamp>.dump)
# Keeps the newest BACKUP_KEEP (default 14) dumps in backups/. Run by ambulanz-backup.timer nightly
# and by install.sh before every upgrade. Proxmox Backup Server copies the whole container off-host.
set -euo pipefail
umask 077

root=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
[ -f "$root/.env" ] || { echo "Refusing backup: $root/.env not found." >&2; exit 1; }
set -a; . "$root/.env"; set +a
: "${BACKUP_EXPECTED_DEPLOYMENT_ID:?BACKUP_EXPECTED_DEPLOYMENT_ID missing from .env}"

mkdir -p "$root/backups"
output=$(realpath -m "${1:-$root/backups/ambulanz-$(date -u +%Y%m%dT%H%M%SZ).dump}")
temporary=$(mktemp "$(dirname "$output")/.$(basename "$output").tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT
# COMPOSE_FILE in .env (proxy mode) holds paths relative to the install folder.
cd "$root"
compose=(docker compose)

"${compose[@]}" ps --status running --services db | grep -qx db || {
  echo "Refusing backup: db is not running." >&2
  exit 1
}

# The deployment ID is written immutably at first start, so a dump can never be taken from (or
# later mistaken for) another installation.
# psql only interpolates :'expected' in SQL read from stdin, not in -c.
identity=$("${compose[@]}" exec -T db psql -U pls -d ambulanzsystem -AtX -v ON_ERROR_STOP=1 \
  -v expected="$BACKUP_EXPECTED_DEPLOYMENT_ID" <<<"SELECT CASE WHEN EXISTS (SELECT 1 FROM operational_metadata WHERE key = 'deployment_id' AND value = :'expected') THEN 'ok' ELSE 'wrong-deployment' END;")
test "$identity" = ok || {
  echo "Refusing backup: database deployment identity does not match .env." >&2
  exit 1
}

"${compose[@]}" exec -T db pg_dump -U pls -F c ambulanzsystem >"$temporary"
test -s "$temporary"
"${compose[@]}" exec -T db pg_restore --list <"$temporary" >/dev/null
mv -f "$temporary" "$output"
trap - EXIT
echo "backup written: $output"

# Rotation only touches files this script names; a manually named dump elsewhere is kept.
ls -1t "$root"/backups/ambulanz-*.dump 2>/dev/null | tail -n +"$((${BACKUP_KEEP:-14} + 1))" | xargs -r rm -f --
