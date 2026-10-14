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

# Optional PLS client site (PLS parity plan WP 7.2): PLS_SITE_ADDRESS in .env, e.g. a second
# DNS name for this machine. The bundle carries the build in pls/.
mkdir -p sites pls
if [ -n "${PLS_SITE_ADDRESS:-}" ]; then
  [ -f pls/index.html ] || { echo "PLS_SITE_ADDRESS is set, but this bundle has no PLS build (pls/index.html)." >&2; exit 1; }
  cp pls.caddy sites/pls.caddy
else
  rm -f sites/pls.caddy
fi

# Optional MQTT feed for former PLS consumers (WP 7.1): MQTT_ENABLED=true in .env starts the broker.
profiles=()
# The backend reads the same value; anything but true/false (any case) would make it fail to start.
MQTT_ENABLED=$(printf '%s' "${MQTT_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')
case "$MQTT_ENABLED" in
  true|false) ;;
  *) echo "MQTT_ENABLED must be true or false." >&2; exit 1 ;;
esac
if [ "$MQTT_ENABLED" = true ]; then
  if [ -z "${MQTT_PASSWORD:-}" ]; then
    # A new optional key is appended once; existing keys are never rewritten. A last line
    # without a newline would otherwise swallow the new key.
    [ -z "$(tail -c1 .env)" ] || echo >> .env
    echo "MQTT_PASSWORD=$(openssl rand -hex 24)" >> .env
    set -a; . ./.env; set +a
  fi
  # The password goes through a 0600 file, not the command line (visible in ps), and is hashed
  # in place with umask 077, so neither form is ever world-readable. A failed hash leaves no
  # plain-text file behind.
  rm -f mosquitto/passwd
  (umask 077; printf 'ambulanzsystem-backend:%s\n' "$MQTT_PASSWORD" > mosquitto/passwd)
  docker run --rm -v "$PWD/mosquitto:/work" eclipse-mosquitto:2 \
    sh -c 'umask 077 && mosquitto_passwd -U /work/passwd' || { rm -f mosquitto/passwd; exit 1; }
  # Read-only mount: the broker (uid 1883) cannot fix ownership itself.
  chown 1883:1883 mosquitto/passwd && chmod 600 mosquitto/passwd
  profiles=(--profile mqtt)
else
  # Turned off: a broker from an earlier install stops too (--remove-orphans keeps services of
  # an inactive profile). Its retained patient state stays in the mosquitto_data volume; see
  # README, "MQTT feed".
  docker compose --profile mqtt rm -sf mosquitto >/dev/null 2>&1 || true
  rm -f mosquitto/passwd
fi

echo "==> Starting"
docker compose "${profiles[@]}" up -d --remove-orphans

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

Ambulanzsystem is running:  https://$SITE_ADDRESS${PLS_SITE_ADDRESS:+
PLS client:                 https://$PLS_SITE_ADDRESS}
Initial admin login:        admin / $BOOTSTRAP_ADMIN_PASSWORD
(only valid on a fresh database; you are asked to change it on first login)
EOF
