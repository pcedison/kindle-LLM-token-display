#!/usr/bin/env sh

# Kindle LLM dashboard local settings.
# This file is sourced by the launcher scripts.

export TIMEZONE=${TIMEZONE:-"Asia/Taipei"}
export WIFI_TEST_IP=${WIFI_TEST_IP:-1.1.1.1}

export DASHBOARD_URL=${DASHBOARD_URL:-"https://kindle-llm-dash-1.vercel.app/api/dashboard?profile=dp75sdi&w=758&h=1024&claude=true&openai=true&gemini=false"}

export REFRESH_INTERVAL_SECS=${REFRESH_INTERVAL_SECS:-720}
export FULL_DISPLAY_REFRESH_RATE=${FULL_DISPLAY_REFRESH_RATE:-4}

export KUAL_SETTLE_DELAY_SECS=${KUAL_SETTLE_DELAY_SECS:-3}
export CLEAR_BEFORE_DISPLAY=${CLEAR_BEFORE_DISPLAY:-true}
export STOP_KINDLE_UI=${STOP_KINDLE_UI:-false}
export UI_SETTLE_DELAY_SECS=${UI_SETTLE_DELAY_SECS:-2}

export DASHBOARD_USE_RTC=${DASHBOARD_USE_RTC:-false}
export LOW_BATTERY_REPORTING=${LOW_BATTERY_REPORTING:-false}
export LOW_BATTERY_THRESHOLD_PERCENT=${LOW_BATTERY_THRESHOLD_PERCENT:-10}
