#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
LOG_FILE="$DIR/logs/dash.log"
PID_FILE="$DIR/logs/dash.pid"

mkdir -p "$DIR/logs"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
. "$DIR/local/dashboard-utils.sh"

dashboard_pid=""
pid_tmp="$PID_FILE.tmp.$$"
start_succeeded=false

cleanup_failed_start() {
  rm -f "$pid_tmp"
  if [ "$start_succeeded" != true ] && [ -n "$dashboard_pid" ]; then
    terminate_owned_process "$dashboard_pid" "extensions/kindle-dash/dash.sh" "$DIR" >/dev/null 2>&1 ||
      terminate_owned_process "$dashboard_pid" "./dash.sh" "$DIR" >/dev/null 2>&1 || true
    terminate_all_dashboard_processes "$DIR" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
  fi
}

trap cleanup_failed_start EXIT
trap 'exit 1' HUP INT TERM

if ! terminate_all_dashboard_processes "$DIR"; then
  echo "Existing dashboard daemon could not be stopped."
  exit 1
fi
rm -f "$PID_FILE" "$pid_tmp"

echo "$(date) Starting LLM token dashboard" >>"$LOG_FILE"

cd "$DIR" || exit 1
if command -v nohup >/dev/null 2>&1; then
  nohup "$DIR/dash.sh" >>"$LOG_FILE" 2>&1 </dev/null &
else
  "$DIR/dash.sh" >>"$LOG_FILE" 2>&1 </dev/null &
fi
dashboard_pid=$!
printf '%s\n' "$dashboard_pid" >"$pid_tmp" || exit 1
mv -f "$pid_tmp" "$PID_FILE" || exit 1

sleep 1
if ! owned_process_matches "$dashboard_pid" "extensions/kindle-dash/dash.sh" "$DIR" &&
   ! owned_process_matches "$dashboard_pid" "./dash.sh" "$DIR"; then
  rm -f "$PID_FILE"
  echo "Dashboard daemon failed to remain running."
  exit 1
fi

start_succeeded=true
echo "Dashboard daemon started."
