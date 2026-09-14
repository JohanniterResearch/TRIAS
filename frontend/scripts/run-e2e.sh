#!/usr/bin/env bash
set -euo pipefail

read -r e2e_id </proc/sys/kernel/random/uuid
e2e_project=ambulanz-e2e-$e2e_id
export COMPOSE_PROJECT_NAME=$e2e_project
export DB_HOST_PORT="${DB_HOST_PORT:-5435}"
export BACKEND_PORT="${BACKEND_PORT:-5042}"
export FRONTEND_PORT="${FRONTEND_PORT:-4200}"
export BACKUP_EXPECTED_DEPLOYMENT_ID="${BACKUP_EXPECTED_DEPLOYMENT_ID:-e2e-$e2e_id}"

cleanup() {
  docker compose -f ../docker-compose.yml down -v
}
trap cleanup EXIT

cleanup
docker compose -f ../docker-compose.yml up -d db
playwright test "$@"
