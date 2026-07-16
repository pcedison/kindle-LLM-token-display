#!/usr/bin/env sh

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STOP_CMD=${1:-}
EVENT_PID_FILE=${2:-}
EVENT_FIFO=${DASHBOARD_EVENT_FIFO:-"/tmp/kindle-dash-power-$$"}
POWER_BUTTON_LOG_PATH=${POWER_BUTTON_LOG_PATH:-/var/log/messages}
EVENT_PID_TMP="$EVENT_PID_FILE.tmp.$$"
WATCHER_PID=$$
cleanup_started=false

# shellcheck disable=SC1090
. "$BASE_DIR/local/dashboard-utils.sh"

if [ -z "$STOP_CMD" ] || [ -z "$EVENT_PID_FILE" ]; then
    echo "power-button-exit: stop command and event PID file are required" >&2
    exit 64
fi

if [ ! -f "$STOP_CMD" ]; then
  echo "power-button-exit: stop command not found" >&2
  exit 66
fi

cd "$BASE_DIR" || exit 1

cleanup_power_button_exit() {
  if [ "$cleanup_started" = true ]; then
    return 0
  fi
  cleanup_started=true

  for event_record_file in "$EVENT_PID_FILE" "$EVENT_PID_TMP"; do
    [ -r "$event_record_file" ] || continue
    while IFS=' ' read -r event_pid event_process; do
      [ -n "$event_pid" ] || continue
      signal_owned_child_process "$event_pid" "$WATCHER_PID" "$event_process" TERM "$BASE_DIR" >/dev/null 2>&1 || true
    done <"$event_record_file"
  done
  sleep 1
  for event_record_file in "$EVENT_PID_FILE" "$EVENT_PID_TMP"; do
    [ -r "$event_record_file" ] || continue
    while IFS=' ' read -r event_pid event_process; do
      [ -n "$event_pid" ] || continue
      signal_owned_child_process "$event_pid" "$WATCHER_PID" "$event_process" KILL "$BASE_DIR" >/dev/null 2>&1 || true
      wait "$event_pid" 2>/dev/null || true
    done <"$event_record_file"
  done
  rm -f "$EVENT_FIFO" "$EVENT_PID_FILE" "$EVENT_PID_TMP"
}

shutdown_power_button_exit() {
  exit 0
}

trap cleanup_power_button_exit EXIT
trap shutdown_power_button_exit HUP INT TERM

latest_power_button_log_line() {
  tail -n 200 "$POWER_BUTTON_LOG_PATH" 2>/dev/null |
    grep 'def:pbpress:.*Power button pressed' |
    sed -n '$p'
}

poll_power_button_log() {
  previous_power_button_line=$(latest_power_button_log_line)
  while :; do
    sleep 2
    current_power_button_line=$(latest_power_button_log_line)
    if [ -n "$current_power_button_line" ] &&
       [ "$current_power_button_line" != "$previous_power_button_line" ]; then
      echo "hardwarePowerButtonPressed"
      return 0
    fi
    previous_power_button_line=$current_power_button_line
  done
}

record_event_child() {
  printf '%s %s\n' "$1" "$2" >>"$EVENT_PID_TMP"
}

start_delayed_stop() {
  if command -v nohup >/dev/null 2>&1; then
    nohup sh -c 'sleep 1; exec sh "$1"' sh "$STOP_CMD" </dev/null &
  else
    (trap '' HUP; sleep 1; exec sh "$STOP_CMD") </dev/null &
  fi
}

rm -f "$EVENT_FIFO"
mkfifo "$EVENT_FIFO" || exit 1
: >"$EVENT_PID_TMP" || exit 1

if [ -r "$POWER_BUTTON_LOG_PATH" ] && command -v tail >/dev/null 2>&1; then
  # Paperwhite 2 logs the hardware press before preventScreenSaver rejects the
  # transition, so this remains observable when the normal LIPC event is muted.
  if tail --help 2>&1 | grep -q '[-]F'; then
    tail -n 0 -F "$POWER_BUTTON_LOG_PATH" >"$EVENT_FIFO" 2>/dev/null &
    log_event_pid=$!
    record_event_child "$log_event_pid" tail
    echo "power-button-exit: rotation-aware tail enabled"
  else
    poll_power_button_log >"$EVENT_FIFO" 2>/dev/null &
    log_event_pid=$!
    record_event_child "$log_event_pid" power-button-exit.sh
    echo "power-button-exit: tail -F unavailable; rotation-aware polling enabled"
  fi
fi

if command -v lipc-wait-event >/dev/null 2>&1; then
  lipc-wait-event -m -s 0 com.lab126.powerd \
    goingToScreenSaver,outOfScreenSaver >"$EVENT_FIFO" 2>/dev/null &
  powerd_event_pid=$!
  record_event_child "$powerd_event_pid" lipc-wait-event
fi

[ -s "$EVENT_PID_TMP" ] || exit 69
mv -f "$EVENT_PID_TMP" "$EVENT_PID_FILE" || exit 1
echo "power-button-exit: hardware-log and screen-saver watchers ready"

while IFS= read -r event_line; do
  case "$event_line" in
    *def:pbpress:*"Power button pressed"*|hardwarePowerButtonPressed|goingToScreenSaver\ 2*|outOfScreenSaver\ 1*)
      echo "power-button-exit: restoring Kindle UI after physical power button"
      cleanup_power_button_exit
      start_delayed_stop
      exit 0
      ;;
  esac
done <"$EVENT_FIFO"
