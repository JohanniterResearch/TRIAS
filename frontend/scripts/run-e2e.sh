#!/usr/bin/env bash
set -euo pipefail

read -r e2e_id </proc/sys/kernel/random/uuid
e2e_project=ambulanz-codex-e2e-$e2e_id
export COMPOSE_PROJECT_NAME=$e2e_project
export DB_HOST_PORT=5435

cleanup() {
  docker compose -f ../docker-compose.yml down -v
}
trap cleanup EXIT

cleanup
docker compose -f ../docker-compose.yml up -d db
playwright test "$@"
