#!/usr/bin/env bash
# Starts an isolated PostgreSQL (unique compose project, port 5436), runs the PLS Playwright
# suites against the Ambulanzsystem backend, and removes that database afterwards. The
# developer database (default project, port 5434) is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."

read -r e2e_id </proc/sys/kernel/random/uuid
export COMPOSE_PROJECT_NAME="pls-e2e-${e2e_id}"
export DB_HOST_PORT="${DB_HOST_PORT:-5436}"

cleanup() {
  docker compose -f ../docker-compose.yml down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -f ../docker-compose.yml up -d --wait db
npx playwright test "$@"
# Optional restore drill on the same database, before it is removed (WP 7.2).
if [ "${PLS_RESTORE_DRILL:-}" = 1 ]; then bash scripts/restore-drill.sh; fi
