#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
DASH_PNG="$DIR/dash.png"
DISPLAY_ONCE_CMD="$DIR/local/display-once.sh"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

"$DIR/wait-for-wifi.sh" "$WIFI_TEST_IP" || exit $?
"$DIR/local/fetch-dashboard.sh" "$DASH_PNG" || exit $?

if command -v nohup >/dev/null 2>&1; then
  nohup "$DISPLAY_ONCE_CMD" "$DASH_PNG" >/dev/null 2>&1 </dev/null &
else
  "$DISPLAY_ONCE_CMD" "$DASH_PNG" >/dev/null 2>&1 &
fi

echo "Dashboard fetched; screen refresh queued."
