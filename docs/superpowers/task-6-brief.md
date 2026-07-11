# Task 6: Reversible Windows Installation

Preserve Tasks 1-5. Create only:

- `collector/install-windows.ps1`
- `collector/uninstall-windows.ps1`
- `collector/diagnose-windows.ps1`
- `tests/collectorWindows.test.mjs`

Implement a per-user install under `%LOCALAPPDATA%\KindleLLMDashboard`. Accept `-IngestUrl`, optional `-CodexCommand`, and `-ReplaceExistingStatusLine`. Prompt for the ingest secret using `Read-Host -AsSecureString`; never accept or echo it as a command-line argument. Store protected config readable only by the current user and SYSTEM, and fail closed if ACL hardening fails.

Register exactly `Kindle LLM Quota Uploader` every five minutes. The scheduled-task command line may contain executable/script paths only, never tokens, headers, snapshot content, or identity. Parse `%USERPROFILE%\.claude\settings.json` as JSON, back it up before mutation, preserve unrelated keys, refuse to overwrite a foreign `statusLine` unless explicitly authorized, and make reinstall idempotent.

Diagnostics report only booleans/version classes for Node, Claude, Codex, config, spool, task, and last-upload status. Never print credentials, identity, quota data, raw stderr, or user-sensitive paths. Uninstall removes only the exact named task and project-owned files, restores a backup only while the current status line still points to this project, and leaves timestamped backups for manual recovery.

Use PowerShell 5.1-compatible syntax. Add static tests for token absence in `/TR`, user-profile install root, backup-before-mutation, foreign status-line refusal, five-minute schedule, exact uninstall ownership, ACL failure, diagnostics redaction, user-change preservation, and idempotent uninstall. Record RED/GREEN evidence in `docs/superpowers/task-6-report.md`, run PowerShell parser validation, focused tests, `npm.cmd test`, and `npm.cmd run build`, then obtain independent review before Task 7.
