#!/usr/bin/env bash
set -euo pipefail

pilot_root=$(cd "$(dirname "$0")/.." && pwd)
pilot_project=${COMPOSE_PROJECT_NAME:-ambulanz-smoke-$$}
pilot_port=${APP_HOST_PORT:-5500}
pilot_admin_password=${BOOTSTRAP_ADMIN_PASSWORD:-PilotSmokeAdmin123!}
pilot_changed_password=${SMOKE_CHANGED_ADMIN_PASSWORD:-PilotSmokeChanged123!}
pilot_headers=$(mktemp)

export COMPOSE_PROJECT_NAME=$pilot_project
export APP_HOST_PORT=$pilot_port
export DB_HOST_PORT=${DB_HOST_PORT:-55435}
export DB_PASSWORD=${DB_PASSWORD:-pilot-smoke-db-password}
export JWT_SECRET=${JWT_SECRET:-pilot-smoke-jwt-secret-at-least-32-characters}
export BOOTSTRAP_ADMIN_PASSWORD=$pilot_admin_password
export PLS_ALLOWED_ORIGINS=${PLS_ALLOWED_ORIGINS:-https://pilot.invalid}

if docker volume inspect "${pilot_project}_pgdata" >/dev/null 2>&1; then
  echo "Refusing to reuse ${pilot_project}_pgdata; choose a fresh COMPOSE_PROJECT_NAME." >&2
  exit 1
fi

cleanup() {
  docker compose -f "$pilot_root/docker-compose.yml" -f "$pilot_root/docker-compose.production.yml" \
    --profile prod down
  rm -f "$pilot_headers"
}
trap cleanup EXIT

docker compose -f "$pilot_root/docker-compose.yml" -f "$pilot_root/docker-compose.production.yml" --profile prod up -d --build

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$pilot_port/health" >/dev/null; then
    break
  fi
  sleep 2
done
curl -fsS "http://127.0.0.1:$pilot_port/health" >/dev/null
curl -fsS -D "$pilot_headers" "http://127.0.0.1:$pilot_port/" | grep -q '<app-root'
grep -qi '^X-Content-Type-Options: nosniff' "$pilot_headers"
grep -qi '^X-Frame-Options: DENY' "$pilot_headers"
test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"role":"admin"}' "http://127.0.0.1:$pilot_port/api/dev-login")" = "404"

login=$(curl -fsS -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$pilot_admin_password\"}" \
  "http://127.0.0.1:$pilot_port/api/admin-login")
token=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' <<<"$login")
test -n "$token"
curl -fsS -o /dev/null -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$pilot_admin_password\",\"newPassword\":\"$pilot_changed_password\"}" \
  "http://127.0.0.1:$pilot_port/api/users/change-password"
login=$(curl -fsS -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$pilot_changed_password\"}" \
  "http://127.0.0.1:$pilot_port/api/admin-login")
token=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' <<<"$login")
test -n "$token"
curl -fsS -o /dev/null -H "Authorization: Bearer $token" \
  -X POST "http://127.0.0.1:$pilot_port/api/validate-token"

scene=$(curl -fsS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d '{"name":"Pilot smoke scene","active":true}' \
  "http://127.0.0.1:$pilot_port/api/operation-scenes")
scene_id=$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' <<<"$scene")
test -n "$scene_id"
patient_uuid=$(cat /proc/sys/kernel/random/uuid)
patient=$(curl -fsS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"operationSceneId\":$scene_id,\"name\":\"Pilot smoke patient\",\"clientGeneratedId\":\"$patient_uuid\"}" \
  "http://127.0.0.1:$pilot_port/api/persons/manual")
patient_id=$(sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' <<<"$patient")
test -n "$patient_id"
curl -fsS -o /dev/null -X PUT -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d '{"status":"draft","formState":{}}' \
  "http://127.0.0.1:$pilot_port/api/persons/$patient_id/ambulanzprotokoll-page1"
curl -fsS -o /dev/null -H "Authorization: Bearer $token" \
  "http://127.0.0.1:$pilot_port/api/persons/$patient_id/ambulanzprotokoll-page1/export"

echo "pilot smoke passed: project=$pilot_project url=http://127.0.0.1:$pilot_port"
