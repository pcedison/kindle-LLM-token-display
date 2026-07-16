#!/usr/bin/env sh
DEBUG=${DEBUG:-false}
[ "$DEBUG" = true ] && set -x

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
DASH_PNG="$DIR/dash.png"
DASH_CANDIDATE="${DASH_PNG}.candidate.$$"
FETCH_DASHBOARD_CMD="$DIR/local/fetch-dashboard.sh"
FETCH_REMOTE_CONFIG_CMD="$DIR/local/fetch-remote-config.sh"
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

if ! refresh_interval_secs=$(normalize_refresh_interval "${REFRESH_INTERVAL_SECS:-720}"); then
  echo "Invalid local refresh interval; using 720s."
  refresh_interval_secs=720
fi

num_refresh=0
ui_stopped=false
dashboard_cleanup_started=false
power_button_watcher_pid=""

stop_power_button_exit_watcher() {
  watcher_pid_to_cleanup=$power_button_watcher_pid
  if owned_process_matches "$watcher_pid_to_cleanup" power-button-exit.sh "$DIR"; then
    signal_owned_process "$watcher_pid_to_cleanup" power-button-exit.sh TERM "$DIR" >/dev/null 2>&1 || true
    if ! wait_for_owned_process_exit "$watcher_pid_to_cleanup" power-button-exit.sh "$DIR" 3; then
      if [ -r "$POWER_BUTTON_EVENT_PID_FILE" ]; then
        while IFS=' ' read -r event_pid event_process; do
          [ -n "$event_pid" ] || continue
          case "$event_process" in
            lipc-wait-event|tail|power-button-exit.sh)
              signal_owned_child_process "$event_pid" "$watcher_pid_to_cleanup" "$event_process" TERM "$DIR" >/dev/null 2>&1 || true
              ;;
          esac
        done <"$POWER_BUTTON_EVENT_PID_FILE"
        sleep 1
        while IFS=' ' read -r event_pid event_process; do
          [ -n "$event_pid" ] || continue
          case "$event_process" in
            lipc-wait-event|tail|power-button-exit.sh)
              signal_owned_child_process "$event_pid" "$watcher_pid_to_cleanup" "$event_process" KILL "$DIR" >/dev/null 2>&1 || true
              ;;
          esac
        done <"$POWER_BUTTON_EVENT_PID_FILE"
      fi
      signal_owned_process "$watcher_pid_to_cleanup" power-button-exit.sh KILL "$DIR" >/dev/null 2>&1 || true
      wait_for_owned_process_exit "$watcher_pid_to_cleanup" power-button-exit.sh "$DIR" 2 >/dev/null 2>&1 || true
    fi
  fi

  rm -f "$POWER_BUTTON_EVENT_PID_FILE"
  if [ -n "$watcher_pid_to_cleanup" ]; then
    rm -f "/tmp/kindle-dash-power-$watcher_pid_to_cleanup"
  fi
  power_button_watcher_pid=""
}

dashboard_cleanup() {
  if [ "$dashboard_cleanup_started" = true ]; then
    return 0
  fi

  dashboard_cleanup_started=true
  rm -f "$DASH_CANDIDATE"
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

  power_button_log=${POWER_BUTTON_LOG_PATH:-/var/log/messages}
  if { [ ! -r "$power_button_log" ] || ! command -v tail >/dev/null 2>&1; } &&
     ! command -v lipc-wait-event >/dev/null 2>&1; then
    echo "Physical power-button restore unavailable: no event source found."
    return 0
  fi

  rm -f "$POWER_BUTTON_EVENT_PID_FILE"
  "$POWER_BUTTON_EXIT_CMD" "$DIR/stop.sh" "$POWER_BUTTON_EVENT_PID_FILE" &
  power_button_watcher_pid=$!
  watcher_ready_wait=0
  while [ ! -s "$POWER_BUTTON_EVENT_PID_FILE" ] && [ "$watcher_ready_wait" -lt 3 ]; do
    sleep 1
    watcher_ready_wait=$((watcher_ready_wait + 1))
  done

  if [ -s "$POWER_BUTTON_EVENT_PID_FILE" ] &&
     owned_process_matches "$power_button_watcher_pid" power-button-exit.sh "$DIR"; then
    echo "Physical power-button restore watcher ready."
    return 0
  fi

  echo "Physical power-button restore watcher failed to become ready."
  stop_power_button_exit_watcher
  power_button_watcher_pid=""
}

init() {
  echo "Starting LLM token dashboard."
  echo "Refresh interval: ${refresh_interval_secs}s."
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
  image_path=${2:-$DASH_PNG}
  hide_kindle_chrome

  if [ "$mode" = full ]; then
    echo "Full screen refresh"
    if [ "$CLEAR_BEFORE_DISPLAY" = true ]; then
      /usr/sbin/eips -c
      sleep 1
    else
      echo "Clear skipped"
    fi
    /usr/sbin/eips -f -g "$image_path"
    display_status=$?
    echo "Full screen refresh exit $display_status"
  else
    echo "Partial screen refresh"
    /usr/sbin/eips -g "$image_path"
    display_status=$?
    echo "Partial screen refresh exit $display_status"
  fi
  return "$display_status"
}

refresh_dashboard() {
  echo "Refreshing dashboard"
  "$DIR/wait-for-wifi.sh" "$WIFI_TEST_IP"

  rm -f "$DASH_CANDIDATE"
  "$FETCH_DASHBOARD_CMD" "$DASH_CANDIDATE"
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
    display_mode=full
  else
    display_mode=partial
  fi

  if [ "$fetch_status" -eq 0 ]; then
    if show_dashboard_png "$display_mode" "$DASH_CANDIDATE"; then
      if ! mv -f "$DASH_CANDIDATE" "$DASH_PNG"; then
        echo "Candidate display succeeded but cache promotion failed"
        rm -f "$DASH_CANDIDATE"
        return 1
      fi
    else
      echo "Candidate image was rejected by eips; preserving cached dashboard"
      rm -f "$DASH_CANDIDATE"
      [ -s "$DASH_PNG" ] || return 1
      show_dashboard_png "$display_mode" "$DASH_PNG" || return 1
    fi
  else
    rm -f "$DASH_CANDIDATE"
    show_dashboard_png "$display_mode" "$DASH_PNG" || return 1
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

refresh_remote_config() {
  if [ ! -x "$FETCH_REMOTE_CONFIG_CMD" ]; then
    echo "Remote config helper unavailable; keeping ${refresh_interval_secs}s."
    return 1
  fi

  if remote_interval=$("$FETCH_REMOTE_CONFIG_CMD"); then
    refresh_interval_secs=$remote_interval
    echo "Remote refresh interval: ${refresh_interval_secs}s."
    return 0
  fi

  echo "Remote config unavailable; keeping ${refresh_interval_secs}s."
  return 1
}

sleep_until_next_refresh() {
  duration=${1:-$refresh_interval_secs}

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
    refresh_remote_config || true
    log_battery_stats
    refresh_dashboard
    sleep_until_next_refresh "$refresh_interval_secs"
  done
}

init
main_loop
