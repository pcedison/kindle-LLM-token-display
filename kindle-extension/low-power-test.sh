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

rtc_source=$(find_rtc_wake_source 2>/dev/null) || {
  log "UNSUPPORTED:no-rtc-wake-source"
  trim_log
  exit 1
}

log "RTC_SOURCE_FOUND:$rtc_source"
sync >/dev/null 2>&1 || true

if ! suspend_for_seconds 60; then
  log "UNSUPPORTED:suspend-failed"
  trim_log
  exit 1
fi

log "WAKE_SUCCESS"
trim_log
echo "Low-power probe complete; inspect logs/low-power-test.log."
