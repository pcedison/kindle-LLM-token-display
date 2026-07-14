#!/bin/sh
set -u

owner='kindle-llm-dash/macos-collector'
label='com.kindle-llm-dashboard.sync'
legacy_keychain_service='KindleLLMDashboard.ingest'
security_bin=${KINDLE_LLM_SECURITY_BIN:-/usr/bin/security}
launchctl_bin=${KINDLE_LLM_LAUNCHCTL_BIN:-/bin/launchctl}
osascript_bin=${KINDLE_LLM_OSASCRIPT_BIN:-/usr/bin/osascript}
node_bin=${KINDLE_LLM_NODE_BIN:-$(command -v node || true)}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
keychain_helper="$script_dir/lib/macos-keychain.js"
install_root="$HOME/Library/Application Support/KindleLLMDashboard"
manifest_path="$install_root/install-manifest.json"
config_path="$install_root/config.json"
launch_agent_path="$HOME/Library/LaunchAgents/$label.plist"
settings_path="$HOME/.claude/settings.json"

bool() { if "$@"; then printf true; else printf false; fi; }

node_available=false
node_version_class=null
if [ -n "$node_bin" ]; then
  node_available=true
  node_major=$("$node_bin" --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')
  if [ -n "$node_major" ]; then node_version_class="\"major-$node_major\""; fi
fi

manifest_valid=false
keychain_present=false
status_line_owned=false
if [ "$node_available" = true ] && [ -f "$manifest_path" ]; then
  if "$node_bin" -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (m.schemaVersion !== 1 || m.owner !== process.argv[2]) process.exit(1);
' "$manifest_path" "$owner" >/dev/null 2>&1; then
    manifest_valid=true
    service=$("$node_bin" -e 'const m=require(process.argv[1]); process.stdout.write(m.keychainService || "")' "$manifest_path" 2>/dev/null || true)
    account=$("$node_bin" -e 'const m=require(process.argv[1]); process.stdout.write(m.keychainAccount || "")' "$manifest_path" 2>/dev/null || true)
    if [ -n "$service" ] && [ -n "$account" ]; then
      if [ "$service" = "$legacy_keychain_service" ] && \
        "$security_bin" find-generic-password -s "$service" -a "$account" >/dev/null 2>&1; then
        keychain_present=true
      elif [ "$service" != "$legacy_keychain_service" ] && [ -f "$keychain_helper" ] && \
        "$osascript_bin" -l JavaScript "$keychain_helper" exists "$service" "$account" >/dev/null 2>&1; then
        keychain_present=true
      fi
    fi
    if [ -f "$settings_path" ] && "$node_bin" -e '
const fs=require("fs");
const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const m=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if (s?.statusLine?.command !== m.statusLineCommand) process.exit(1);
' "$settings_path" "$manifest_path" >/dev/null 2>&1; then
      status_line_owned=true
    fi
  fi
fi

launch_agent_present=$(bool test -f "$launch_agent_path")
launch_agent_loaded=false
if "$launchctl_bin" print "gui/$(id -u)/$label" >/dev/null 2>&1; then launch_agent_loaded=true; fi
config_present=$(bool test -f "$config_path")
last_upload_present=$(bool test -f "$install_root/state/last-upload.json")

printf '{"nodeAvailable":%s,"nodeVersionClass":%s,"manifestValid":%s,"configPresent":%s,"keychainPresent":%s,"statusLineOwned":%s,"launchAgentPresent":%s,"launchAgentLoaded":%s,"lastUploadPresent":%s}\n' \
  "$node_available" "$node_version_class" "$manifest_valid" "$config_present" "$keychain_present" "$status_line_owned" "$launch_agent_present" "$launch_agent_loaded" "$last_upload_present"
