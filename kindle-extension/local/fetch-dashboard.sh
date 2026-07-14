#!/usr/bin/env sh

# The URL may contain a view key. Disable xtrace before reading or using it.
case $- in
  *x*) set +x ;;
esac

umask 077

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
URL=${DASHBOARD_URL:-"https://your-project.vercel.app/api/dashboard?profile=dp75sdi&managed=true"}

# shellcheck disable=SC1091
. "$DIR/dashboard-utils.sh"

if [ -z "$OUT" ]; then
  echo "Usage: $0 OUTPUT_PNG" >&2
  exit 2
fi

MAX_DASHBOARD_BYTES=4194304
# Bash counts 1024-byte blocks and BusyBox ash may count 512-byte blocks. This
# keeps disk use bounded on both; the exact 4 MiB limit is checked after fetch.
DOWNLOAD_FILE_LIMIT_BLOCKS=8193
DOWNLOAD_TIMEOUT_SECS=${DASHBOARD_DOWNLOAD_TIMEOUT_SECS:-20}
EXPECTED_WIDTH=${DASHBOARD_EXPECTED_WIDTH:-}
EXPECTED_HEIGHT=${DASHBOARD_EXPECTED_HEIGHT:-}
OUT_DIR=$(dirname "$OUT")
SESSION_DIR="$OUT_DIR/.kindle-dash-fetch.$$"
TMP="$SESSION_DIR/dashboard.png"
GUARD_FILE="$SESSION_DIR/timeout"
DOWNLOAD_PID=''
WATCHDOG_PID=''

if ! DOWNLOAD_TIMEOUT_SECS=$(normalize_download_timeout "$DOWNLOAD_TIMEOUT_SECS"); then
  DOWNLOAD_TIMEOUT_SECS=20
fi

stop_download() {
  [ -n "$DOWNLOAD_PID" ] || return 0
  kill -KILL "$DOWNLOAD_PID" >/dev/null 2>&1 || true
  wait "$DOWNLOAD_PID" >/dev/null 2>&1 || true
  DOWNLOAD_PID=''
}

stop_watchdog() {
  [ -n "$WATCHDOG_PID" ] || return 0
  kill "$WATCHDOG_PID" >/dev/null 2>&1 || true
  wait "$WATCHDOG_PID" >/dev/null 2>&1 || true
  WATCHDOG_PID=''
}

