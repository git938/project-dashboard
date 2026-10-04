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
READY_URL="${DEPLOY_READY_URL:-http://127.0.0.1:3100/api/ready}"
ATTEMPTS="${DEPLOY_READY_ATTEMPTS:-15}"
INTERVAL="${DEPLOY_READY_INTERVAL:-2}"
STOP_FOR_BACKUP="${DEPLOY_STOP_FOR_BACKUP:-0}"
DRY_RUN="${DEPLOY_DRY_RUN:-0}"

say() { printf '[deploy] %s\n' "$*"; }

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN: privileged actions are logged, not executed"
  systemctl() { say "dry-run: systemctl $*"; }
  journalctl() { say "dry-run: journalctl $*"; }
fi

changed=0
[ -e "$MARKER_DIR/changed" ] && changed=1

if [ "$changed" = "1" ] || [ "$STOP_FOR_BACKUP" = "1" ]; then
  rm -f "$MARKER_DIR/changed"
  if [ "$STOP_FOR_BACKUP" = "1" ] && [ "$changed" != "1" ]; then
    say "restarting $SERVICE (it was stopped for the backup)"
  else
    say "checkout changed -> restarting $SERVICE"
  fi
  systemctl restart "$SERVICE"
else
  say "checkout unchanged -> no restart needed"
fi

# Readiness gate: a deploy that leaves the app down must fail loudly.
for attempt in $(seq 1 "$ATTEMPTS"); do
  if curl --fail --silent --show-error --max-time 3 "$READY_URL" >/dev/null 2>&1; then
    say "ready after ${attempt} attempt(s): $READY_URL"
    exit 0
  fi
  sleep "$INTERVAL"
done

say "ERROR: $SERVICE did not become ready at $READY_URL after $((ATTEMPTS * INTERVAL))s"
systemctl is-active "$SERVICE" 2>&1 | sed 's/^/[deploy]   state: /' || true
journalctl -u "$SERVICE" -n 40 --no-pager 2>&1 | sed 's/^/[deploy]   /' || true
exit 1
