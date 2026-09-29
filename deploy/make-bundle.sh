#!/usr/bin/env bash
# Rebuilds Ambulanzsystem_Deploy.tar.gz from a git ref of this repo (dev machine only).
#   bash deploy/make-bundle.sh [GIT_REF] [OUTPUT_DIR]   (defaults: origin/main, ../Ambulanzsystem_Deploy)
set -euo pipefail
repo=$(git -C "$(dirname "$(readlink -f "$0")")" rev-parse --show-toplevel)
ref=${1:-origin/main}
out=$(readlink -f "${2:-$repo/../Ambulanzsystem_Deploy}")
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

git -C "$repo" fetch -q origin
sha=$(git -C "$repo" rev-parse --short "$ref")
# git archive, not the working tree: only committed sources ship, never local .env/bin/node_modules.
git -C "$repo" archive "$ref" | tar -x -C "$work"
docker build -f "$work/backend/Dockerfile" -t ambulanzsystem-backend:bundle -t "ambulanzsystem-backend:$sha" "$work"

payload=$work/payload/ambulanzsystem
mkdir -p "$payload"
cp -r "$work"/deploy/{docker-compose.yml,docker-compose.proxy.yml,Caddyfile,Caddyfile.proxy,install.sh,README.md,scripts,systemd} "$payload/"
docker pull -q postgres:16-alpine
docker pull -q caddy:2-alpine
docker save ambulanzsystem-backend:bundle "ambulanzsystem-backend:$sha" postgres:16-alpine caddy:2-alpine \
  | gzip > "$payload/images.tar.gz"
echo "$ref $sha $(date -I)" > "$payload/VERSION"

mkdir -p "$out"
tar -czf "$out/Ambulanzsystem_Deploy.tar.gz" -C "$work/payload" ambulanzsystem
echo "Built $out/Ambulanzsystem_Deploy.tar.gz ($(cat "$payload/VERSION"))"
