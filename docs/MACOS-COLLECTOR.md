# macOS Collector

## Prerequisites

Install Node.js 20.9+, Claude Code, and Codex CLI. Sign in through each official client. Claude quota becomes observable after an assistant response; Codex quota is read without sending a prompt.

## Install

From the repository root:

```sh
./collector/install-macos.sh --ingest-url 'https://your-project.vercel.app/api/usage'
```

The installer prompts for `DASHBOARD_INGEST_TOKEN`, stores it as the `KindleLLMDashboard.ingest` generic password in the current user's Keychain, and never writes it to config, the LaunchAgent, or the ownership manifest. Runtime files live under `~/Library/Application Support/KindleLLMDashboard`.

The per-user `com.kindle-llm-dashboard.sync` LaunchAgent runs once at login and every 720 seconds while the user session is awake. It does not keep the Mac awake and does not run as a server. Claude status-line events launch a separate bounded one-shot upload without querying Codex.

The Mac does not need to remain on for Vercel or the Kindle to keep displaying the last accepted snapshot. Codex activity from mobile or cloud sessions is corrected at the next successful desktop poll. Claude mobile activity is corrected after the next Claude Code response on an enrolled desktop. Delayed sync labels are expected when no desktop has observed newer provider state.

The installer refuses to replace an unrelated Claude status line or LaunchAgent. Use `--replace-existing-status-line` only after reviewing the timestamped settings backup.

## Diagnose

```sh
./collector/diagnose-macos.sh
```

Diagnostics return booleans and a Node major-version class only. They do not print quota values, account identity, paths, config content, Keychain values, or provider output.

## Uninstall

```sh
./collector/uninstall-macos.sh
```

Uninstall removes only the manifest-owned LaunchAgent, Keychain item, runtime directory, and project-owned Claude status line. Other Claude settings changed after installation are preserved, and the timestamped original settings backup remains available outside the install directory.
