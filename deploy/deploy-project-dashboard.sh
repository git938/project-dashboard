#!/usr/bin/env bash
#
# Sync the project-dashboard deployment target from GitHub.
#
# OWNERSHIP MODEL
#   /opt/project-dashboard is a deployment target, not a workspace. It is owned
#   entirely by the service user (project-dashboard), and this script is the only
#   thing that writes to it. It therefore MUST run as that user: running it as
#   root leaves root-owned files inside .git and node_modules, which is exactly
#   the failure this design exists to prevent.
#
#   Contributors never run this. They work in their own clone, push to GitHub,
#   and trigger the systemd unit.
#
# WHAT IT DOES
#   fetch -> verify history is a fast-forward -> back up -> update code ->
#   install dependencies -> migrate -> drop a marker for the privileged restart.
#
# WHAT IT DELIBERATELY DOES NOT DO
#   * systemctl. Restarting the app needs privilege, and mixing privilege into
#     this process is what corrupts ownership. The unit does that separately.
#   * git clean. Untracked files in the target (.env, uploads) are configuration
#     and state, not drift, and must survive a deploy.
#   * Depend on node_modules. The .env is parsed with plain node, so a deploy
#     works even when dependencies are missing (a previous version imported
#     dotenv from api/node_modules, which made "install" and "read config"
#     mutually dependent).

set -Eeuo pipefail
umask 077

TARGET="${DEPLOY_TARGET:-/opt/project-dashboard}"
REMOTE="${DEPLOY_REMOTE:-origin}"
BRANCH="${DEPLOY_BRANCH:-main}"
BACKUP_ROOT="${DEPLOY_BACKUP_ROOT:-/var/backups/project-dashboard}"
BACKUP_KEEP="${DEPLOY_BACKUP_KEEP:-20}"
EXPECTED_COMMIT="${DEPLOY_EXPECTED_COMMIT:-}"
INSTALL_DEPS="${DEPLOY_INSTALL_DEPS:-1}"
MIGRATE="${DEPLOY_MIGRATE:-1}"
DISCARD_DRIFT="${DEPLOY_DISCARD_DRIFT:-0}"
MARKER_DIR="${RUNTIME_DIRECTORY:-/run/project-dashboard-deploy}"

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

# --- guards ---------------------------------------------------------------
if [ "$(id -u)" -eq 0 ]; then
  if [ "${DEPLOY_ALLOW_ROOT:-0}" != "1" ]; then
    die "refusing to run as root. Run as the service user (systemctl start project-dashboard-deploy) so .git and node_modules stay service-owned."
  fi
  log "WARNING: DEPLOY_ALLOW_ROOT=1 -- ownership guard disabled; never use this against the real target."
fi

[ -d "$TARGET/.git" ] || die "$TARGET is not a git checkout"
[ -O "$TARGET" ] || die "$TARGET is not owned by $(id -un); refusing to touch it. Fix ownership first."
[ -O "$TARGET/.git" ] || die "$TARGET/.git is not owned by $(id -un); refusing to fetch into it -- ref updates would fail part-way. Fix ownership first."
[ -f "$TARGET/.env" ] || die "$TARGET/.env is missing"

cd "$TARGET"

current_branch="$(git symbolic-ref --quiet --short HEAD || echo '(detached)')"
[ "$current_branch" = "$BRANCH" ] || die "target is on '$current_branch', expected '$BRANCH'"

before="$(git rev-parse HEAD)"
log "target  : $TARGET"
log "current : $before $(git log -1 --format=%s | cut -c1-56)"

# --- fetch ----------------------------------------------------------------
log "fetching $REMOTE/$BRANCH"
git fetch --prune "$REMOTE" "$BRANCH"
want="$(git rev-parse "$REMOTE/$BRANCH")"
log "remote  : $want"

git merge-base --is-ancestor HEAD "$want" || die "history diverged: HEAD is not an ancestor of $REMOTE/$BRANCH. Refusing to rewrite the target; resolve this deliberately."
if [ -n "$EXPECTED_COMMIT" ]; then
  git merge-base --is-ancestor "$EXPECTED_COMMIT" "$want" || die "$REMOTE/$BRANCH does not contain the required commit $EXPECTED_COMMIT"
  log "required commit $EXPECTED_COMMIT is present"
fi

# --- drift ----------------------------------------------------------------
# Single-owner semantics: the target holds no authored work, so anything local is
# an anomaly worth shouting about rather than silently overwriting.
if [ -n "$(git status --porcelain)" ]; then
  if [ "$DISCARD_DRIFT" = "1" ]; then
    log "WARNING: DEPLOY_DISCARD_DRIFT=1 -- discarding local changes in the deployment target:"
    git status --porcelain | sed 's/^/    /'
    git reset --hard HEAD >/dev/null
  else
    log "STOP: the deployment target has local changes."
    git status --porcelain | sed 's/^/    /'
    die "someone is writing to the deployment target. Nobody should. Inspect before deploying, or set DEPLOY_DISCARD_DRIFT=1 to throw the changes away."
  fi
