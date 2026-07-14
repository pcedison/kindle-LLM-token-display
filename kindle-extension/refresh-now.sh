#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$DIR/local/env.sh"
DASH_PNG="$DIR/dash.png"
DASH_CANDIDATE="${DASH_PNG}.candidate.$$"
DISPLAY_ONCE_CMD="$DIR/local/display-once.sh"
PROMOTE_CANDIDATE_CMD="$DIR/local/promote-dashboard-candidate.sh"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
[ -x "$PROMOTE_CANDIDATE_CMD" ] || { echo "Candidate display helper unavailable" >&2; exit 1; }

cleanup_candidate() {
  [ -n "$DASH_CANDIDATE" ] && rm -f "$DASH_CANDIDATE"
}
trap cleanup_candidate EXIT
trap 'exit 1' HUP INT TERM

"$DIR/wait-for-wifi.sh" "$WIFI_TEST_IP" || exit $?
"$DIR/local/fetch-dashboard.sh" "$DASH_CANDIDATE" || exit $?

if command -v nohup >/dev/null 2>&1; then
  nohup "$PROMOTE_CANDIDATE_CMD" "$DASH_CANDIDATE" "$DASH_PNG" "$DISPLAY_ONCE_CMD" >/dev/null 2>&1 </dev/null &
else
  "$PROMOTE_CANDIDATE_CMD" "$DASH_CANDIDATE" "$DASH_PNG" "$DISPLAY_ONCE_CMD" >/dev/null 2>&1 &
fi
DASH_CANDIDATE=''

echo "Dashboard candidate fetched; validated screen refresh queued."
