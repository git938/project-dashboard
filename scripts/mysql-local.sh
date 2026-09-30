#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MYSQL_BASE_DIR="${MYSQL_BASE_DIR:-/Users/binli/Library/Application Support/Local/lightning-services/mysql-8.0.16+6/bin/darwin}"
SOCKET=/tmp/project-dashboard-mysql.sock
case "${1:-status}" in
 start)
  if "$MYSQL_BASE_DIR/bin/mysqladmin" --defaults-file="$ROOT/.local/admin.cnf" ping >/dev/null 2>&1; then
   echo 'Project MySQL is already running.'; exit 0
  fi
  "$MYSQL_BASE_DIR/bin/mysqld" --no-defaults --basedir="$MYSQL_BASE_DIR" --datadir="$ROOT/.local/mysql" --socket="$SOCKET" --pid-file="$ROOT/.local/mysql.pid" --log-error="$ROOT/.local/mysql.log" --bind-address=127.0.0.1 --port=3306 --mysqlx=0 --default-time-zone=+00:00 --daemonize
  "$MYSQL_BASE_DIR/bin/mysqladmin" --defaults-file="$ROOT/.local/admin.cnf" ping
  ;;
 stop) "$MYSQL_BASE_DIR/bin/mysqladmin" --defaults-file="$ROOT/.local/admin.cnf" shutdown ;;
 status) "$MYSQL_BASE_DIR/bin/mysqladmin" --defaults-file="$ROOT/.local/admin.cnf" ping ;;
 shell) exec "$MYSQL_BASE_DIR/bin/mysql" --defaults-file="$ROOT/.local/app.cnf" ;;
 *) echo 'Usage: scripts/mysql-local.sh {start|stop|status|shell}'; exit 2 ;;
esac
