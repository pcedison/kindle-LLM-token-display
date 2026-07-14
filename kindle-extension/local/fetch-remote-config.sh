#!/usr/bin/env sh

# The URL may contain a view key. Disable xtrace before reading or using it.
case $- in
  *x*) set +x ;;
esac

umask 077

DIR="$(cd "$(dirname "$0")" && pwd)"
URL=${REMOTE_CONFIG_URL:-}

# shellcheck disable=SC1091
. "$DIR/dashboard-utils.sh"

TMP="/tmp/kindle-dash-device-config.$$"
FIFO="${TMP}.pipe"
GUARD_FILE="${TMP}.guard"
DOWNLOAD_PID=''
READER_PID=''
WATCHDOG_PID=''
MAX_RESPONSE_BYTES=4096
MAX_RESPONSE_BYTES_PLUS_ONE=4097
DOWNLOAD_TIMEOUT_SECS=${REMOTE_CONFIG_TIMEOUT_SECS:-20}

if ! DOWNLOAD_TIMEOUT_SECS=$(normalize_download_timeout "$DOWNLOAD_TIMEOUT_SECS"); then
  DOWNLOAD_TIMEOUT_SECS=20
fi

stop_download() {
  [ -n "$DOWNLOAD_PID" ] || return 0
  kill -KILL "$DOWNLOAD_PID" >/dev/null 2>&1 || true
  wait "$DOWNLOAD_PID" >/dev/null 2>&1 || true
  DOWNLOAD_PID=''
}

stop_reader() {
  [ -n "$READER_PID" ] || return 0
  kill -KILL "$READER_PID" >/dev/null 2>&1 || true
  wait "$READER_PID" >/dev/null 2>&1 || true
  READER_PID=''
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
  stop_reader
  rm -f "$TMP" "$FIFO" "$GUARD_FILE"
}
trap cleanup EXIT HUP INT TERM

start_bounded_reader() {
  if ! command -v mkfifo >/dev/null 2>&1 || ! command -v head >/dev/null 2>&1; then
    echo "fetch-remote-config: bounded reader unavailable" >&2
    return 127
  fi

  rm -f "$FIFO"
  mkfifo "$FIFO" || return 1
  head -c "$MAX_RESPONSE_BYTES_PLUS_ONE" <"$FIFO" >"$TMP" &
  READER_PID=$!
}

start_download() {
  if command -v wget >/dev/null 2>&1; then
    wget -q -O "$FIFO" "$URL" &
  elif [ -x "$DIR/../xh" ]; then
    "$DIR/../xh" -d -q -o "$FIFO" get "$URL" &
  elif [ -x "$DIR/../ht" ]; then
    "$DIR/../ht" -d -q -o "$FIFO" get "$URL" &
  else
    echo "fetch-remote-config: HTTP client unavailable" >&2
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
  kill -KILL "$READER_PID" >/dev/null 2>&1 || true
}

download_with_limits() {
  start_bounded_reader || return $?
  if ! start_download; then
    stop_reader
    return 1
  fi
  watch_download >/dev/null 2>&1 &
  WATCHDOG_PID=$!

  wait "$DOWNLOAD_PID"
  status=$?
  DOWNLOAD_PID=''
  if [ "$status" -ne 0 ]; then
    stop_reader
    reader_status=1
  else
    wait "$READER_PID"
    reader_status=$?
    READER_PID=''
  fi
  stop_watchdog
  if [ -f "$GUARD_FILE" ]; then
    return 1
  fi
  if [ "$reader_status" -ne 0 ]; then
    return 1
  fi
  return "$status"
}

if [ -z "$URL" ]; then
  echo "fetch-remote-config: URL unavailable" >&2
  exit 1
fi

rm -f "$TMP" "$FIFO" "$GUARD_FILE"
if ! download_with_limits || [ ! -s "$TMP" ]; then
  echo "fetch-remote-config: download failed" >&2
  exit 1
fi

response_size=$(wc -c <"$TMP" 2>/dev/null) || response_size=0
if [ "$response_size" -gt "$MAX_RESPONSE_BYTES" ]; then
  echo "fetch-remote-config: invalid response" >&2
  exit 1
fi

count=$(grep -c '^refresh_interval_seconds=[0-9][0-9]*$' "$TMP" 2>/dev/null)
if [ "$count" -ne 1 ]; then
  echo "fetch-remote-config: invalid response" >&2
  exit 1
fi

value=$(sed -n 's/^refresh_interval_seconds=\([0-9][0-9]*\)$/\1/p' "$TMP")
case "$value" in
  10|20|30|40|50|60|120|180|240|300|360|420|480|540|600|660|720|780|840|900)
    printf '%s\n' "$value"
    ;;
  *)
    echo "fetch-remote-config: unsupported interval" >&2
    exit 1
    ;;
esac
