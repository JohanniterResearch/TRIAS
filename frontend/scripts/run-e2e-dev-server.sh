#!/usr/bin/env bash
set -euo pipefail

backend_port=${BACKEND_PORT:-5042}
proxy_config=$(mktemp --suffix=.json)
cleanup() {
  rm -f "$proxy_config"
}
trap cleanup EXIT INT TERM

node - "$proxy_config" "$backend_port" <<'NODE'
const fs = require('node:fs');
const [proxyPath, backendPort] = process.argv.slice(2);
const target = `http://127.0.0.1:${backendPort}`;
fs.writeFileSync(proxyPath, JSON.stringify({
  '/api': { target, secure: false, changeOrigin: true },
  '/hubs': { target, secure: false, changeOrigin: true, ws: true },
}));
NODE

npm start -- --proxy-config "$proxy_config" "$@"