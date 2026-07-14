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

normalize_refresh_interval() {
  case "$1" in
    10|20|30|40|50|60|120|180|240|300|360|420|480|540|600|660|720|780|840|900)
      printf '%s\n' "$1"
      ;;
    *) return 1 ;;
  esac
}

normalize_download_timeout() {
  case "$1" in
    [1-9]|[1-5][0-9]|60) printf '%s\n' "$1" ;;
    *) return 1 ;;
  esac
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

valid_rtc_epoch() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac

  [ "$1" -ge 1577836800 ] 2>/dev/null
}

rtc_since_epoch_path() {
  if [ -n "${RTC_SINCE_EPOCH_PATH:-}" ]; then
    printf '%s\n' "$RTC_SINCE_EPOCH_PATH"
    return 0
  fi

  printf '%s/since_epoch\n' "${1%/wakealarm}"
}

find_epoch_rtc_path() {
  if [ -n "${RTC_WAKEALARM_PATH:-}" ] && [ -e "$RTC_WAKEALARM_PATH" ]; then
    since_epoch_path=$(rtc_since_epoch_path "$RTC_WAKEALARM_PATH") || return 1
    [ -r "$since_epoch_path" ] || return 1
    rtc_epoch=$(cat "$since_epoch_path" 2>/dev/null) || return 1
    valid_rtc_epoch "$rtc_epoch" || return 1
    printf '%s\n' "$RTC_WAKEALARM_PATH"
    return 0
  fi

  for candidate in /sys/class/rtc/rtc0/wakealarm /sys/class/rtc/rtc1/wakealarm /sys/class/rtc/rtc*/wakealarm; do
    [ -w "$candidate" ] || continue
    since_epoch_path=$(rtc_since_epoch_path "$candidate") || continue
    [ -r "$since_epoch_path" ] || continue
    rtc_epoch=$(cat "$since_epoch_path" 2>/dev/null) || continue
    valid_rtc_epoch "$rtc_epoch" || continue
    printf '%s\n' "$candidate"
    return 0
  done

  return 1
}

find_rtc_wake_source() {
  if rtc_path=$(find_duration_rtc_path 2>/dev/null); then
    printf 'duration:%s\n' "$rtc_path"
    return 0
  fi

  if rtc_path=$(find_epoch_rtc_path 2>/dev/null); then
    printf 'epoch:%s\n' "$rtc_path"
    return 0
  fi

  return 1
}

suspend_for_seconds() {
  duration=$1
  power_state=${POWER_STATE_PATH:-/sys/power/state}

  case "$duration" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$duration" -gt 0 ] 2>/dev/null || return 1

  if rtc_path=$(find_duration_rtc_path 2>/dev/null); then
    printf '%s' "$duration" >"$rtc_path" || return 1
  elif rtc_path=$(find_epoch_rtc_path 2>/dev/null); then
    since_epoch_path=$(rtc_since_epoch_path "$rtc_path") || return 1
    rtc_epoch=$(cat "$since_epoch_path" 2>/dev/null) || return 1
    valid_rtc_epoch "$rtc_epoch" || return 1
    wake_epoch=$((rtc_epoch + duration))
    printf '0' >"$rtc_path" || return 1
    printf '%s' "$wake_epoch" >"$rtc_path" || return 1
  else
    return 1
  fi

  printf 'mem\n' >"$power_state" || return 1
}

process_cmdline_contains() {
  owned_process_pid=${1:-}
  owned_process_name=${2:-}
  owned_proc_root=${PROCESS_PROC_ROOT:-/proc}

  case "$owned_process_pid" in
    ''|*[!0-9]*) return 1 ;;
  esac

  [ -n "$owned_process_name" ] || return 1
  [ -r "$owned_proc_root/$owned_process_pid/cmdline" ] || return 1
  tr '\000' ' ' <"$owned_proc_root/$owned_process_pid/cmdline" 2>/dev/null |
    grep -F -q "$owned_process_name"
}

process_cwd_matches() {
  owned_process_pid=${1:-}
  owned_expected_cwd=${2:-}
  owned_proc_root=${PROCESS_PROC_ROOT:-/proc}

  [ -n "$owned_expected_cwd" ] || return 0
  owned_actual_cwd=$(readlink "$owned_proc_root/$owned_process_pid/cwd" 2>/dev/null) || return 1
  [ "$owned_actual_cwd" = "$owned_expected_cwd" ]
}

signal_owned_process() {
  owned_process_pid=${1:-}
  owned_process_name=${2:-}
  owned_signal=${3:-TERM}
  owned_expected_cwd=${4:-}
  owned_signal_cmd=${PROCESS_SIGNAL_CMD:-kill}

  case "$owned_signal" in
    TERM|KILL|INT|HUP|CONT|STOP) ;;
    *) return 1 ;;
  esac

  process_cmdline_contains "$owned_process_pid" "$owned_process_name" || return 1
  process_cwd_matches "$owned_process_pid" "$owned_expected_cwd" || return 1
  "$owned_signal_cmd" "-$owned_signal" "$owned_process_pid"
}
