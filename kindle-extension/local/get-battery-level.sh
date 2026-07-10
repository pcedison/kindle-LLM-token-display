#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck disable=SC1091
. "$DIR/dashboard-utils.sh"

BATTERY_SYSFS_ROOT=${BATTERY_SYSFS_ROOT:-/sys}

read_command_battery() {
  value=$("$@" 2>/dev/null) || return 1
  normalize_battery_level "$value"
}

read_file_battery() {
  [ -r "$1" ] || return 1
  value=$(cat "$1" 2>/dev/null) || return 1
  normalize_battery_level "$value"
}

if [ "$#" -gt 0 ]; then
  normalize_battery_level "$1"
  exit $?
fi

if battery=$(read_command_battery gasgauge-info -c); then
  printf '%s\n' "$battery"
  exit 0
fi

for battery_file in \
  "$BATTERY_SYSFS_ROOT"/devices/system/yoshi_battery/yoshi_battery0/battery_capacity \
  "$BATTERY_SYSFS_ROOT"/devices/system/wario_battery/wario_battery0/battery_capacity \
  "$BATTERY_SYSFS_ROOT"/devices/system/*battery*/*/battery_capacity \
  "$BATTERY_SYSFS_ROOT"/class/power_supply/battery/battery_capacity \
  "$BATTERY_SYSFS_ROOT"/class/power_supply/battery/capacity \
  "$BATTERY_SYSFS_ROOT"/class/power_supply/BAT0/battery_capacity \
  "$BATTERY_SYSFS_ROOT"/class/power_supply/BAT0/capacity \
  "$BATTERY_SYSFS_ROOT"/class/power_supply/*/battery_capacity \
  "$BATTERY_SYSFS_ROOT"/class/power_supply/*/capacity \
  "$BATTERY_SYSFS_ROOT"/devices/platform/*/battery_capacity \
  "$BATTERY_SYSFS_ROOT"/devices/platform/*/capacity; do
  if battery=$(read_file_battery "$battery_file"); then
    printf '%s\n' "$battery"
    exit 0
  fi
done

if battery=$(read_command_battery lipc-get-prop com.lab126.powerd battLevel); then
  printf '%s\n' "$battery"
  exit 0
fi

powerd_value=$(powerd_test -s 2>/dev/null | sed -n 's/^[[:space:]]*Battery Level:[[:space:]]*//p' | sed -n '1p')
if battery=$(normalize_battery_level "$powerd_value"); then
  printf '%s\n' "$battery"
  exit 0
fi

exit 1
