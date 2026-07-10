#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
LOG_DIR="$DIR/logs"
LOG_FILE="$LOG_DIR/power-diagnostics.log"

[ -f "$ENV_FILE" ] && . "$ENV_FILE"
. "$DIR/local/dashboard-utils.sh"

mkdir -p "$LOG_DIR"

{
  echo "$(date) Kindle dashboard diagnostics"
  battery=$($DIR/local/get-battery-level.sh 2>/dev/null || true)
  echo "battery=${battery:-unknown}"

  if command -v powerd_test >/dev/null 2>&1; then
    powerd_test -s 2>/dev/null | sed -n '1,12p'
  else
    echo "powerd_test=unavailable"
  fi

  if command -v lipc-get-prop >/dev/null 2>&1; then
    echo "wifi_state=$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null || echo unknown)"
  else
    echo "wifi_state=unavailable"
  fi

  for thermal_file in /sys/class/thermal/thermal_zone*/temp; do
    [ -r "$thermal_file" ] || continue
    echo "thermal=${thermal_file}:$(cat "$thermal_file" 2>/dev/null)"
  done

  echo "rtc_override=${RTC_WAKE_PATH:-unset}"
  for candidate in /sys/devices/platform/mxc_rtc.0/wakeup_enable /sys/devices/platform/*rtc*/wakeup_enable; do
    [ -e "$candidate" ] || continue
    echo "rtc_candidate=$candidate writable=$( [ -w "$candidate" ] && echo yes || echo no )"
  done

  echo "power_state=$( [ -e "${POWER_STATE_PATH:-/sys/power/state}" ] && echo present || echo missing )"
  if command -v ps >/dev/null 2>&1; then
    ps | grep '[d]ash.sh' >/dev/null 2>&1 && echo "dashboard_process=running" || echo "dashboard_process=stopped"
  fi
} >>"$LOG_FILE"

tail -n 300 "$LOG_FILE" >"$LOG_FILE.tmp" 2>/dev/null && mv "$LOG_FILE.tmp" "$LOG_FILE"
echo "Diagnostics written to $LOG_FILE"
