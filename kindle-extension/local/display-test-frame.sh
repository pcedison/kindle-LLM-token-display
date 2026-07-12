#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DIR/local/env.sh"
TEST_PNG="$DIR/test-frame.png"
LOG_FILE="$DIR/logs/dash.log"

mkdir -p "$DIR/logs"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

sleep "${KUAL_SETTLE_DELAY_SECS:-3}"

echo "$(date) display-test-frame: drawing $TEST_PNG" >>"$LOG_FILE"
lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
/usr/sbin/eips -f -g "$TEST_PNG" >>"$LOG_FILE" 2>&1
echo "$(date) display-test-frame: draw exit $?" >>"$LOG_FILE"
