#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_PNG="$DIR/test-frame.png"
DISPLAY_ONCE_CMD="$DIR/local/display-once.sh"

if command -v nohup >/dev/null 2>&1; then
  nohup "$DISPLAY_ONCE_CMD" "$TEST_PNG" >/dev/null 2>&1 </dev/null &
else
  "$DISPLAY_ONCE_CMD" "$TEST_PNG" >/dev/null 2>&1 </dev/null &
fi

echo "Test frame refresh queued."
