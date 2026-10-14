#!/usr/bin/env bash
# Local verification of the PLS client and the backend it depends on (PLS parity plan WP 7.3).
# No hosted CI runs the PLS code; run this before every commit.
# Stops at the first failure. Databases are isolated compose projects, removed afterwards; the
# developer database (default project, port 5434) is never touched.
#   bash scripts/verify.sh            all steps
#   SKIP_E2E=1 bash scripts/verify.sh without Playwright and the restore drill
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$(git rev-parse --show-toplevel)

step() { printf '\n== %s\n' "$1"; }

step 'lint'
npm run lint
step 'unit tests'
npm test
step 'live regions'
node scripts/check-live-regions.mjs
step 'build'
npm run build
step 'contract drift'
npm --prefix "$repo/contract" run --silent check:generated:pls

step 'backend tests (isolated database)'
read -r btest_id </proc/sys/kernel/random/uuid
btest_project="pls-btest-${btest_id}"
btest_port=${BTEST_DB_PORT:-5437}
cleanup_backend() {
  COMPOSE_PROJECT_NAME="$btest_project" docker compose -f "$repo/docker-compose.yml" down -v >/dev/null 2>&1 || true
}
trap cleanup_backend EXIT
COMPOSE_PROJECT_NAME="$btest_project" DB_HOST_PORT="$btest_port" docker compose -f "$repo/docker-compose.yml" up -d --wait db
ConnectionStrings__Default="Host=localhost;Port=${btest_port};Database=ambulanzsystem;Username=pls;Password=dev-only-password" \
  dotnet test "$repo/backend" --nologo
cleanup_backend
trap - EXIT

if [ "${SKIP_E2E:-}" != 1 ]; then
  step 'end-to-end tests and restore drill'
  PLS_RESTORE_DRILL=1 npm run test:e2e
fi

printf '\nverify: all steps passed\n'