cleanup() {
  stop_watchdog
  stop_download
  rm -f "$TMP" "$GUARD_FILE"
  rmdir "$SESSION_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

apply_download_file_limit() {
  ulimit -f "$DOWNLOAD_FILE_LIMIT_BLOCKS" >/dev/null 2>&1 && return 0
  # Git Bash cannot change RLIMIT_FSIZE; production Kindle/Linux must fail closed.
  [ "${OS:-}" = Windows_NT ]
}

start_download() {
  if command -v wget >/dev/null 2>&1; then
    (
      apply_download_file_limit || exit 1
      exec wget -q -O "$TMP" "$FETCH_URL"
    ) &
  elif [ -x "$DIR/../xh" ]; then
    (
      apply_download_file_limit || exit 1
      exec "$DIR/../xh" -d -q -o "$TMP" get "$FETCH_URL"
    ) &
  elif [ -x "$DIR/../ht" ]; then
    (
      apply_download_file_limit || exit 1
      exec "$DIR/../ht" -d -q -o "$TMP" get "$FETCH_URL"
    ) &
  else
    return 127
  fi
  DOWNLOAD_PID=$!
}

watch_download() {
  trap - EXIT HUP INT TERM
  watchdog_sleep_pid=''
  watchdog_cancelled=false
  cancel_watchdog() {
    watchdog_cancelled=true
    [ -n "$watchdog_sleep_pid" ] && kill -KILL "$watchdog_sleep_pid" >/dev/null 2>&1 || true
  }
  trap cancel_watchdog HUP INT TERM
  sleep "$DOWNLOAD_TIMEOUT_SECS" &
  watchdog_sleep_pid=$!
  if [ "$watchdog_cancelled" = true ]; then
    kill -KILL "$watchdog_sleep_pid" >/dev/null 2>&1 || true
  fi
  wait "$watchdog_sleep_pid" >/dev/null 2>&1
  watchdog_sleep_status=$?
  watchdog_sleep_pid=''
  trap - HUP INT TERM
  [ "$watchdog_cancelled" = false ] && [ "$watchdog_sleep_status" -eq 0 ] || exit 0
  printf '%s\n' timeout >"$GUARD_FILE"
  kill -KILL "$DOWNLOAD_PID" >/dev/null 2>&1 || true
}

download_with_deadline() {
  start_download || return $?
  watch_download >/dev/null 2>&1 &
  WATCHDOG_PID=$!

  wait "$DOWNLOAD_PID"
  download_status=$?
  DOWNLOAD_PID=''
  stop_watchdog

  [ ! -f "$GUARD_FILE" ] || return 1
  return "$download_status"
}

validate_dashboard_png_envelope() {
  png_file=$1
  file_size=$2

  [ "$file_size" -ge 33 ] || return 1
  header=$(od -An -tu1 -N 33 "$png_file" 2>/dev/null) || return 1
  set -- $header
  [ "$#" -eq 33 ] || return 1
  [ "$1:$2:$3:$4:$5:$6:$7:$8" = '137:80:78:71:13:10:26:10' ] || return 1
  [ "$9:${10}:${11}:${12}" = '0:0:0:13' ] || return 1
  [ "${13}:${14}:${15}:${16}" = '73:72:68:82' ] || return 1
  [ "${17}" -eq 0 ] && [ "${18}" -eq 0 ] || return 1
  [ "${21}" -eq 0 ] && [ "${22}" -eq 0 ] || return 1
  actual_width=$((${19} * 256 + ${20}))
  actual_height=$((${23} * 256 + ${24}))
  [ "$actual_width" -ge 1 ] && [ "$actual_height" -ge 1 ] || return 1
  [ "${25}:${26}:${27}:${28}:${29}" = '8:0:0:0:0' ] || return 1

  if [ -n "$EXPECTED_WIDTH" ] || [ -n "$EXPECTED_HEIGHT" ]; then
    case "$EXPECTED_WIDTH:$EXPECTED_HEIGHT" in
      *[!0-9:]*|:*|*:) return 1 ;;
    esac
    [ "$EXPECTED_WIDTH" -ge 1 ] && [ "$EXPECTED_WIDTH" -le 4096 ] || return 1
    [ "$EXPECTED_HEIGHT" -ge 1 ] && [ "$EXPECTED_HEIGHT" -le 4096 ] || return 1
    [ "$actual_width:$actual_height" = "$EXPECTED_WIDTH:$EXPECTED_HEIGHT" ] || return 1
  else
    case "$actual_width:$actual_height" in
      600:800|758:1024|1072:1448|1080:1440) ;;
      *) return 1 ;;
    esac
  fi
  return 0
}

mkdir "$SESSION_DIR" || exit 1

if battery=$("$DIR/get-battery-level.sh" 2>/dev/null) && battery=$(normalize_battery_level "$battery"); then
  FETCH_URL=$(append_query_param "$URL" battery "$battery")
  echo "fetch-dashboard: battery=$battery"
else
  FETCH_URL=$URL
  echo "fetch-dashboard: battery=unknown"
fi

echo "fetch-dashboard: fetching dashboard PNG"
if ! download_with_deadline; then
  echo "fetch-dashboard: download failed" >&2
  exit 1
fi

response_size=$(wc -c <"$TMP" 2>/dev/null) || response_size=0
if [ "$response_size" -gt "$MAX_DASHBOARD_BYTES" ]; then
  echo "fetch-dashboard: response too large" >&2
  exit 1
fi

if ! validate_dashboard_png_envelope "$TMP" "$response_size"; then
  echo "fetch-dashboard: invalid dashboard PNG envelope" >&2
  exit 1
fi

if ! mv -f "$TMP" "$OUT"; then
  echo "fetch-dashboard: replacement failed" >&2
  exit 1
fi
TMP=''
echo "fetch-dashboard: saved dashboard PNG"
