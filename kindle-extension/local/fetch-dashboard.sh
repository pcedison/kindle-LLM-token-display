#!/usr/bin/env sh

OUT="$1"
URL=${DASHBOARD_URL:-"https://kindle-llm-dash-1.vercel.app/api/dashboard?profile=dp75sdi&w=758&h=1024&claude=true&openai=true&gemini=false"}

if [ -z "$OUT" ]; then
  echo "fetch-dashboard: missing output path"
  exit 2
fi

TMP="${OUT}.tmp"
rm -f "$TMP"

echo "fetch-dashboard: fetching dashboard PNG"

if command -v wget >/dev/null 2>&1; then
  wget -q -O "$TMP" "$URL" || wget --no-check-certificate -q -O "$TMP" "$URL"
elif [ -x "$(dirname "$0")/../xh" ]; then
  "$(dirname "$0")/../xh" -d -q -o "$TMP" get "$URL"
elif [ -x "$(dirname "$0")/../ht" ]; then
  "$(dirname "$0")/../ht" -d -q -o "$TMP" get "$URL"
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
