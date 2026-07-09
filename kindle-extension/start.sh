#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
LOG_FILE="$DIR/logs/dash.log"
PID_FILE="$DIR/logs/dash.pid"

mkdir -p "$DIR/logs"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

pkill -f "/mnt/us/extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true
pkill -f "extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true

echo "$(date) Starting LLM token dashboard" >>"$LOG_FILE"

if command -v nohup >/dev/null 2>&1; then
  (cd "$DIR" && nohup ./dash.sh >>"$LOG_FILE" 2>&1 </dev/null & echo $! >"$PID_FILE")
else
  (cd "$DIR" && ./dash.sh >>"$LOG_FILE" 2>&1 </dev/null & echo $! >"$PID_FILE")
fi

echo "Dashboard daemon started."
