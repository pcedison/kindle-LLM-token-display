#!/usr/bin/env sh
DEBUG=${DEBUG:-false}
[ "$DEBUG" = true ] && set -x

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
DASH_PNG="$DIR/dash.png"
FETCH_DASHBOARD_CMD="$DIR/local/fetch-dashboard.sh"
DISPLAY_ONCE_CMD="$DIR/local/display-once.sh"
LOW_BATTERY_CMD="$DIR/local/low-battery.sh"
RTC=${RTC:-/sys/devices/platform/mxc_rtc.0/wakeup_enable}

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

num_refresh=0
ui_stopped=false

init() {
  echo "Starting LLM token dashboard."
  echo "Refresh interval: ${REFRESH_INTERVAL_SECS}s."
  echo "Timezone: ${TIMEZONE:-not-set}."

  sleep "${KUAL_SETTLE_DELAY_SECS:-3}"
  echo powersave >/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || true
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
}

stop_kindle_ui_once() {
  if [ "$ui_stopped" = true ] || [ "$STOP_KINDLE_UI" != true ]; then
    return 0
  fi

  echo "Stopping Kindle UI framework."
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
  initctl stop webreader >/dev/null 2>&1 || true
  /etc/init.d/framework stop >/dev/null 2>&1 || true
  initctl stop framework >/dev/null 2>&1 || true
  stop framework >/dev/null 2>&1 || true
  sleep "${UI_SETTLE_DELAY_SECS:-2}"
  ui_stopped=true
}

show_dashboard_png() {
  mode=${1:-partial}

  if [ "$mode" = full ]; then
    echo "Full screen refresh"
    if [ "$CLEAR_BEFORE_DISPLAY" = true ]; then
      /usr/sbin/eips -c
      sleep 1
    fi
    /usr/sbin/eips -f -g "$DASH_PNG"
    echo "Full screen refresh exit $?"
  else
    echo "Partial screen refresh"
    /usr/sbin/eips -g "$DASH_PNG"
    echo "Partial screen refresh exit $?"
  fi
}

refresh_dashboard() {
  echo "Refreshing dashboard"
  "$DIR/wait-for-wifi.sh" "$WIFI_TEST_IP"

  "$FETCH_DASHBOARD_CMD" "$DASH_PNG"
  fetch_status=$?

  if [ "$fetch_status" -ne 0 ] && [ ! -s "$DASH_PNG" ]; then
    echo "Not updating screen, fetch-dashboard returned $fetch_status and no cached image exists"
    return 1
  fi

  if [ "$fetch_status" -ne 0 ]; then
    echo "Using cached dashboard image after fetch-dashboard returned $fetch_status"
  fi

  stop_kindle_ui_once

  if [ "$num_refresh" -ge "$FULL_DISPLAY_REFRESH_RATE" ] || [ "$num_refresh" -eq 0 ]; then
    num_refresh=0
    show_dashboard_png full
  else
    show_dashboard_png partial
  fi

  num_refresh=$((num_refresh + 1))
}

log_battery_stats() {
  battery_level=$(gasgauge-info -c 2>/dev/null)
  echo "$(date) Battery level: ${battery_level:-unknown}."

  if [ "$LOW_BATTERY_REPORTING" = true ] && [ -n "$battery_level" ]; then
    battery_level_numeric=${battery_level%?}
    if [ "$battery_level_numeric" -le "$LOW_BATTERY_THRESHOLD_PERCENT" ]; then
      "$LOW_BATTERY_CMD" "$battery_level_numeric"
    fi
  fi
}

sleep_until_next_refresh() {
  duration=${1:-$REFRESH_INTERVAL_SECS}

  if [ "$DASHBOARD_USE_RTC" = true ] && [ -e "$RTC" ]; then
    [ "$(cat "$RTC")" -eq 0 ] && echo -n "$duration" >"$RTC"
    echo "mem" >/sys/power/state
  else
    echo "Sleeping in userspace for ${duration}s"
    sleep "$duration"
  fi
}

main_loop() {
  while true; do
    log_battery_stats
    refresh_dashboard
    sleep 5
    sleep_until_next_refresh "$REFRESH_INTERVAL_SECS"
  done
}

init
main_loop
