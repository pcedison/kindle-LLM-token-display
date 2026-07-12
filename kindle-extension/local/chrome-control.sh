#!/usr/bin/env sh

hide_kindle_chrome() {
  if [ "${HIDE_KINDLE_CHROME:-true}" != true ]; then
    echo "Kindle system chrome left enabled."
    return 0
  fi

  echo "Hiding Kindle system chrome."
  lipc-set-prop com.lab126.pillow disableEnablePillow disable >/dev/null 2>&1 || true

  if [ "${FREEZE_KINDLE_WINDOW_MANAGER:-true}" = true ]; then
    if killall -STOP awesome >/dev/null 2>&1; then
      echo "Kindle window manager paused."
    else
      echo "Kindle window manager process not found; Pillow remains hidden."
    fi
  fi
}

restore_kindle_chrome() {
  # Recovery is intentionally unconditional so stop.sh can repair a prior run
  # even when the local configuration was changed afterward.
  killall -CONT awesome >/dev/null 2>&1 || true
  lipc-set-prop com.lab126.pillow disableEnablePillow enable >/dev/null 2>&1 || true
  echo "Kindle system chrome restored."
}
