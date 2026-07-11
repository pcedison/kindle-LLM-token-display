#!/usr/bin/env sh
DEBUG=${DEBUG:-false}
[ "$DEBUG" = true ] && set -x

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
DASH_PNG="$DIR/dash.png"
FETCH_DASHBOARD_CMD="$DIR/local/fetch-dashboard.sh"
DISPLAY_ONCE_CMD="$DIR/local/display-once.sh"
LOW_BATTERY_CMD="$DIR/local/low-battery.sh"
POWER_BUTTON_EXIT_CMD="$DIR/local/power-button-exit.sh"
POWER_BUTTON_EVENT_PID_FILE="/tmp/kindle-dash-power-event-$$.pid"
RTC=${RTC:-/sys/devices/platform/mxc_rtc.0/wakeup_enable}

dash_xtrace_enabled=false
case $- in
  *x*)
    dash_xtrace_enabled=true
    set +x
    ;;
esac

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

if [ "$dash_xtrace_enabled" = true ]; then
  set -x
fi
unset dash_xtrace_enabled

. "$DIR/local/dashboard-utils.sh"
. "$DIR/local/chrome-control.sh"

num_refresh=0
ui_stopped=false
dashboard_cleanup_started=false
power_button_watcher_pid=""

stop_power_button_exit_watcher() {
  signal_owned_process "$power_button_watcher_pid" power-button-exit.sh TERM >/dev/null 2>&1 || true

  if [ -r "$POWER_BUTTON_EVENT_PID_FILE" ]; then
    event_pid=$(cat "$POWER_BUTTON_EVENT_PID_FILE" 2>/dev/null)
    signal_owned_process "$event_pid" lipc-wait-event KILL >/dev/null 2>&1 || true
  fi

  signal_owned_process "$power_button_watcher_pid" power-button-exit.sh KILL >/dev/null 2>&1 || true

  if [ -n "$power_button_watcher_pid" ]; then
    rm -f "/tmp/kindle-dash-power-$power_button_watcher_pid"
  fi
  rm -f "$POWER_BUTTON_EVENT_PID_FILE"
}

dashboard_cleanup() {
  if [ "$dashboard_cleanup_started" = true ]; then
    return 0
  fi

  dashboard_cleanup_started=true
  restore_kindle_chrome
  lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
  stop_power_button_exit_watcher
}

dashboard_shutdown() {
  exit 0
}

trap dashboard_cleanup EXIT
trap dashboard_shutdown HUP INT TERM

start_power_button_exit_watcher() {
  if [ "${POWER_BUTTON_RESTORES_KINDLE:-true}" != true ]; then
    echo "Physical power-button restore disabled."
    return 0
  fi

  if ! command -v lipc-wait-event >/dev/null 2>&1; then
    echo "Physical power-button restore unavailable: lipc-wait-event not found."
    return 0
  fi

  rm -f "$POWER_BUTTON_EVENT_PID_FILE"
  "$POWER_BUTTON_EXIT_CMD" "$DIR/stop.sh" "$POWER_BUTTON_EVENT_PID_FILE" &
  power_button_watcher_pid=$!
  echo "Physical power-button restore watcher started."
}

init() {
  echo "Starting LLM token dashboard."
  echo "Refresh interval: ${REFRESH_INTERVAL_SECS}s."
  echo "Timezone: ${TIMEZONE:-not-set}."

  sleep "${KUAL_SETTLE_DELAY_SECS:-3}"
  hide_kindle_chrome
  start_power_button_exit_watcher
  echo powersave >/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || true
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
}

stop_kindle_ui_once() {
  if [ "$ui_stopped" = true ] || [ "$STOP_KINDLE_UI" != true ]; then
    return 0
  fi

  if [ "$ALLOW_FRAMEWORK_STOP" != true ]; then
    echo "STOP_KINDLE_UI ignored because ALLOW_FRAMEWORK_STOP is not true."
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
    else
      echo "Clear skipped"
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

  if [ "$DASHBOARD_USE_RTC" != true ]; then
    echo "Sleeping in userspace for ${duration}s"
    sleep "$duration"
    return 0
  fi

  rtc_source=$(find_rtc_wake_source 2>/dev/null) || {
    echo "RTC wake path unavailable; falling back to userspace sleep"
    sleep "$duration"
    return 0
  }

  echo "RTC sleep using $rtc_source for ${duration}s"
  lipc-set-prop com.lab126.wifid enable 0 >/dev/null 2>&1 || true
  sync >/dev/null 2>&1 || true

  if suspend_for_seconds "$duration"; then
    echo "Woke from RTC sleep"
    "$DIR/wait-for-wifi.sh" "$WIFI_TEST_IP" || echo "Wi-Fi did not reconnect after RTC wake"
    return 0
  fi

  echo "RTC suspend failed; restoring Wi-Fi and falling back to userspace sleep"
  lipc-set-prop com.lab126.wifid enable 1 >/dev/null 2>&1 || true
  sleep "$duration"
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
