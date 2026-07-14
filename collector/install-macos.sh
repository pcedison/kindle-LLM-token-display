#!/bin/sh
set -eu
set +x

owner='kindle-llm-dash/macos-collector'
label='com.kindle-llm-dashboard.sync'
keychain_service='KindleLLMDashboard.ingest.v2'
legacy_keychain_service='KindleLLMDashboard.ingest'
security_bin=${KINDLE_LLM_SECURITY_BIN:-/usr/bin/security}
launchctl_bin=${KINDLE_LLM_LAUNCHCTL_BIN:-/bin/launchctl}
plutil_bin=${KINDLE_LLM_PLUTIL_BIN:-/usr/bin/plutil}
osascript_bin=${KINDLE_LLM_OSASCRIPT_BIN:-/usr/bin/osascript}
node_bin=${KINDLE_LLM_NODE_BIN:-$(command -v node || true)}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
keychain_helper="$script_dir/lib/macos-keychain.js"

tty_echo_disabled=0
restore_tty() {
  if [ "$tty_echo_disabled" -eq 1 ]; then
    stty echo 2>/dev/null || true
    tty_echo_disabled=0
  fi
}
trap restore_tty EXIT
trap 'exit 1' HUP INT TERM

ingest_url=''
codex_command='codex'
replace_status_line=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ingest-url)
      [ "$#" -ge 2 ] || { printf '%s\n' 'Missing ingest URL' >&2; exit 1; }
      ingest_url=$2
      shift 2
      ;;
    --codex-command)
      [ "$#" -ge 2 ] || { printf '%s\n' 'Missing Codex command' >&2; exit 1; }
      codex_command=$2
      shift 2
      ;;
    --replace-existing-status-line)
      replace_status_line=1
      shift
      ;;
    *)
      printf '%s\n' 'Unknown installer option' >&2
      exit 1
      ;;
  esac
done

[ -n "$node_bin" ] || { printf '%s\n' 'Node.js 20.9 or newer is required' >&2; exit 1; }
[ -x "$osascript_bin" ] || { printf '%s\n' 'osascript is required' >&2; exit 1; }
[ -f "$keychain_helper" ] || { printf '%s\n' 'Keychain helper is missing' >&2; exit 1; }
[ -n "$ingest_url" ] || { printf '%s\n' 'The --ingest-url option is required' >&2; exit 1; }
"$node_bin" -e '
const url = new URL(process.argv[1]);
const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
if (url.protocol !== "https:" && !local) process.exit(1);
' "$ingest_url" || { printf '%s\n' 'Ingest URL must use HTTPS' >&2; exit 1; }

install_root="$HOME/Library/Application Support/KindleLLMDashboard"
collector_root="$install_root/collector"
config_path="$install_root/config.json"
manifest_path="$install_root/install-manifest.json"
settings_path="$HOME/.claude/settings.json"
launch_agent_dir="$HOME/Library/LaunchAgents"
launch_agent_path="$launch_agent_dir/$label.plist"
keychain_account=${USER:-$(id -un)}
status_line_command="\"$node_bin\" \"$collector_root/claude-statusline.mjs\" \"--config=$config_path\""

required_runtime_files='claude-statusline.mjs
upload.mjs
lib/claudeStatus.mjs
lib/codexRateLimits.mjs
lib/collectorConfig.mjs
lib/collectorLock.mjs
lib/macos-keychain.js
lib/collectorSecret.mjs
lib/localState.mjs
lib/paths.mjs
lib/runCollector.mjs
lib/triggerUpload.mjs
lib/uploadClient.mjs'
printf '%s\n' "$required_runtime_files" | while IFS= read -r runtime_file; do
  [ -f "$script_dir/$runtime_file" ] || { printf '%s\n' 'Collector runtime is incomplete' >&2; exit 1; }
done
[ -f "$project_root/app/api/dashboard/quotaSnapshot.mjs" ] || {
  printf '%s\n' 'Quota contract module is missing' >&2
  exit 1
}

existing_install=0
backup_path=''
owned_status_line=''
if [ -e "$install_root" ]; then
  [ -f "$manifest_path" ] || { printf '%s\n' 'Installation manifest is missing; refusing unsafe replacement' >&2; exit 1; }
  "$node_bin" -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (m.schemaVersion !== 1 || m.owner !== process.argv[2]) process.exit(1);