fi

# --- nothing to do? -------------------------------------------------------
if [ "$before" = "$want" ]; then
  log "already at $want; nothing to do"
  exit 0
fi

# --- read config without node_modules -------------------------------------
# Plain node, no imports: parsing .env must not depend on `npm ci` having run.
tmp_env="$(mktemp)"; tmp_db="$(mktemp)"
cleanup() { rm -f "$tmp_env" "$tmp_db"; }
trap cleanup EXIT

node --input-type=module - "$tmp_env" "$tmp_db" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const text = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of text.split(/\r?\n/)) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) continue;
  let value = match[2].trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1);
  }
  env[match[1]] = value;
}
const quote = value => '"' + String(value)
  .replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  .replaceAll('\n', '\\n').replaceAll('\r', '\\r') + '"';
const client = {
  host: env.DB_HOST || '127.0.0.1',
  port: env.DB_PORT || '3306',
  user: env.DB_USER || 'admin',
  password: env.DB_PASS ?? '',
  protocol: 'TCP'
};
fs.writeFileSync(process.argv[2], '[client]\n' + Object.entries(client).map(([k, v]) => `${k}=${quote(v)}`).join('\n') + '\n', { mode: 0o600 });
fs.writeFileSync(process.argv[3], JSON.stringify({ db: env.DB_NAME || 'projects', uploads: path.resolve(env.UPLOAD_DIR || '.local/uploads') }), { mode: 0o600 });
NODE

db_name="$(node -pe "JSON.parse(require('fs').readFileSync('$tmp_db','utf8')).db")"
uploads_dir="$(node -pe "JSON.parse(require('fs').readFileSync('$tmp_db','utf8')).uploads")"
[ -d "$uploads_dir" ] || die "upload directory missing: $uploads_dir"

# --- backup ---------------------------------------------------------------
stamp="$(date +%Y%m%d-%H%M%S)"
backup="$BACKUP_ROOT/project-dashboard-$stamp-${before:0:7}"
mkdir -p "$BACKUP_ROOT"
chmod 750 "$BACKUP_ROOT" 2>/dev/null || true
[ -O "$BACKUP_ROOT" ] || die "$BACKUP_ROOT is not owned by $(id -un)"

mkdir -p "$backup"
log "backing up to $backup"
cp .env "$backup/environment.backup"
printf '%s\n' "$before" > "$backup/previous-commit.txt"

if command -v mysqldump >/dev/null 2>&1; then
  # --single-transaction gives a consistent InnoDB snapshot without stopping the
  # app. Set DEPLOY_STOP_FOR_BACKUP=1 on the unit to freeze it as well.
  mysqldump --defaults-extra-file="$tmp_env" \
    --single-transaction --no-tablespaces --set-gtid-purged=OFF --hex-blob \
    "$db_name" > "$backup/database.sql" \
    || die "mysqldump failed; nothing was changed. Backup dir: $backup"
  log "  database.sql  $(du -h "$backup/database.sql" | cut -f1) ($db_name)"
else
  log "  WARNING: mysqldump not found -- database NOT backed up"
fi

tar -czf "$backup/uploads.tar.gz" -C "$(dirname "$uploads_dir")" "$(basename "$uploads_dir")" \
  || die "uploads archive failed. Backup dir: $backup"
log "  uploads.tar.gz  $(du -h "$backup/uploads.tar.gz" | cut -f1)"

# --- update ---------------------------------------------------------------
log "fast-forwarding $before -> $want"
git merge --ff-only "$want" >/dev/null
cmp --silent .env "$backup/environment.backup" || die ".env changed during the update; refusing to continue"

# --- dependencies and schema ---------------------------------------------
if [ "$INSTALL_DEPS" = "1" ] && [ -f api/package-lock.json ]; then
  log "installing dependencies (npm ci)"
  ( cd api && npm ci --no-audit --no-fund )
fi

if [ "$MIGRATE" = "1" ]; then
  log "running migrations"
  npm run --prefix api db:migrate
fi

# --- hand off to the privileged restart ----------------------------------
mkdir -p "$MARKER_DIR"
: > "$MARKER_DIR/changed"
log "checkout moved: $before -> $want"
log "backup: $backup"

# --- retention ------------------------------------------------------------
if [ "$BACKUP_KEEP" -gt 0 ]; then
  find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'project-dashboard-*' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | tail -n +"$((BACKUP_KEEP + 1))" | cut -d' ' -f2- \
    | while IFS= read -r old; do
        [ -n "$old" ] || continue
        log "pruning old backup: $(basename "$old")"
        rm -rf -- "$old"
      done
fi

log "done"
