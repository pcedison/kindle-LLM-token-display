# Task 6 Report

## RED

Command: `node --test tests/collectorWindows.test.mjs`

Result before implementation: 0 passed, 5 failed. All failures were caused by the three required PowerShell scripts being absent.

## GREEN

Focused command: `node --test tests/collectorWindows.test.mjs`

Result: 5 passed, 0 failed. The test parses all three scripts with Windows
PowerShell and verifies the per-user root, SecureString prompt, ACL failure
handling, token-free five-minute task, settings backup/refusal, redacted
diagnostics, and ownership-safe uninstall.

Full command: `npm.cmd test`

Result: 87 passed, 0 failed, 0 cancelled.

Build command: `npm.cmd run build`

Result: exit 0; `/api/dashboard` and `/api/usage` compiled successfully.

`git diff --check` and `node --check tests/collectorWindows.test.mjs` also
exited 0. The existing module-type warning for the usage route remains.

## Safety Review

The installer rolls back the exact task, project-owned install root, and its
own status-line mutation if ACL protection or task registration fails. The
uninstaller refuses to remove an installation whose protected manifest is
missing or invalid, and it restores a backup only when the current status-line
command still matches this project.

The post-commit local review also added reinstall staging: an existing install
root is moved to an owned rollback path and restored on failure, while a
pre-existing scheduled task is not deleted by a failed reinstall. Uninstall now
validates the manifest before deleting the task and refuses to remove app files
when task deletion fails. Diagnostics resolve `claude` and `codex` generically
so npm-installed `.cmd` launchers are detected on Windows.

The whole-branch predeployment review found that the installed uploader also
needs the shared quota contract outside `collector/`. The installer now copies
`app/api/dashboard/quotaSnapshot.mjs` into the matching install-root path and
fails closed when it is absent. A static regression test protects this runtime
dependency.