' "$manifest_path" "$owner" || { printf '%s\n' 'Installation manifest is invalid; refusing unsafe replacement' >&2; exit 1; }
  existing_install=1
  backup_path=$("$node_bin" -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(m.backupPath || "");
' "$manifest_path")
  owned_status_line=$("$node_bin" -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(m.statusLineCommand || "");
' "$manifest_path")
fi

if [ -f "$settings_path" ]; then
  current_status_line=$("$node_bin" -e '
const fs = require("fs");
try {
  const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(typeof s?.statusLine?.command === "string" ? s.statusLine.command : "");
} catch { process.exit(1); }
' "$settings_path") || { printf '%s\n' 'Claude settings are invalid' >&2; exit 1; }
else
  current_status_line=''
fi
if [ -n "$current_status_line" ] && [ "$current_status_line" != "$status_line_command" ] && [ "$current_status_line" != "$owned_status_line" ] && [ "$replace_status_line" -ne 1 ]; then
  printf '%s\n' 'Refusing to replace a foreign Claude status line' >&2
  exit 1
fi

if [ -f "$launch_agent_path" ]; then
  if [ "$existing_install" -ne 1 ] || ! grep -q "<string>$label</string>" "$launch_agent_path"; then
    printf '%s\n' 'Refusing to replace a foreign LaunchAgent' >&2
    exit 1
  fi
fi

printf '%s' 'Dashboard ingest token: ' >&2
read_bounded_token() {
  "$node_bin" -e '
const fs = require("fs");
const maximum = 16384;
const buffer = Buffer.alloc(maximum + 2);
let length = 0;
let newline = -1;
while (length < buffer.length && newline < 0) {
  const count = fs.readSync(0, buffer, length, buffer.length - length, null);
  if (count === 0) break;
  length += count;
  newline = buffer.subarray(0, length).indexOf(10);
}
if (newline >= 0) length = newline;
if (length > 0 && buffer[length - 1] === 13) length -= 1;
if (length > maximum) process.exit(2);
if (length === 0) process.exit(3);
process.stdout.write(buffer.subarray(0, length));
'
}
if [ -t 0 ]; then
  tty_echo_disabled=1
  stty -echo
  ingest_token=$(read_bounded_token) || ingest_token=''
  restore_tty
  printf '\n' >&2
else
  ingest_token=$(read_bounded_token) || ingest_token=''
fi
[ -n "$ingest_token" ] || { printf '%s\n' 'Dashboard ingest token is required' >&2; exit 1; }

old_keychain_token=''
old_keychain_present=0
if old_keychain_token=$("$osascript_bin" -l JavaScript "$keychain_helper" read "$keychain_service" "$keychain_account" 2>/dev/null); then
  old_keychain_present=1
fi
legacy_keychain_present=0
if "$security_bin" find-generic-password -s "$legacy_keychain_service" -a "$keychain_account" >/dev/null 2>&1; then
  legacy_keychain_present=1
fi

settings_existed=0
settings_rollback=''
install_backup=''
plist_backup=''
backup_created=0
keychain_changed=0
success=0

write_keychain_token() {
  printf '%s' "$1" | "$osascript_bin" -l JavaScript "$keychain_helper" write "$keychain_service" "$keychain_account" >/dev/null
}

delete_keychain_token() {
  "$osascript_bin" -l JavaScript "$keychain_helper" delete "$keychain_service" "$keychain_account" >/dev/null
}

cleanup() {
  exit_code=$?
  set +e
  restore_tty
  rollback_failed=0
  restore_agent=0
  if [ "$success" -ne 1 ]; then
    "$launchctl_bin" bootout "gui/$(id -u)" "$launch_agent_path" >/dev/null 2>&1 || true
    if [ "$keychain_changed" -eq 1 ]; then
      if [ "$old_keychain_present" -eq 1 ]; then
        if ! write_keychain_token "$old_keychain_token" >/dev/null 2>&1; then
          rollback_failed=1
        fi
      else
        if ! delete_keychain_token >/dev/null 2>&1; then
          rollback_failed=1
        fi
      fi
    fi
    if ! rm -rf "$install_root"; then rollback_failed=1; fi
    if [ -n "$install_backup" ] && [ -d "$install_backup" ]; then
      if ! mv "$install_backup" "$install_root"; then rollback_failed=1; fi
    fi
    if [ -n "$settings_rollback" ] && [ -f "$settings_rollback" ]; then
      if ! mkdir -p "$(dirname "$settings_path")"; then rollback_failed=1; fi
      if ! mv -f "$settings_rollback" "$settings_path"; then rollback_failed=1; fi
    elif [ "$settings_existed" -eq 0 ]; then
      if ! rm -f "$settings_path"; then rollback_failed=1; fi
    fi
    if [ -n "$plist_backup" ] && [ -f "$plist_backup" ]; then
      if mv -f "$plist_backup" "$launch_agent_path"; then
        restore_agent=1
      else
        rollback_failed=1
      fi
    elif ! rm -f "$launch_agent_path"; then
      rollback_failed=1
    fi
    if [ "$backup_created" -eq 1 ] && [ -n "$backup_path" ] && ! rm -f "$backup_path"; then
      rollback_failed=1
    fi
    if [ "$restore_agent" -eq 1 ] && [ "$rollback_failed" -eq 0 ] && \
      ! "$launchctl_bin" bootstrap "gui/$(id -u)" "$launch_agent_path" >/dev/null 2>&1; then
      rollback_failed=1
    fi
    if [ "$rollback_failed" -eq 1 ]; then
      printf '%s\n' 'Installer rollback incomplete' >&2
    fi
  fi
  ingest_token=''
  old_keychain_token=''
  return "$exit_code"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ -f "$settings_path" ]; then
  settings_existed=1
  settings_rollback="$settings_path.kindlelmldashboard.rollback.$$"
  cp "$settings_path" "$settings_rollback"
fi
if [ "$existing_install" -eq 0 ] && [ "$settings_existed" -eq 1 ]; then
  backup_path="$settings_path.kindlelmldashboard.$(date '+%Y%m%d-%H%M%S').bak"
  cp "$settings_path" "$backup_path"
  chmod 600 "$backup_path"
  backup_created=1
fi
if [ -d "$install_root" ]; then
  install_backup="$install_root.rollback.$$"
  mv "$install_root" "$install_backup"
fi
if [ -f "$launch_agent_path" ]; then
  plist_backup="$launch_agent_path.rollback.$$"
  cp "$launch_agent_path" "$plist_backup"
fi

keychain_changed=1
write_keychain_token "$ingest_token"
verified_keychain_token=''
if ! verified_keychain_token=$("$osascript_bin" -l JavaScript "$keychain_helper" read "$keychain_service" "$keychain_account" 2>/dev/null) \
  || [ "$verified_keychain_token" != "$ingest_token" ]; then
  verified_keychain_token=''
  printf '%s\n' 'Keychain verification failed' >&2
  exit 1
fi
verified_keychain_token=''

mkdir -p "$collector_root" "$install_root/app/api/dashboard" "$launch_agent_dir" "$(dirname "$settings_path")"
printf '%s\n' "$required_runtime_files" | while IFS= read -r runtime_file; do
  mkdir -p "$(dirname "$collector_root/$runtime_file")"
  cp "$script_dir/$runtime_file" "$collector_root/$runtime_file"
done
cp "$project_root/app/api/dashboard/quotaSnapshot.mjs" "$install_root/app/api/dashboard/quotaSnapshot.mjs"

"$node_bin" -e '
const fs = require("fs");
const [path, ingestUrl, service, account, codexCommand] = process.argv.slice(1);
const value = {
  ingestUrl,
  ingestTokenSource: "macos-keychain",
  keychainService: service,
  keychainAccount: account,
  codexCommand,
  timeoutMs: 30000,
  timeZone: "Asia/Taipei",
};
fs.writeFileSync(path, JSON.stringify(value, null, 2));
' "$config_path" "$ingest_url" "$keychain_service" "$keychain_account" "$codex_command"
chmod 600 "$config_path"

"$node_bin" -e '
const fs = require("fs");
const [path, command] = process.argv.slice(1);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(path, "utf8")); } catch (error) {
  if (error.code !== "ENOENT") throw error;
}
settings.statusLine = { type: "command", command, padding: 0 };
const temp = `${path}.tmp.${process.pid}`;
fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
fs.renameSync(temp, path);
' "$settings_path" "$status_line_command"
chmod 600 "$settings_path"

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}
node_xml=$(xml_escape "$node_bin")
upload_xml=$(xml_escape "$collector_root/upload.mjs")
config_xml=$(xml_escape "--config=$config_path")
cat > "$launch_agent_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_xml</string>
    <string>$upload_xml</string>
    <string>--mode=scheduled-sync</string>
    <string>$config_xml</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>720</integer>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>
