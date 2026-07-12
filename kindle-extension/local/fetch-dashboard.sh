#!/usr/bin/env sh

# DASHBOARD_URL may contain a query credential, so this helper never uses xtrace.
case $- in
  *x*) set +x ;;
esac

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$1"
URL=${DASHBOARD_URL:-"https://your-project.vercel.app/api/dashboard?profile=dp75sdi&managed=true"}

# shellcheck disable=SC1091
. "$DIR/dashboard-utils.sh"

if [ -z "$OUT" ]; then
  echo "fetch-dashboard: missing output path"
  exit 2
fi

TMP="${OUT}.tmp"
rm -f "$TMP"

if battery=$("$DIR/get-battery-level.sh" 2>/dev/null) && battery=$(normalize_battery_level "$battery"); then
  FETCH_URL=$(append_query_param "$URL" battery "$battery")
  echo "fetch-dashboard: battery=$battery"
else
  FETCH_URL="$URL"
  echo "fetch-dashboard: battery=unknown"
fi

echo "fetch-dashboard: fetching dashboard PNG"

if command -v wget >/dev/null 2>&1; then
  wget -q -O "$TMP" "$FETCH_URL"
elif [ -x "$(dirname "$0")/../xh" ]; then
  "$(dirname "$0")/../xh" -d -q -o "$TMP" get "$FETCH_URL"
elif [ -x "$(dirname "$0")/../ht" ]; then
  "$(dirname "$0")/../ht" -d -q -o "$TMP" get "$FETCH_URL"
else
  echo "fetch-dashboard: no HTTP client found"
  exit 127
fi

status=$?
if [ "$status" -ne 0 ]; then
  echo "fetch-dashboard: download failed with status $status"
  rm -f "$TMP"
  exit "$status"
fi

if [ ! -s "$TMP" ]; then
  echo "fetch-dashboard: downloaded file is empty"
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$OUT"
echo "fetch-dashboard: saved $OUT"
