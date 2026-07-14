#!/usr/bin/env sh

CANDIDATE=$1
CACHE=$2
DISPLAY_CMD=$3

if [ -z "$CANDIDATE" ] || [ -z "$CACHE" ] || [ -z "$DISPLAY_CMD" ]; then
  echo "promote-dashboard-candidate: candidate, cache, and display command are required" >&2
  exit 2
fi

cleanup() {
  [ -n "$CANDIDATE" ] && rm -f "$CANDIDATE"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if "$DISPLAY_CMD" "$CANDIDATE" && mv -f "$CANDIDATE" "$CACHE"; then
  CANDIDATE=''
  exit 0
fi

rm -f "$CANDIDATE"
CANDIDATE=''
if [ -s "$CACHE" ]; then
  "$DISPLAY_CMD" "$CACHE" || true
fi
exit 1
