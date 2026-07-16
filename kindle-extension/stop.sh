#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/logs/dash.pid"

# shellcheck disable=SC1090
. "$DIR/local/chrome-control.sh"
. "$DIR/local/dashboard-utils.sh"

if ! terminate_all_dashboard_processes "$DIR"; then
  echo "Kindle dashboard could not be stopped; native UI was not restored." >&2
  exit 1
fi
rm -f "$PID_FILE"

restore_kindle_chrome
lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
lipc-set-prop com.lab126.wifid enable 1 >/dev/null 2>&1 || true
/etc/init.d/framework start >/dev/null 2>&1 || true
initctl start framework >/dev/null 2>&1 || true
start framework >/dev/null 2>&1 || true
initctl start webreader >/dev/null 2>&1 || true
/usr/sbin/eips -c >/dev/null 2>&1 || true

echo "Kindle dashboard stopped; framework requested to start."
