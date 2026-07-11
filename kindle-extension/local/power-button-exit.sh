#!/usr/bin/env sh

STOP_CMD=${1:-}
EVENT_PID_FILE=${2:-}
EVENT_FIFO=${DASHBOARD_EVENT_FIFO:-"/tmp/kindle-dash-power-$$"}
EVENT_PID=""

if [ -z "$STOP_CMD" ] || [ -z "$EVENT_PID_FILE" ]; then
    echo "power-button-exit: stop command and event PID file are required" >&2
    exit 64
fi

if [ ! -f "$STOP_CMD" ]; then
  echo "power-button-exit: stop command not found" >&2
  exit 66
fi

cleanup_power_button_exit() {
  if [ -n "$EVENT_PID" ]; then
    kill -KILL "$EVENT_PID" >/dev/null 2>&1 || true
    wait "$EVENT_PID" 2>/dev/null || true
  fi
  rm -f "$EVENT_FIFO" "$EVENT_PID_FILE"
}

shutdown_power_button_exit() {
  exit 0
}

trap cleanup_power_button_exit EXIT
trap shutdown_power_button_exit HUP INT TERM

rm -f "$EVENT_FIFO"
mkfifo "$EVENT_FIFO" || exit 1

lipc-wait-event -m -s 0 com.lab126.powerd \
  goingToScreenSaver,outOfScreenSaver >"$EVENT_FIFO" 2>/dev/null &
EVENT_PID=$!
printf '%s\n' "$EVENT_PID" >"$EVENT_PID_FILE"

while IFS=' ' read -r event_name event_source _event_rest; do
  case "$event_name:$event_source" in
    goingToScreenSaver:2|outOfScreenSaver:1)
      echo "power-button-exit: restoring Kindle UI after physical power button"
      sh "$STOP_CMD" >/dev/null 2>&1 || true
      break
      ;;
  esac
done <"$EVENT_FIFO"
