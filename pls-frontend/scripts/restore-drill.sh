#!/usr/bin/env bash
# Restore drill with PLS-created records (PLS parity plan WP 7.2), run by run-e2e.sh against its
# isolated database after the suites: pg_dump in the backup format, restore into a scratch
# database, and check that records the PLS client created (offline patients, protocols, audit)
# came back. Never touches the developer database; the scratch database is dropped on exit.
set -euo pipefail
cd "$(dirname "$0")/.."
case "${COMPOSE_PROJECT_NAME:-}" in
  pls-e2e-*) ;;
  *) echo "restore-drill: run through scripts/run-e2e.sh (isolated pls-e2e-* compose project)" >&2; exit 1 ;;
esac
compose=(docker compose -f ../docker-compose.yml)
scratch="restore_drill_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
dump=$(mktemp); created=0
cleanup() {
  rm -f "$dump"
  if [ "$created" = 1 ]; then "${compose[@]}" exec -T db dropdb -U pls --if-exists "$scratch" >/dev/null; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

query() { "${compose[@]}" exec -T db psql -U pls -d "$1" -AtX -v ON_ERROR_STOP=1 -c "$2"; }
# Records the offline suite creates through the PLS client: protocols with an "Offline-Zelt" place.
pls_records="SELECT count(*) FROM ambulanzprotokoll_page1s WHERE form_state #>> '{incident,ambulanzort}' LIKE 'Offline-Zelt%'"
counts="SELECT (SELECT count(*) FROM patients) || '|' || (SELECT count(*) FROM ambulanzprotokoll_page1s) || '|' || (SELECT count(*) FROM audit_logs) || '|' || ($pls_records)"

source_counts=$(query ambulanzsystem "$counts")
IFS='|' read -r _ _ _ source_pls <<<"$source_counts"
test "$source_pls" -ge 1 || { echo "restore drill: no PLS-created records to check; run the offline suite first." >&2; exit 1; }

"${compose[@]}" exec -T db pg_dump -U pls -Fc ambulanzsystem >"$dump"
test -s "$dump"
"${compose[@]}" exec -T db createdb -U pls "$scratch"; created=1
"${compose[@]}" exec -T db pg_restore -U pls -d "$scratch" --no-owner --no-privileges <"$dump"

restored_counts=$(query "$scratch" "$counts")
test "$restored_counts" = "$source_counts" || { echo "restore drill failed: source $source_counts, restored $restored_counts (patients|protocols|audit|PLS)." >&2; exit 1; }
echo "restore drill ok: patients|protocols|audit_logs|PLS-created protocols = $restored_counts"
