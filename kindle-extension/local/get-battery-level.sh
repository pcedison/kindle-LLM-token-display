#!/usr/bin/env sh

DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck disable=SC1091
. "$DIR/dashboard-utils.sh"

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
  /sys/class/power_supply/battery/battery_capacity \
  /sys/class/power_supply/battery/capacity \
  /sys/class/power_supply/BAT0/battery_capacity \
  /sys/class/power_supply/BAT0/capacity \
  /sys/class/power_supply/*/battery_capacity \
  /sys/class/power_supply/*/capacity \
  /sys/devices/platform/*/battery_capacity \
  /sys/devices/platform/*/capacity; do
  if battery=$(read_file_battery "$battery_file"); then
    printf '%s\n' "$battery"
    exit 0
  fi
done

if battery=$(read_command_battery lipc-get-prop com.lab126.powerd battLevel); then
  printf '%s\n' "$battery"
  exit 0
fi

if battery=$(powerd_test -s 2>/dev/null | sed -n 's/^[[:space:]]*Battery Level:[[:space:]]*//p' | while IFS= read -r value; do normalize_battery_level "$value" && break; done); then
  [ -n "$battery" ] && printf '%s\n' "$battery" && exit 0
fi

exit 1
