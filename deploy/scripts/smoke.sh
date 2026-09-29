#!/usr/bin/env bash
# Starts the production stack (Caddy proxy mode) in an isolated Compose project, checks it end to
# end, and removes only that project again. Dev machine / CI only.
#   bash deploy/scripts/smoke.sh [IMAGE]   (default: builds ambulanzsystem-backend:smoke from the working tree)
set -euo pipefail

deploy=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
project=ambulanz-smoke-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
port=${SMOKE_PORT:-18080}
url=http://127.0.0.1:$port
headers=$(mktemp)

if [ -z "${1:-}" ]; then
  docker build -q -f "$deploy/../backend/Dockerfile" -t ambulanzsystem-backend:smoke "$deploy/.." >/dev/null
fi
export APP_IMAGE=${1:-ambulanzsystem-backend:smoke}
export COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
export HTTP_PORT=$port TRUSTED_PROXY=127.0.0.1 SITE_ADDRESS=smoke.invalid
export DB_PASSWORD=smoke-db-password JWT_SECRET=smoke-jwt-secret-at-least-32-characters-long
export BOOTSTRAP_ADMIN_PASSWORD=SmokeAdmin123! BACKUP_EXPECTED_DEPLOYMENT_ID=$project
cd "$deploy"
compose=(docker compose -p "$project" --env-file /dev/null)

cleanup() {
  "${compose[@]}" down -v >/dev/null 2>&1 || true
  rm -f "$headers"
}
trap cleanup EXIT

"${compose[@]}" up -d >/dev/null
for _ in $(seq 60); do curl -fsS "$url/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "$url/health" | grep -q '"status":"healthy"'

# SPA shell, uncompressed and without Accept-Encoding: the NPMplus path that once lost Content-Type.
curl -fsS -D "$headers" "$url/situation-room" | grep -q '<app-root'
grep -qi '^Content-Type: text/html' "$headers"
grep -qi '^X-Content-Type-Options: nosniff' "$headers"
grep -qi '^X-Frame-Options: DENY' "$headers"
grep -qi "^Content-Security-Policy: .*script-src 'self';" "$headers"
if curl -fsS "$url/" | grep -q 'onload='; then
  echo "index.html has an inline handler, which the CSP blocks" >&2
  exit 1
fi
test "$(curl -s -o /dev/null -w '%{http_code}' "$url/api/does-not-exist")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"role":"admin"}' "$url/api/dev-login")" = 404
curl -fsS "$url/sw.js" | grep -Eq "ambulanzsystem-shell-[0-9a-f]{16}"

token_from() { sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }
login() {
  curl -fsS -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$1\"}" "$url/api/admin-login" | token_from
}
token=$(login "$BOOTSTRAP_ADMIN_PASSWORD")
curl -fsS -o /dev/null -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$BOOTSTRAP_ADMIN_PASSWORD\",\"newPassword\":\"SmokeChanged123!\"}" \
  "$url/api/users/change-password"
token=$(login SmokeChanged123!)
auth=(-H "Authorization: Bearer $token" -H 'Content-Type: application/json')

scene_id=$(curl -fsS "${auth[@]}" -d '{"name":"Smoke scene","active":true}' "$url/api/operation-scenes" \
  | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
patient_id=$(curl -fsS "${auth[@]}" \
  -d "{\"operationSceneId\":$scene_id,\"name\":\"Smoke patient\",\"clientGeneratedId\":\"$(cat /proc/sys/kernel/random/uuid)\"}" \
  "$url/api/persons/manual" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
curl -fsS -o /dev/null -X PUT "${auth[@]}" -d '{"status":"draft","formState":{}}' \
  "$url/api/persons/$patient_id/ambulanzprotokoll-page1"
curl -fsS -o /dev/null "${auth[@]}" "$url/api/persons/$patient_id/ambulanzprotokoll-page1/export"

echo "smoke passed: project=$project image=$APP_IMAGE"
