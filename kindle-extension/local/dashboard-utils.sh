#!/usr/bin/env sh

normalize_battery_level() {
  value=$(printf '%s' "$1" | tr -d '[:space:]%')
  case "$value" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$value" -ge 0 ] 2>/dev/null || return 1
  [ "$value" -le 100 ] 2>/dev/null || return 1
  printf '%s\n' "$value"
}

append_query_param() {
  case "$1" in
    *\?*) separator='&' ;;
    *) separator='?' ;;
  esac
  printf '%s%s%s=%s\n' "$1" "$separator" "$2" "$3"
}