EOF
chmod 600 "$launch_agent_path"
"$plutil_bin" -lint "$launch_agent_path" >/dev/null

"$node_bin" -e '
const fs = require("fs");
const [path, owner, installRoot, launchAgentPath, settingsPath, backupPath, command, service, account] = process.argv.slice(1);
const value = {
  schemaVersion: 1,
  owner,
  installRoot,
  launchAgentPath,
  claudeSettingsPath: settingsPath,
  backupPath: backupPath || null,
  statusLineCommand: command,
  keychainService: service,
  keychainAccount: account,
};
fs.writeFileSync(path, JSON.stringify(value, null, 2));
' "$manifest_path" "$owner" "$install_root" "$launch_agent_path" "$settings_path" "$backup_path" "$status_line_command" "$keychain_service" "$keychain_account"
chmod 600 "$manifest_path"

"$launchctl_bin" bootout "gui/$(id -u)" "$launch_agent_path" >/dev/null 2>&1 || true
"$launchctl_bin" bootstrap "gui/$(id -u)" "$launch_agent_path" >/dev/null

success=1
if [ "$legacy_keychain_present" -eq 1 ] && \
  ! "$security_bin" delete-generic-password -s "$legacy_keychain_service" -a "$keychain_account" >/dev/null 2>&1; then
  success=0
  printf '%s\n' 'Legacy Keychain migration failed' >&2
  exit 1
fi
if [ -n "$install_backup" ]; then rm -rf "$install_backup" || true; fi
if [ -n "$settings_rollback" ]; then rm -f "$settings_rollback" || true; fi
if [ -n "$plist_backup" ]; then rm -f "$plist_backup" || true; fi
printf '%s\n' '{"installed":true}'
