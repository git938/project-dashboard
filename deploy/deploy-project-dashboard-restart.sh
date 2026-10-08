#!/usr/bin/env bash
#
# Privileged half of a project-dashboard deploy.
#
# Runs as root from the unit's ExecStartPost (the "+" prefix) so that the sync
# step can stay unprivileged. Restarting the app is the only thing that needs
# root, and keeping it here means no polkit rule is required -- on polkit 0.105
# that matters, because 0.105 ignores /etc/polkit-1/rules.d/*.rules entirely.
#
# Restarts only when the checkout actually moved (the sync step drops a marker),
# or when the unit stopped the service for a frozen backup. Then it gates on
# /api/ready and fails the unit if the app does not come back.

set -Eeuo pipefail

SERVICE="${DEPLOY_SERVICE:-project-dashboard}"
MARKER_DIR="${RUNTIME_DIRECTORY:-/run/project-dashboard-deploy}"
STATE_DIR="${DEPLOY_STATE_DIR:-/var/lib/project-dashboard}"
STATE_FILE="$STATE_DIR/deployed-sha"
READY_URL="${DEPLOY_READY_URL:-http://127.0.0.1:3100/api/ready}"
ATTEMPTS="${DEPLOY_READY_ATTEMPTS:-15}"
INTERVAL="${DEPLOY_READY_INTERVAL:-2}"
STOP_FOR_BACKUP="${DEPLOY_STOP_FOR_BACKUP:-0}"
DRY_RUN="${DEPLOY_DRY_RUN:-0}"
SKIP_RESTART="${DEPLOY_SKIP_RESTART:-0}"

say() { printf '[deploy] %s\n' "$*"; }

# Remember which commit the app is actually running, so a deploy interrupted
# between "files updated" and "restarted" can be detected and finished by the
# next run. This script runs as root, so the file is handed back to the owner of
# the state directory rather than left root-owned.
record_activation() {
  [ -f "$MARKER_DIR/activate" ] || return 0
  local sha owner tmp
  sha="$(cat "$MARKER_DIR/activate")"
  rm -f "$MARKER_DIR/activate"
  [ -n "$sha" ] || return 0
  if [ "$DRY_RUN" = "1" ]; then
    say "dry-run: would record activated commit $sha in $STATE_FILE"
    return 0
  fi
  owner="$(stat -c '%U:%G' "$STATE_DIR" 2>/dev/null || true)"
  if [ -z "$owner" ]; then
    say "WARNING: $STATE_DIR is missing; cannot record the activated commit"
    return 0
  fi
  tmp="$(mktemp)"
  printf '%s\n' "$sha" > "$tmp"
  if install -o "${owner%%:*}" -g "${owner##*:}" -m 0644 "$tmp" "$STATE_FILE" 2>/dev/null; then
    say "recorded activated commit $sha"
  else
    say "WARNING: could not write $STATE_FILE"
  fi
  rm -f "$tmp"
}

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN: privileged actions are logged, not executed"
  systemctl() { say "dry-run: systemctl $*"; }
  journalctl() { say "dry-run: journalctl $*"; }
fi

changed=0
[ -e "$MARKER_DIR/changed" ] && changed=1

if [ "$changed" = "1" ] || [ "$STOP_FOR_BACKUP" = "1" ]; then
  rm -f "$MARKER_DIR/changed"
  if [ "$SKIP_RESTART" = "1" ]; then
    say "DEPLOY_SKIP_RESTART=1 -- not restarting $SERVICE; readiness is still verified"
  else
    if [ "$STOP_FOR_BACKUP" = "1" ] && [ "$changed" != "1" ]; then
      say "restarting $SERVICE (it was stopped for the backup)"
    else
      say "checkout changed -> restarting $SERVICE"
    fi
    systemctl restart "$SERVICE"
  fi
else
  say "checkout unchanged -> no restart needed"
fi

# Readiness gate: a deploy that leaves the app down must fail loudly.
for attempt in $(seq 1 "$ATTEMPTS"); do
  if curl --fail --silent --show-error --max-time 3 "$READY_URL" >/dev/null 2>&1; then
    say "ready after ${attempt} attempt(s): $READY_URL"
    record_activation
    exit 0
  fi
  sleep "$INTERVAL"
done

say "ERROR: $SERVICE did not become ready at $READY_URL after $((ATTEMPTS * INTERVAL))s"
systemctl is-active "$SERVICE" 2>&1 | sed 's/^/[deploy]   state: /' || true
journalctl -u "$SERVICE" -n 40 --no-pager 2>&1 | sed 's/^/[deploy]   /' || true
exit 1
