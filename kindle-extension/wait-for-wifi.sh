#!/usr/bin/env sh

TEST_IP=${1:-1.1.1.1}

if command -v lipc-set-prop >/dev/null 2>&1; then
  lipc-set-prop com.lab126.wifid enable 1 >/dev/null 2>&1 || true
fi

if command -v lipc-get-prop >/dev/null 2>&1; then
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    state=$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null || true)
    [ "$state" = CONNECTED ] && exit 0
    attempt=$((attempt + 1))
    sleep 1
  done
fi

if command -v ping >/dev/null 2>&1; then
  ping -c 1 -W 3 "$TEST_IP" >/dev/null 2>&1 && exit 0
fi

exit 1
