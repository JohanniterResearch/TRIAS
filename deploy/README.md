# Ambulanzsystem – Deployment on Proxmox VE (Debian/Ubuntu)

This bundle contains everything needed to run the app: the prebuilt app image, Postgres,
and Caddy (HTTPS reverse proxy). The only thing the install downloads is Docker itself,
if the machine doesn't have it yet.

## Requirements

- Debian 12 or Ubuntu 22.04/24.04 running as a VM on Proxmox. An LXC container also works, but only
  with `nesting=1,keyctl=1` enabled under Options → Features.
- At least 2 GB RAM, 2 cores, and 10 GB disk.
- Ports 80 and 443 free and reachable from the devices that will use the app.
- Internet access on first install, unless Docker is already installed.
- A static IP or DHCP reservation for the VM. The certificate and allowed origin are tied to
  the address. If it changes anyway, edit `SITE_ADDRESS` in `.env` and rerun `install.sh`.
- If the Proxmox firewall is enabled, allow 80/tcp, 443/tcp, and 443/udp.

## Install

1. Drag `Ambulanzsystem_Deploy.tar.gz` onto the server, for example with WinSCP, `scp`, or the
   Proxmox file upload.
2. On the server, run:

   ```sh
   tar -xzf Ambulanzsystem_Deploy.tar.gz
   cd ambulanzsystem
   sudo bash install.sh
   ```

   Use `sudo bash install.sh`, not `./install.sh`. Uploading with drag and drop often drops the
   file's execute permission.

3. The script prints the app URL and the initial `admin` password. On the first run, check that
   the URL shows the address clients actually use. You'll be asked to change the password the
   first time you log in.

Install options, which are only read on the very first run:

- `sudo bash install.sh 192.168.1.50` uses that address instead of the machine's first IP.
- `sudo bash install.sh ambulanz.example.org it@example.org` gets a real Let's Encrypt
  certificate. This needs public DNS for the name and port 80 reachable from the internet.

## HTTPS on client devices (default self-signed mode)

Scanning QR codes with the camera and using the app offline both require HTTPS that the device
trusts. `install.sh` exports the local root certificate to `ambulanzsystem-root-ca.crt`. Copy
that file to every tablet, phone, and PC that uses the app, and install it:

- **Android:** Settings → Security → Encryption & credentials → Install a certificate →
  CA certificate.
- **iOS/iPadOS:** open the file, then Settings → General → VPN & Device Management → install
  the profile. Then go to Settings → General → About → Certificate Trust Settings and turn on
  full trust.
- **Windows:** double-click the file → Install Certificate → Local Machine → "Trusted Root
  Certification Authorities".

The certificate is stored in a Docker volume and stays the same across restarts and upgrades.
Only `docker compose down -v` deletes it, and that command also deletes the database.

## Behind a reverse proxy (e.g. NPMplus)

Use this mode when another proxy owns the public DNS name and certificate and forwards plain
HTTP to this server. Add these lines to `.env` (`sudo nano .env`) and change `SITE_ADDRESS` to
the public DNS name. Leave every other value unchanged.

```
SITE_ADDRESS=ambulanz.example.org
COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
TRUSTED_PROXY=10.11.7.100
HTTP_PORT=8080
```

- `TRUSTED_PROXY` is the IP address the upstream proxy connects from. Only that address may pass
  on the real client IP, which the app's per-IP rate limiting depends on.
- `HTTP_PORT` is the port the upstream proxy forwards to.

Then run `sudo bash install.sh`. In this mode ports 80 and 443 are not used, and devices don't
need the self-signed certificate.

Settings for the NPMplus proxy host:

- Scheme `http`, forwarded to this server's IP on port `HTTP_PORT`.
- **Websockets Support** on. Live updates need it.
- A Let's Encrypt certificate under SSL, with Force SSL on.

Live updates send the session token in the `/hubs/scene` query string, so the proxy's access log
must not record query strings. On the NPMplus host, run
`bash scripts/verify-signalr-token-logging.sh https://<public-name> /data/logs/proxy-host-<id>_access.log`
(copy the script there first). If it fails, add to the proxy host's Advanced tab a `log_format` without
`$args` for this host (never a Custom Location `/`: NPMplus rejects it and takes the host offline).

