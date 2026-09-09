#!/usr/bin/env bash
set -euo pipefail

compose_root=$(cd "$(dirname "$0")/.." && pwd)
base="$compose_root/docker-compose.yml"
production="$compose_root/docker-compose.production.yml"
base_render=$(mktemp)
production_render=$(mktemp)
trap 'rm -f "$base_render" "$production_render"' EXIT

version=$(docker compose version --short)
version=${version#v}
version=${version%%-*}
IFS=. read -r major minor patch <<<"$version"
minor=${minor:-0}
patch=${patch:-0}
if (( major < 2 || (major == 2 && minor < 24) || (major == 2 && minor == 24 && patch < 4) )); then
  echo "Docker Compose 2.24.4 or newer is required for !override (found $version)." >&2
  exit 1
fi

# Use an empty env file so a local .env cannot hide missing operator configuration.
env -u BACKUP_EXPECTED_DEPLOYMENT_ID docker compose --env-file /dev/null \
  -f "$base" config --quiet db

if env -u BACKUP_EXPECTED_DEPLOYMENT_ID DB_PASSWORD=placeholder JWT_SECRET=12345678901234567890123456789012 \
  BOOTSTRAP_ADMIN_PASSWORD=placeholder PLS_ALLOWED_ORIGINS=https://example.invalid \
  docker compose --env-file /dev/null -f "$base" -f "$production" --profile prod config --quiet 2>/dev/null; then
  echo 'Production Compose unexpectedly rendered with BACKUP_EXPECTED_DEPLOYMENT_ID unset.' >&2
  exit 1
fi

if DB_PASSWORD=placeholder JWT_SECRET=12345678901234567890123456789012 \
  BOOTSTRAP_ADMIN_PASSWORD=placeholder PLS_ALLOWED_ORIGINS=https://example.invalid \
  BACKUP_EXPECTED_DEPLOYMENT_ID= \
  docker compose -f "$base" -f "$production" --profile prod config --quiet 2>/dev/null; then
  echo 'Production Compose unexpectedly rendered without BACKUP_EXPECTED_DEPLOYMENT_ID.' >&2
  exit 1
fi

BACKUP_EXPECTED_DEPLOYMENT_ID=compose-validation-base \
  docker compose -f "$base" --profile prod config --format json >"$base_render"
DB_PASSWORD=placeholder JWT_SECRET=12345678901234567890123456789012 \
  BOOTSTRAP_ADMIN_PASSWORD=placeholder PLS_ALLOWED_ORIGINS=https://example.invalid \
  BACKUP_EXPECTED_DEPLOYMENT_ID=compose-validation-identity \
  docker compose -f "$base" -f "$production" --profile prod config --format json >"$production_render"

test "$(grep -c '"host_ip": "127.0.0.1"' "$base_render")" -eq 2
test "$(grep -c '"host_ip": "127.0.0.1"' "$production_render")" -eq 2
grep -q '"Features__EnableDevLogin": "false"' "$production_render"
grep -q '"Bootstrap__SeedDevSampleData": "false"' "$production_render"

echo "Compose validation passed: version=$version base=loopback production=loopback required-secrets=fail-fast"
