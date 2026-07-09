#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/local/env.sh"
DASH_PNG="${1:-$DIR/dash.png}"
LOG_FILE="$DIR/logs/dash.log"

mkdir -p "$DIR/logs"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

sleep "${KUAL_SETTLE_DELAY_SECS:-3}"

echo "$(date) display-once: preparing dashboard display" >>"$LOG_FILE"

if [ "$STOP_KINDLE_UI" = true ] && [ "$ALLOW_FRAMEWORK_STOP" = true ]; then
  echo "$(date) display-once: stopping Kindle UI framework" >>"$LOG_FILE"
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
  initctl stop webreader >/dev/null 2>&1 || true
  /etc/init.d/framework stop >/dev/null 2>&1 || true
  initctl stop framework >/dev/null 2>&1 || true
  stop framework >/dev/null 2>&1 || true
  sleep "${UI_SETTLE_DELAY_SECS:-2}"
else
  if [ "$STOP_KINDLE_UI" = true ]; then
    echo "$(date) display-once: STOP_KINDLE_UI ignored because ALLOW_FRAMEWORK_STOP is not true" >>"$LOG_FILE"
  fi
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
fi

if [ "$CLEAR_BEFORE_DISPLAY" = true ]; then
  echo "$(date) display-once: clearing screen" >>"$LOG_FILE"
  /usr/sbin/eips -c >>"$LOG_FILE" 2>&1 || true
  sleep 1
else
  echo "$(date) display-once: clear skipped" >>"$LOG_FILE"
fi

echo "$(date) display-once: drawing $DASH_PNG" >>"$LOG_FILE"
/usr/sbin/eips -f -g "$DASH_PNG" >>"$LOG_FILE" 2>&1
echo "$(date) display-once: draw exit $?" >>"$LOG_FILE"
