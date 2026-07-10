#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$DIR/logs"
LOG_FILE="$LOG_DIR/low-power-test.log"

mkdir -p "$LOG_DIR"
. "$DIR/local/dashboard-utils.sh"

log() {
  echo "$(date) $*" >>"$LOG_FILE"
}

trim_log() {
  tail -n 300 "$LOG_FILE" >"$LOG_FILE.tmp" 2>/dev/null && mv "$LOG_FILE.tmp" "$LOG_FILE"
}

log "PROBE_START"

pkill -f "/mnt/us/extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true
pkill -f "extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true

"$DIR/diagnose.sh" >/dev/null 2>&1 || true

rtc_path=$(find_duration_rtc_path 2>/dev/null) || {
  log "UNSUPPORTED:no-duration-rtc-path"
  trim_log
  exit 1
}

log "RTC_PATH_FOUND"
sync >/dev/null 2>&1 || true

if ! suspend_for_seconds 60; then
  log "UNSUPPORTED:suspend-failed"
  trim_log
  exit 1
fi

log "WAKE_SUCCESS"
trim_log
echo "Low-power probe complete; inspect logs/low-power-test.log."
