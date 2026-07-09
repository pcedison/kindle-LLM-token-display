#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/local/env.sh"
DASH_PNG="${1:-$DIR/dash.png}"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

sleep "${KUAL_SETTLE_DELAY_SECS:-3}"

if [ "$STOP_KINDLE_UI" = true ]; then
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
  initctl stop webreader >/dev/null 2>&1 || true
  /etc/init.d/framework stop >/dev/null 2>&1 || true
  initctl stop framework >/dev/null 2>&1 || true
  stop framework >/dev/null 2>&1 || true
  sleep "${UI_SETTLE_DELAY_SECS:-2}"
fi

/usr/sbin/eips -f -g "$DASH_PNG"
