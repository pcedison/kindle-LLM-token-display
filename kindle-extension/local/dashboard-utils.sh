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
