#!/usr/bin/env bash
set -euo pipefail

base_url=${1:?Usage: scripts/verify-signalr-token-logging.sh BASE_URL NGINX_ACCESS_LOG}
access_log=${2:?Usage: scripts/verify-signalr-token-logging.sh BASE_URL NGINX_ACCESS_LOG}
control_marker="proxy-log-control-$(date +%s)-$$"
token_marker="signalr-query-token-$(date +%s)-$$"

test -r "$access_log"
curl -sS -o /dev/null --max-time 10 "${base_url%/}/$control_marker"
for _ in $(seq 1 10); do
  grep -Fq -- "$control_marker" "$access_log" && break
  sleep 0.5
done
grep -Fq -- "$control_marker" "$access_log" || {
  echo "Control request was not found in $access_log; verify the deployed log path." >&2
  exit 1
}

curl -sS -o /dev/null --max-time 10 -X POST \
  "${base_url%/}/hubs/scene/negotiate?negotiateVersion=1&access_token=$token_marker"
sleep 0.5

if grep -Fq -- "$token_marker" "$access_log"; then
  echo "SignalR access_token leaked into $access_log" >&2
  exit 1
fi

echo "SignalR query-token log check passed: control logged, token marker absent from $access_log"
