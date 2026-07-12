#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/logs/dash.pid"

# shellcheck disable=SC1090
. "$DIR/local/chrome-control.sh"
. "$DIR/local/dashboard-utils.sh"

if [ -r "$PID_FILE" ]; then
  dashboard_pid=$(cat "$PID_FILE" 2>/dev/null)
  signal_owned_process "$dashboard_pid" "extensions/kindle-dash/dash.sh" TERM "$DIR" >/dev/null 2>&1 ||
    signal_owned_process "$dashboard_pid" "./dash.sh" TERM "$DIR" >/dev/null 2>&1 || true
fi

pkill -f "/mnt/us/extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true
pkill -f "extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true
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
