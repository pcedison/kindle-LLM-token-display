#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
LOG_FILE="$DIR/logs/dash.log"
PID_FILE="$DIR/logs/dash.pid"

mkdir -p "$DIR/logs"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
. "$DIR/local/dashboard-utils.sh"

if [ -r "$PID_FILE" ]; then
  previous_pid=$(cat "$PID_FILE" 2>/dev/null)
  signal_owned_process "$previous_pid" "extensions/kindle-dash/dash.sh" TERM "$DIR" >/dev/null 2>&1 ||
    signal_owned_process "$previous_pid" "./dash.sh" TERM "$DIR" >/dev/null 2>&1 || true
fi

pkill -f "/mnt/us/extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true
pkill -f "extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true
rm -f "$PID_FILE"

echo "$(date) Starting LLM token dashboard" >>"$LOG_FILE"

if command -v nohup >/dev/null 2>&1; then
  (cd "$DIR" && nohup "$DIR/dash.sh" >>"$LOG_FILE" 2>&1 </dev/null & echo $! >"$PID_FILE")
else
  (cd "$DIR" && "$DIR/dash.sh" >>"$LOG_FILE" 2>&1 </dev/null & echo $! >"$PID_FILE")
fi

echo "Dashboard daemon started."
