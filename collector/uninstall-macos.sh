#!/bin/sh
set -eu

owner='kindle-llm-dash/macos-collector'
label='com.kindle-llm-dashboard.sync'
security_bin=${KINDLE_LLM_SECURITY_BIN:-/usr/bin/security}
launchctl_bin=${KINDLE_LLM_LAUNCHCTL_BIN:-/bin/launchctl}
node_bin=${KINDLE_LLM_NODE_BIN:-$(command -v node || true)}
install_root="$HOME/Library/Application Support/KindleLLMDashboard"
manifest_path="$install_root/install-manifest.json"
launch_agent_path="$HOME/Library/LaunchAgents/$label.plist"
settings_path="$HOME/.claude/settings.json"

if [ ! -e "$install_root" ] && [ ! -e "$launch_agent_path" ]; then
  printf '%s\n' '{"uninstalled":true,"alreadyAbsent":true}'
  exit 0
fi
[ -n "$node_bin" ] || { printf '%s\n' 'Node.js is required for safe removal' >&2; exit 1; }
[ -f "$manifest_path" ] || { printf '%s\n' 'Installation manifest is missing; refusing unsafe removal' >&2; exit 1; }

"$node_bin" -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const [owner, installRoot, launchAgentPath, settingsPath] = process.argv.slice(2);
if (m.schemaVersion !== 1 || m.owner !== owner || m.installRoot !== installRoot || m.launchAgentPath !== launchAgentPath || m.claudeSettingsPath !== settingsPath) process.exit(1);
' "$manifest_path" "$owner" "$install_root" "$launch_agent_path" "$settings_path" || {
  printf '%s\n' 'Installation manifest is invalid; refusing unsafe removal' >&2
  exit 1
}

if [ -f "$launch_agent_path" ]; then
  grep -q "<string>$label</string>" "$launch_agent_path" || {
    printf '%s\n' 'LaunchAgent ownership is invalid; refusing unsafe removal' >&2
    exit 1
  }
  grep -q 'upload.mjs' "$launch_agent_path" || {
    printf '%s\n' 'LaunchAgent ownership is invalid; refusing unsafe removal' >&2
    exit 1
  }
fi

backup_path=$("$node_bin" -e 'const m=require(process.argv[1]); process.stdout.write(m.backupPath || "")' "$manifest_path")
owned_command=$("$node_bin" -e 'const m=require(process.argv[1]); process.stdout.write(m.statusLineCommand || "")' "$manifest_path")
keychain_service=$("$node_bin" -e 'const m=require(process.argv[1]); process.stdout.write(m.keychainService || "")' "$manifest_path")
keychain_account=$("$node_bin" -e 'const m=require(process.argv[1]); process.stdout.write(m.keychainAccount || "")' "$manifest_path")

"$launchctl_bin" bootout "gui/$(id -u)" "$launch_agent_path" >/dev/null 2>&1 || true
rm -f "$launch_agent_path"

if [ -f "$settings_path" ]; then
  "$node_bin" -e '
const fs = require("fs");
const [settingsPath, ownedCommand, backupPath] = process.argv.slice(1);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
if (settings?.statusLine?.command === ownedCommand) {
  let original = {};
  if (backupPath && fs.existsSync(backupPath)) original = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  if (Object.hasOwn(original, "statusLine")) settings.statusLine = original.statusLine;
  else delete settings.statusLine;
  const temp = `${settingsPath}.tmp.${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
  fs.renameSync(temp, settingsPath);
}
' "$settings_path" "$owned_command" "$backup_path"
fi

if [ -n "$keychain_service" ]; then
  "$security_bin" delete-generic-password -s "$keychain_service" -a "$keychain_account" >/dev/null 2>&1 || true
fi
rm -rf "$install_root"
printf '%s\n' '{"uninstalled":true,"alreadyAbsent":false}'
