#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
DASH_PNG="$DIR/dash.png"
DISPLAY_ONCE_CMD="$DIR/local/display-once.sh"

if [ ! -s "$DASH_PNG" ]; then
  echo "No cached dashboard image is available."
  exit 1
fi

if command -v nohup >/dev/null 2>&1; then
  nohup "$DISPLAY_ONCE_CMD" "$DASH_PNG" >/dev/null 2>&1 </dev/null &
else
  "$DISPLAY_ONCE_CMD" "$DASH_PNG" >/dev/null 2>&1 </dev/null &
fi

echo "Cached dashboard refresh queued."