To confirm `TRUSTED_PROXY` is right, run `sudo docker compose exec caddy netstat -tn` while
someone uses the site. The foreign addresses on `:8080` must be the `TRUSTED_PROXY` IP.

## Operation

Run these commands from the `ambulanzsystem` folder:

- `sudo docker compose ps` shows the status.
- `sudo docker compose logs -f backend` shows the app logs.
- `sudo docker compose restart` restarts the app. The stack also starts automatically after the
  VM reboots.
- `sudo bash scripts/backup.sh` creates a verified database backup in `backups/` right away.
- Login is limited to 10 attempts per minute per client IP. If many devices share one venue
  NAT or LTE router, set `LOGIN_RATE_LIMIT=<n>` (and `REFRESH_RATE_LIMIT`) in `.env` to the agreed
  pilot peak (gate G4) and run `sudo docker compose up -d`.

`.env` holds all secrets. Keep it and back it up. Never delete or regenerate it for an
existing database: the app refuses to start if `BACKUP_EXPECTED_DEPLOYMENT_ID` changes, and
Postgres keeps its original password.

## Backups

- `install.sh` installs `ambulanz-backup.timer`, which runs `scripts/backup.sh` every night at 01:30.
  It writes `backups/ambulanz-<timestamp>.dump` (PostgreSQL custom format) and keeps the newest 14
  (`BACKUP_KEEP` in `.env` changes that). Check it with `systemctl list-timers ambulanz-backup.timer`
  and `journalctl -u ambulanz-backup.service`.
- The backup refuses to run if the database's deployment ID doesn't match `.env`, so a dump can't
  come from the wrong installation.
- **Off-host copy:** the Proxmox admin runs a Proxmox Backup Server job for this container daily
  **after 01:30**, with client-side encryption. That snapshot contains `.env`, the `backups/` folder
  and the Docker volumes (including `dataprotection`), which together are everything a restore needs. The
  dumps inside this container alone are **not** a backup: they die with the container.
- **Restore drill** (non-destructive, run at least once per quarter and after upgrades):
  `sudo bash scripts/verify-restore.sh backups/<file>.dump` restores into a throwaway database
  and checks schema, migrations and deployment ID. Record the result in `docs/pilot/acceptance-evidence.md`.

### Restoring for real

Only after deciding with the operations owner that the live data is to be replaced:

```sh
sudo docker compose stop backend caddy
sudo docker compose exec -T db dropdb -U pls ambulanzsystem
sudo docker compose exec -T db createdb -U pls ambulanzsystem
sudo docker compose exec -T db pg_restore -U pls -d ambulanzsystem --no-owner < backups/<file>.dump
sudo docker compose start backend caddy
```

A dump belongs to its `.env` (deployment ID, DB password). To restore the whole container, the
Proxmox admin restores the PBS snapshot instead.

## Upgrade

Unpack the new bundle over the existing folder (`.env` is not part of the bundle, so yours
is kept), then run `sudo bash install.sh` again. It takes a backup first, then starts the new
version; database migrations run automatically when the app starts.

### Upgrade notes

- **First release with the non-root container:** data-protection keys move to the new
  `dataprotection` volume. Admin patient/QR links issued before the upgrade stop working (reload
  the admin page); no data is affected. The old `ambulanzsystem_dpkeys` volume can be removed with
  `sudo docker volume rm ambulanzsystem_dpkeys` afterwards.

## Rollback

Every bundle also tags its image with the git commit (`sudo docker image ls ambulanzsystem-backend`).
To go back to the previous version:

1. If the new version ran a database migration, restore the dump `install.sh` took before the
   upgrade (see "Restoring for real"). Migrations are not reversed automatically.
2. Add `APP_IMAGE=ambulanzsystem-backend:<previous-sha>` to `.env` and run `sudo docker compose up -d`.
3. Remove the `APP_IMAGE` line again with the next regular upgrade.

## Rebuilding the bundle (dev machine)

From the repository, run `bash deploy/make-bundle.sh [git-ref] [output-dir]`. The defaults are
`origin/main` and `../Ambulanzsystem_Deploy`. The script builds the image from the committed
sources of that ref (never the working tree) and writes `Ambulanzsystem_Deploy.tar.gz`.

Before shipping, `bash deploy/scripts/smoke.sh ambulanzsystem-backend:<sha>` starts that image in
an isolated stack, checks health, headers, login and a protocol export, and removes the stack again.
