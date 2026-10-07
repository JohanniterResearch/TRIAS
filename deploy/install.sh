#!/usr/bin/env bash
# Installs or upgrades Ambulanzsystem on Ubuntu. Safe to re-run.
#   sudo bash install.sh [SITE_ADDRESS] [TLS_ISSUER]
#   SITE_ADDRESS  IP or DNS name clients use (default: first IP of this machine)
#   TLS_ISSUER    "internal" (default, self-signed) or an e-mail address for Let's Encrypt
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

[ "$(id -u)" -eq 0 ] || { echo "Please run: sudo bash install.sh" >&2; exit 1; }

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "==> Installing Docker (needs internet)"
  apt-get update -q
  apt-get install -y -q curl ca-certificates
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

# .env is generated exactly once. The deployment ID is written immutably into the database and
# Postgres only applies DB_PASSWORD on first init, so regenerating either would brick the install.
if [ ! -f .env ]; then
  site=${1:-$(hostname -I | awk '{print $1}')}
  cat > .env <<EOF
SITE_ADDRESS=$site
TLS_ISSUER=${2:-internal}
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -hex 8)
BACKUP_EXPECTED_DEPLOYMENT_ID=ambulanz-$(hostname -s)-$(date +%Y%m%d)-$(openssl rand -hex 4)
EOF
  chmod 600 .env
  echo "==> Created .env for https://$site"
elif [ $# -gt 0 ]; then
  echo "==> .env already exists; ignoring arguments. Edit .env to change SITE_ADDRESS/TLS_ISSUER." >&2
fi
set -a; . ./.env; set +a

echo "==> Loading images"
docker load -i images.tar.gz

# Migrations are forward-only: an upgrade's rollback point is the dump taken right before it.
if docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  echo "==> Backing up before upgrade"
  bash scripts/backup.sh
fi

echo "==> Starting"
docker compose up -d --remove-orphans

echo "==> Installing nightly backup timer"
sed "s#@ROOT@#$PWD#g" systemd/ambulanz-backup.service > /etc/systemd/system/ambulanz-backup.service
cp systemd/ambulanz-backup.timer /etc/systemd/system/ambulanz-backup.timer
systemctl daemon-reload
systemctl enable --now ambulanz-backup.timer >/dev/null

echo -n "==> Waiting for the app"
if [ -n "${TRUSTED_PROXY:-}" ]; then
  health=(http://127.0.0.1:"${HTTP_PORT:-8080}"/health)
else
  health=(--resolve "$SITE_ADDRESS:443:127.0.0.1" "https://$SITE_ADDRESS/health")
fi
for _ in $(seq 60); do
  if curl -fsk "${health[@]}" >/dev/null 2>&1; then
    ok=1; break
  fi
  echo -n .; sleep 3
done
echo
[ "${ok:-}" ] || { echo "App did not become healthy. Check: docker compose logs backend caddy" >&2; exit 1; }

# Behind a proxy the upstream holds the real certificate; the local CA is irrelevant there.
if [ -z "${TRUSTED_PROXY:-}" ] && [ "$TLS_ISSUER" = internal ]; then
  docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./ambulanzsystem-root-ca.crt >/dev/null
  chmod 644 ambulanzsystem-root-ca.crt
  echo "==> Root certificate for client devices: $PWD/ambulanzsystem-root-ca.crt (see README)"
fi

cat <<EOF

Ambulanzsystem is running:  https://$SITE_ADDRESS
Initial admin login:        admin / $BOOTSTRAP_ADMIN_PASSWORD
(only valid on a fresh database; you are asked to change it on first login)
EOF
