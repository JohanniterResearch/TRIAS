#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

mkdir "$test_root/bin"
cat >"$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "DB_HOST_PORT=$DB_HOST_PORT BACKEND_PORT=$BACKEND_PORT FRONTEND_PORT=$FRONTEND_PORT $*" >>"$FAKE_DOCKER_LOG"
EOF
cat >"$test_root/bin/playwright" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$test_root/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

proxy_config=
previous=
for argument in "$@"; do
  if [[ "$previous" == '--proxy-config' ]]; then
    proxy_config=$argument
    break
  fi
  previous=$argument
done
node - "$proxy_config" "$BACKEND_PORT" <<'NODE'
const fs = require('node:fs');
const [proxyPath, backendPort] = process.argv.slice(2);
const proxy = JSON.parse(fs.readFileSync(proxyPath, 'utf8'));
const target = `http://127.0.0.1:${backendPort}`;
if (proxy['/api']?.target !== target || proxy['/hubs']?.target !== target || proxy['/hubs']?.ws !== true) {
  process.exit(1);
}
NODE
printf '%s\n' "$proxy_config" >>"$FAKE_NPM_LOG"
EOF
chmod +x "$test_root/bin/docker" "$test_root/bin/playwright" "$test_root/bin/npm"

assert_port() {
  local db_port=$1
  local backend_port=$2
  local frontend_port=$3
  local log="$test_root/$db_port.log"
  DB_HOST_PORT="$db_port" BACKEND_PORT="$backend_port" FRONTEND_PORT="$frontend_port" \
    FAKE_DOCKER_LOG="$log" PATH="$test_root/bin:$PATH" \
    bash "$repo_root/frontend/scripts/run-e2e.sh" --help >/dev/null
  grep -q "^DB_HOST_PORT=$db_port BACKEND_PORT=$backend_port FRONTEND_PORT=$frontend_port .* up -d db$" "$log"
}

assert_port 55432 15042 14200
assert_port 55433 15043 14201

assert_proxy_ports() {
  local backend_port=$1
  local log="$test_root/proxy-$backend_port.log"
  BACKEND_PORT="$backend_port" FAKE_NPM_LOG="$log" PATH="$test_root/bin:$PATH" \
    bash "$repo_root/frontend/scripts/run-e2e-dev-server.sh" --host 127.0.0.1 --port 14200
  local generated_proxy
  generated_proxy=$(<"$log")
  [[ "$generated_proxy" != "$repo_root"/* ]]
  [[ ! -e "$generated_proxy" ]]
}

assert_proxy_ports 15042
assert_proxy_ports 15043

assert_playwright_ports() {
  local db_port=$1
  local backend_port=$2
  local frontend_port=$3
  node - "$repo_root/frontend/playwright.config.ts" "$db_port" "$backend_port" "$frontend_port" <<'NODE'
const fs = require('node:fs');

const [configPath, dbHostPort, backendPort, frontendPort] = process.argv.slice(2);
const source = fs.readFileSync(configPath, 'utf8')
  .replace("import { defineConfig } from '@playwright/test';", '')
  .replace('export default defineConfig', 'return defineConfig');
const config = new Function('process', 'defineConfig', source)(
  { env: { DB_HOST_PORT: dbHostPort, BACKEND_PORT: backendPort, FRONTEND_PORT: frontendPort } },
  (value) => value,
);
const backend = config.webServer[0];
const frontend = config.webServer[1];

if (backend.env.ConnectionStrings__Default.indexOf(`Port=${dbHostPort}`) === -1 ||
    backend.url !== `http://127.0.0.1:${backendPort}/health` ||
    backend.command.indexOf(`--urls http://127.0.0.1:${backendPort}`) === -1 ||
    frontend.command.indexOf('scripts/run-e2e-dev-server.sh') === -1 ||
    frontend.command.indexOf(`--port ${frontendPort}`) === -1 ||
    frontend.url !== `http://127.0.0.1:${frontendPort}/login` ||
    config.use.baseURL !== `http://127.0.0.1:${frontendPort}`) {
  process.exit(1);
}
NODE
}

assert_playwright_ports 55432 15042 14200
assert_playwright_ports 55433 15043 14201

assert_direct_request_base() {
  local backend_port=$1
  node - "$repo_root/frontend/tests/e2e/pilot-flow.spec.ts" "$backend_port" <<'NODE'
const fs = require('node:fs');
const [specPath, backendPort] = process.argv.slice(2);
const source = fs.readFileSync(specPath, 'utf8');
const match = source.match(/^const apiUrl = (.+);$/m);
if (!match || new Function('process', `return ${match[1]}`)({ env: { BACKEND_PORT: backendPort } }) !== `http://127.0.0.1:${backendPort}` ||
    source.includes('http://127.0.0.1:5042/api')) {
  process.exit(1);
}
NODE
}

assert_direct_request_base 15042
assert_direct_request_base 15043

! grep -q "Port=5435" "$repo_root/frontend/playwright.config.ts"
grep -q "process.env.DB_HOST_PORT" "$repo_root/frontend/playwright.config.ts"

refresh=$(awk '/^  \/api\/refresh-token:/{capture=1} capture && /^  \/api\/[^r]/{exit} capture' "$repo_root/contract/openapi.yaml")
grep -Eq '^[[:space:]]+"429": \{ \$ref: "#/components/responses/RateLimited" \}' <<<"$refresh"

health=$(awk '/^  \/health:/{capture=1} capture && /^components:/{exit} capture' "$repo_root/contract/openapi.yaml")
grep -q 'Database or realtime dispatcher unavailable is unhealthy (HTTP 503).' <<<"$health"
grep -q 'Healthy or degraded health report.' <<<"$health"
! grep -q 'Degraded when DB unreachable' <<<"$health"
health_200=$(awk '/^        "200":/{capture=1} capture && /^        "503":/{exit} capture' <<<"$health")
grep -Fq 'status: { type: string, enum: [healthy, degraded] }' <<<"$health_200"
grep -Fq 'database: { type: string, const: healthy }' <<<"$health_200"
grep -Fq 'realtime: { type: string, enum: [healthy, degraded] }' <<<"$health_200"

echo 'workflow 6 contract and E2E port checks passed'
