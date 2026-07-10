#!/usr/bin/env sh

normalize_battery_level() {
  value=$(printf '%s\n' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  case "$value" in
    *%) value=${value%?} ;;
  esac
  case "$value" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$value" -ge 0 ] 2>/dev/null || return 1
  [ "$value" -le 100 ] 2>/dev/null || return 1
  printf '%s\n' "$value"
}

append_query_param() {
  case "$1" in
    *\#*)
      url=${1%%\#*}
      fragment=#${1#*\#}
      ;;
    *)
      url=$1
      fragment=''
      ;;
  esac
  case "$url" in
    *\?*) separator='&' ;;
    *) separator='?' ;;
  esac
  printf '%s%s%s=%s%s\n' "$url" "$separator" "$2" "$3" "$fragment"
}

find_duration_rtc_path() {
  if [ -n "${RTC_WAKE_PATH:-}" ] && [ -e "$RTC_WAKE_PATH" ]; then
    printf '%s\n' "$RTC_WAKE_PATH"
    return 0
  fi

  for candidate in /sys/devices/platform/mxc_rtc.0/wakeup_enable /sys/devices/platform/*rtc*/wakeup_enable; do
    [ -w "$candidate" ] || continue
    printf '%s\n' "$candidate"
    return 0
  done

  return 1
}

suspend_for_seconds() {
  duration=$1
  rtc_path=$(find_duration_rtc_path) || return 1
  power_state=${POWER_STATE_PATH:-/sys/power/state}

  printf '%s' "$duration" >"$rtc_path" || return 1
  printf 'mem\n' >"$power_state" || return 1
}
