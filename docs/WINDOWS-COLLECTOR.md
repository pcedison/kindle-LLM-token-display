# Windows Collector

## Prerequisites

Install Node.js 20.9+, Claude Code, and Codex CLI. Sign in through each official client. Generate at least one Claude response so status-line rate-limit fields become available.

## Install

From the repository root:

```powershell
.\collector\install-windows.ps1 -IngestUrl 'https://your-project.vercel.app/api/usage'
```

The prompt accepts the Vercel `DASHBOARD_INGEST_TOKEN` as a SecureString. The installer copies the collector to `%LOCALAPPDATA%\KindleLLMDashboard`, protects config and manifest ACLs, backs up Claude settings, registers the project status line, and creates a randomly named `Kindle LLM Quota Uploader-<GUID>` task. It runs at sign-in and every 12 minutes while the user session is awake. Missed work may run after resume, but the task never wakes a sleeping computer and overlapping runs are ignored. The protected manifest owns that exact task name and action across reinstalls. Use `-CodexCommand` only when Codex is not on PATH. Use `-ReplaceExistingStatusLine` only after reviewing the timestamped backup.

## Verify

Run Claude Code once, then:

```powershell
.\collector\diagnose-windows.ps1
```

Diagnostics intentionally show only booleans and a Node major-version class, including checks for the login trigger, 12-minute cadence, missed-run behavior, no-wake setting, and overlap protection. Quota values, identity, paths, config content, and command stderr are omitted.

The first Claude snapshot appears only after an assistant response. Codex must be signed in with ChatGPT. A failed provider does not erase the last valid other-provider snapshot; upload retry uses a bounded backoff.

## Rotate or Recover

To rotate the ingest token, change `DASHBOARD_INGEST_TOKEN` in Vercel and rerun the installer with the same ingest URL. A failed reinstall restores the prior project install and Claude settings. Timestamped Claude backups are retained outside the project install directory.

## Uninstall

```powershell
.\collector\uninstall-windows.ps1
```

The script ends, revalidates, and removes only the manifest-owned GUID task whose action still matches this project, then removes the install root. It restores only the original `statusLine` field when the current command still belongs to this project; unrelated settings changed after installation are preserved. A missing or invalid protected manifest causes a safe refusal instead of guessing what to delete.
