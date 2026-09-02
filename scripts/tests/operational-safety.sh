#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

mkdir "$test_root/bin"
cat >"$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_DOCKER_LOG"

case " $* " in
  *" up "*) exit 0 ;;
  *" ps --status running --services db "*)
    test "$FAKE_DOCKER_MODE" = missing || echo db
    ;;
  *" exec -T db psql "*)
    if test "$FAKE_DOCKER_MODE" = wrong; then
      echo wrong-target
    elif test "$FAKE_DOCKER_MODE" = empty; then
      echo empty-target
    elif test "$FAKE_DOCKER_MODE" = wrong-valid && [[ "$*" == *deployment_id* ]]; then
      echo wrong-deployment
    elif test "$FAKE_DOCKER_MODE" = restore-wrong-deployment && [[ "$*" == *deployment_id* ]]; then
      echo wrong-deployment
    elif [[ "$*" == *deployment_id* ]]; then
      echo ok
    elif test "$FAKE_DOCKER_MODE" = wrong-valid; then
      echo ok
    else
      echo ok
    fi
    ;;
  *" exec -T db pg_dump "*) printf 'valid custom dump\n' ;;
  *" exec -T db pg_restore --list "*) test "$FAKE_DOCKER_MODE" != invalid ;;
  *" exec -T db createdb "*) test "$FAKE_DOCKER_MODE" != restore-collision ;;
  *" exec -T db dropdb "*) exit 0 ;;
  *" exec -T db pg_restore -U pls -d "*) exit 0 ;;
esac
EOF
chmod +x "$test_root/bin/docker"

run_backup() {
  local mode=$1 output=$2 log=$3
  PATH="$test_root/bin:$PATH" \
    FAKE_DOCKER_MODE="$mode" \
    FAKE_DOCKER_LOG="$log" \
    COMPOSE_PROJECT_NAME=ambulanz-test \
    BACKUP_EXPECTED_DEPLOYMENT_ID=intended-deployment \
    DB_PASSWORD=test \
    JWT_SECRET=12345678901234567890123456789012 \
    BOOTSTRAP_ADMIN_PASSWORD=test \
    PLS_ALLOWED_ORIGINS=https://test.invalid \
    "$repo_root/scripts/backup.sh" "$output"
}

for mode in missing wrong empty invalid wrong-valid; do
  output="$test_root/$mode.dump"
  log="$test_root/$mode.log"
  if run_backup "$mode" "$output" "$log" >/dev/null 2>&1; then
    echo "backup unexpectedly succeeded for $mode database" >&2
    exit 1
  fi
  test ! -e "$output"
  ! find "$test_root" -maxdepth 1 -name ".${mode}.dump.tmp.*" -print -quit | grep -q .
done
! grep -q 'exec -T db pg_dump' "$test_root/wrong-valid.log"

intended_output="$test_root/intended.dump"
intended_log="$test_root/intended.log"
run_backup intended "$intended_output" "$intended_log" >/dev/null
test -s "$intended_output"
! grep -Eq '(^| )up( |$)' "$test_root"/*.log
grep -q 'ps --status running --services db' "$intended_log"
grep -q 'exec -T db psql' "$intended_log"
grep -q 'exec -T db pg_dump' "$intended_log"
grep -q 'exec -T db pg_restore --list' "$intended_log"

run_restore() {
  local mode=$1 log=$2
  PATH="$test_root/bin:$PATH" \
    FAKE_DOCKER_MODE="$mode" \
    FAKE_DOCKER_LOG="$log" \
    COMPOSE_PROJECT_NAME=ambulanz-test \
    BACKUP_EXPECTED_DEPLOYMENT_ID=intended-deployment \
    "$repo_root/scripts/verify-restore.sh" "$intended_output"
}

# A pre-existing database occupying the generated restore name must survive: createdb
# failing on collision must not trigger cleanup of a database this invocation didn't create.
collision_log="$test_root/restore-collision.log"
if run_restore restore-collision "$collision_log" >/dev/null 2>&1; then
  echo "verify-restore unexpectedly succeeded despite a database name collision" >&2
  exit 1
fi
grep -q 'exec -T db createdb' "$collision_log"
! grep -q 'exec -T db dropdb' "$collision_log"

# A restore whose deployment identity doesn't match must be rejected, and the isolated
# restore database this invocation created must be dropped.
wrong_restore_log="$test_root/restore-wrong-deployment.log"
if run_restore restore-wrong-deployment "$wrong_restore_log" >/dev/null 2>&1; then
  echo "verify-restore unexpectedly succeeded despite wrong deployment identity" >&2
  exit 1
fi
grep -q 'exec -T db dropdb' "$wrong_restore_log"

# Restore database names must be randomly unique per invocation, not derived from a
# reusable/predictable identifier such as the shell PID.
collision_db=$(grep 'exec -T db createdb' "$collision_log" | awk '{print $NF}')
wrong_db=$(grep 'exec -T db createdb' "$wrong_restore_log" | awk '{print $NF}')
test "$collision_db" != "$wrong_db"

awk '
  /location \/hubs\/scene/ { hub = 1 }
  hub && /access_log off;/ { safe = 1 }
  hub && /^    }/ { exit }
  END { exit !safe }
' "$repo_root/docs/pilot/nginx.conf.example"
grep -q 'verify-signalr-token-logging.sh' "$repo_root/docs/pilot/operations.md"

grep -qx '!/docs/remediationPlan.md' "$repo_root/.gitignore"
grep -qx '\.claude-flow/' "$repo_root/.gitignore"
grep -qx '/backend/\.idea/' "$repo_root/.gitignore"
grep -qx '!/docs/KnownIssues.md' "$repo_root/.gitignore"

test -x "$repo_root/scripts/validate-compose.sh"
test -x "$repo_root/scripts/verify-signalr-token-logging.sh"

! grep -q 'DevTools.*Service Workers' "$repo_root/README.md"
grep -q 'npm start' "$repo_root/frontend/README.md"
grep -q 'situation-room-page.spec.ts' "$repo_root/docs/KnownIssues.md"

echo 'operational safety checks passed'
