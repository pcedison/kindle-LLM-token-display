#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"

pkill -f "/mnt/us/extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true
pkill -f "extensions/kindle-dash/dash.sh" >/dev/null 2>&1 || true

lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1 || true
lipc-set-prop com.lab126.wifid enable 1 >/dev/null 2>&1 || true
/etc/init.d/framework start >/dev/null 2>&1 || true
initctl start framework >/dev/null 2>&1 || true
start framework >/dev/null 2>&1 || true
initctl start webreader >/dev/null 2>&1 || true
/usr/sbin/eips -c >/dev/null 2>&1 || true

echo "Kindle dashboard stopped; framework requested to start."
