import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const files = {
  install: new URL('../collector/install-windows.ps1', import.meta.url),
  uninstall: new URL('../collector/uninstall-windows.ps1', import.meta.url),
  diagnose: new URL('../collector/diagnose-windows.ps1', import.meta.url),
};

function source(name) {
  return readFileSync(files[name], 'utf8');
}

function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function windowsPowerShellEnv() {
  const env = { ...process.env };
  delete env.PSModulePath;
  return env;
}

function runPowerShellHarness(buildScript) {
  const root = mkdtempSync(join(tmpdir(), 'kindle-llm-windows-'));
  const harnessPath = join(root, 'harness.ps1');
  writeFileSync(harnessPath, buildScript(root), 'utf8');
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harnessPath], {
      encoding: 'utf8',
      env: windowsPowerShellEnv(),
    });
    const jsonLine = result.stdout.split(/\r?\n/).findLast((line) => line.startsWith('{') && line.endsWith('}'));
    return { ...result, observation: jsonLine ? JSON.parse(jsonLine) : null };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.platform !== 'win32') {
  test('Windows collector integration tests require Windows', { skip: true }, () => {});
} else {

test('all Windows scripts parse with Windows PowerShell', () => {
  for (const file of Object.values(files)) {
    const command = [
      '$tokens=$null; $errors=$null;',
      `[System.Management.Automation.Language.Parser]::ParseFile('${file.pathname.replace(/^\//, '').replaceAll('/', '\\')}', [ref]$tokens, [ref]$errors) | Out-Null;`,
      'if ($errors.Count) { $errors | ForEach-Object { $_.Message }; exit 1 }',
    ].join(' ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      env: windowsPowerShellEnv(),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test('installer uses a protected per-user config and token-free event-driven task', () => {
  const install = source('install');
  assert.match(install, /LOCALAPPDATA/);
  assert.match(install, /KindleLLMDashboard/);
  assert.match(install, /Read-Host\s+.*-AsSecureString/i);
  assert.match(install, /icacls\.exe/i);
  assert.match(install, /LASTEXITCODE/);
  assert.match(install, /Kindle LLM Quota Uploader/);
  assert.match(install, /PT12M/i);
  assert.match(install, /Triggers\.Create\(9\)/i);
  assert.match(install, /StartWhenAvailable\s*=\s*\$true/i);
  assert.match(install, /WakeToRun\s*=\s*\$false/i);
  assert.match(install, /MultipleInstances\s*=\s*2/i);
  assert.match(install, /NewTask\(0\)/i);
  assert.match(install, /schtasks\.exe\s+\/Create[^\r\n]+\/XML\s+\$taskXmlPath/i);
  assert.doesNotMatch(install, /schtasks\.exe\s+\/Create[^\r\n]+\/TR/i);

  assert.doesNotMatch(install, /DASHBOARD_INGEST_TOKEN/);
  assert.match(install, /catch\s*\{[\s\S]*Remove-Item\s+-LiteralPath\s+\$InstallRoot/i);
  assert.match(install, /schtasks\.exe\s+\/Delete\s+\/TN\s+\$TaskName/i);
  assert.match(install, /installBackup/);
  assert.match(install, /Move-Item\s+-LiteralPath\s+\$installBackup\s+-Destination\s+\$InstallRoot/i);
  assert.match(install, /quotaSnapshot\.mjs/);
  assert.match(install, /Copy-Item\s+-LiteralPath\s+\$contractSource\s+-Destination\s+\$contractDestination/i);
  for (const runtime of ['collectorLock.mjs', 'collectorSecret.mjs', 'runCollector.mjs', 'triggerUpload.mjs']) {
    assert.match(install, new RegExp(runtime.replace('.', '\\.')));
  }
});

test('installer backs up structured Claude settings and refuses foreign status lines', () => {
  const install = source('install');
  const backup = install.match(/Copy-Item\s+-LiteralPath\s+\$ClaudeSettingsPath[^\r\n]+/i);
  assert.ok(backup, 'settings backup must exist');
  const mutationAt = install.search(/Add-Member\s+-NotePropertyName\s+statusLine/i);
  assert.ok(mutationAt >= 0, 'statusLine mutation must exist');
  assert.ok(backup.index < mutationAt, 'settings must be backed up before mutation');
  assert.match(install, /ConvertFrom-Json/);
  assert.match(install, /ConvertTo-Json/);
  assert.match(install, /ReplaceExistingStatusLine/);
  assert.match(install, /foreign|another statusLine|refus/i);
  assert.match(install, /throw/i);
});

test('successful reinstall preserves the original Claude settings backup', () => {
  const install = source('install');
  assert.match(install, /\$previousManifest/);
  assert.match(install, /\$backupPath\s*=\s*\[string\]\$previousManifest\.backupPath/i);
  assert.match(install, /if\s*\(-not\s+\$previousManifest\s+-and\s+\$settingsExisted\)/i);
  assert.match(install, /backupPath\s*=\s*\$backupPath/i);
  assert.match(install, /\$settingsRollbackPath/);
  assert.match(install, /Copy-Item\s+-LiteralPath\s+\$settingsRollbackPath\s+-Destination\s+\$ClaudeSettingsPath/i);
  assert.match(install, /Protect-ProjectFile\s+-Path\s+\$backupPath/i);
  assert.match(install, /\$backupCreatedThisRun/i);
});

test('installer updates only a twice-validated manifest-owned GUID task', () => {
  const install = source('install');
  assert.match(install, /schemaVersion\s*=\s*\$ManifestSchemaVersion/i);
  assert.match(install, /owner\s*=\s*\$ManifestOwner/i);
  assert.match(install, /taskAction\s*=\s*\[ordered\]@\{/i);
  assert.match(install, /\$TaskNamePrefix\s*=\s*'Kindle LLM Quota Uploader-'/i);
  assert.match(install, /\[Guid\]::NewGuid\(\)\.ToString\('N'\)/i);
  assert.match(install, /task action changed; run uninstall before reinstalling/i);
  assert.match(install, /Assert-OwnedManifest\s+-Manifest\s+\$previousManifest/i);
  assert.match(install, /Get-ScheduledTaskAction\s+-Name\s+\$TaskName/i);
  assert.match(install, /Assert-TaskActionMatchesManifest/i);
  assert.match(install, /Refusing to replace a foreign scheduled task/i);

  const ownershipAt = install.indexOf('Assert-TaskActionMatchesManifest -TaskAction $existingTaskAction');
  const promptAt = install.indexOf("Read-Host 'Dashboard ingest token'");
  const recheckAt = install.indexOf('Assert-TaskActionMatchesManifest -TaskAction $currentTaskAction');
  const forcedCreateAt = install.search(/schtasks\.exe\s+\/Create[^\r\n]+\/F/i);
  assert.ok(ownershipAt >= 0 && ownershipAt < promptAt, 'task ownership must be checked before requesting the token');
  assert.ok(recheckAt > promptAt && recheckAt < forcedCreateAt, 'task ownership must be rechecked immediately before an update');
  assert.match(install, /if\s*\(\$taskExistedBefore\)[\s\S]*?schtasks\.exe\s+\/Create[^\r\n]+\/F/i);
  assert.match(install, /else\s*\{\s*&\s*schtasks\.exe\s+\/Create[^\r\n]+\/XML\s+\$taskXmlPath\s+2>/i);
  assert.match(install, /previousTaskXml[\s\S]*schtasks\.exe\s+\/Create[^\r\n]+\/F/i);
});

test('diagnostics expose booleans or versions without sensitive content', () => {
  const diagnose = source('diagnose');
  assert.match(diagnose, /ConvertTo-Json/);
  assert.match(diagnose, /nodeAvailable/);
  assert.match(diagnose, /claudeAuthenticated/);
  assert.match(diagnose, /taskPresent/);
  assert.match(diagnose, /taskLoginTrigger/);
  assert.match(diagnose, /taskTwelveMinuteCadence/);
  assert.match(diagnose, /taskStartWhenAvailable/);
  assert.match(diagnose, /taskWakeDisabled/);
  assert.match(diagnose, /taskOverlapDisabled/);
  assert.match(diagnose, /Get-Command\s+'claude'/);
  assert.match(diagnose, /Test-CommandAvailable\s+'codex'/);
  assert.doesNotMatch(diagnose, /Write-Output\s+.*(?:token|email|snapshot|percent|reset|configPath)/i);
  assert.doesNotMatch(diagnose, /Get-Content\s+.*config\.json/i);
});

test('diagnostics treats an omitted WakeToRun element as disabled', () => {
  const diagnosePath = psQuote(fileURLToPath(files.diagnose));
  const result = runPowerShellHarness((root) => `
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = ${psQuote(join(root, 'local'))}
$env:USERPROFILE = ${psQuote(join(root, 'profile'))}
$installRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboard'
$manifestPath = Join-Path $installRoot 'install-manifest.json'
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
[IO.File]::WriteAllText($manifestPath, ([ordered]@{
    schemaVersion = 2
    owner = 'kindle-llm-dash/windows-collector'
    taskName = 'Kindle LLM Quota Uploader-0123456789abcdef0123456789abcdef'
} | ConvertTo-Json))
$global:taskXml = '<?xml version="1.0"?><Task><Triggers><LogonTrigger/><TimeTrigger><Repetition><Interval>PT12M</Interval></Repetition></TimeTrigger></Triggers><Settings><StartWhenAvailable>true</StartWhenAvailable><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy></Settings></Task>'
function global:schtasks.exe { $global:LASTEXITCODE = 0; $global:taskXml }

& ${diagnosePath}
`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.observation?.taskPresent, true);
  assert.equal(result.observation?.taskWakeDisabled, true);
  assert.equal(result.observation?.taskOverlapDisabled, true);
});

test('uninstaller removes only owned resources and preserves user changes', () => {
  const uninstall = source('uninstall');
  assert.match(uninstall, /Kindle LLM Quota Uploader/);
  assert.match(uninstall, /\/Delete\s+\/TN/i);
  assert.match(uninstall, /statusLineCommand/);
  assert.match(uninstall, /OrdinalIgnoreCase\.Equals\(\$currentCommand,\s*\[string\]\$manifest\.statusLineCommand\)/i);
  assert.match(uninstall, /originalSettings/i);
  assert.match(uninstall, /Write-JsonAtomic\s+-Path\s+\$manifest\.claudeSettingsPath/i);
  assert.match(uninstall, /Test-Path/);
  assert.match(uninstall, /manifest is missing; refusing unsafe removal/i);
  assert.ok(uninstall.indexOf('manifest is missing; refusing unsafe removal') < uninstall.indexOf('schtasks.exe /Delete'), 'manifest validation must precede task deletion');
  assert.match(uninstall, /Unable to remove collector task/);
  assert.match(uninstall, /Remove-Item\s+-LiteralPath\s+\$installRoot/i);
  assert.doesNotMatch(uninstall, /Remove-Item\s+.*\.claude/i);
  assert.doesNotMatch(uninstall, /Remove-Item\s+.*backup/i);
});

test('uninstaller fails closed on manifest or task-action ownership mismatches', () => {
  const uninstall = source('uninstall');
  assert.match(uninstall, /\$ManifestSchemaVersion\s*=\s*2/i);
  assert.match(uninstall, /\$ManifestOwner\s*=\s*'kindle-llm-dash\/windows-collector'/i);
  assert.match(uninstall, /Assert-OwnedManifest\s+-Manifest\s+\$manifest/i);
  assert.match(uninstall, /installRoot/i);
  assert.match(uninstall, /taskAction/i);
  assert.match(uninstall, /Get-ScheduledTaskAction\s+-Name\s+\$TaskName/i);
  assert.match(uninstall, /Assert-TaskActionMatchesManifest/i);
  assert.match(uninstall, /refusing unsafe removal/i);

  const manifestValidationAt = uninstall.indexOf('Assert-OwnedManifest -Manifest $manifest');
  const actionValidationAt = uninstall.indexOf('Assert-TaskActionMatchesManifest');
  const deleteAt = uninstall.search(/schtasks\.exe\s+\/Delete/i);
  assert.ok(manifestValidationAt >= 0 && manifestValidationAt < deleteAt, 'strict manifest validation must precede task deletion');
  assert.ok(actionValidationAt >= 0 && actionValidationAt < deleteAt, 'task action validation must precede task deletion');
});

test('uninstaller ends an owned task before deleting it and tolerates only a stopped task', () => {
  const uninstall = source('uninstall');
  const endAt = uninstall.search(/schtasks\.exe\s+\/End\s+\/TN\s+\$TaskName/i);
  const deleteAt = uninstall.search(/schtasks\.exe\s+\/Delete\s+\/TN\s+\$TaskName/i);
  const actionChecks = [...uninstall.matchAll(/Get-ScheduledTaskAction\s+-Name\s+\$TaskName/ig)].map((match) => match.index);
  assert.ok(endAt >= 0, 'owned task must be ended during uninstall');
  assert.ok(endAt < deleteAt, 'task must be ended before it is deleted');
  assert.ok(actionChecks.length >= 2, 'task action must be checked again before deletion');
  assert.ok(actionChecks.at(-1) > endAt && actionChecks.at(-1) < deleteAt, 'second action check must be after /End and before /Delete');
  assert.match(uninstall, /Test-ScheduledTaskRunning\s+-Name\s+\$TaskName/i);
  assert.match(uninstall, /Unable to stop collector task/i);
});

test('installer tolerates native task-query stderr when a new task is absent', () => {
  const installPath = psQuote(fileURLToPath(files.install));
  const result = runPowerShellHarness((root) => `
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = ${psQuote(join(root, 'local'))}
$env:USERPROFILE = ${psQuote(join(root, 'profile'))}
$installRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboard'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$global:taskCalls = @()
$global:createdExecutable = $null
$global:createdArguments = $null
function global:schtasks.exe {
    $global:taskCalls += ($args -join ' ')
    if ($args -contains '/Query') {
        $global:LASTEXITCODE = 1
        Write-Error 'ERROR: The system cannot find the file specified.'
        return
    }
    if ($args -contains '/Create') {
        $xmlIndex = [Array]::IndexOf($args, '/XML')
        if ($xmlIndex -lt 0 -or $xmlIndex + 1 -ge $args.Count) {
            $global:LASTEXITCODE = 1
            return
        }
        [xml]$taskXml = [IO.File]::ReadAllText([string]$args[$xmlIndex + 1])
        $global:createdTaskXml = $taskXml.OuterXml
        $global:createdExecutable = [string]$taskXml.Task.Actions.Exec.Command
        $global:createdArguments = [string]$taskXml.Task.Actions.Exec.Arguments
    }
    $global:LASTEXITCODE = 0
}
function global:icacls.exe { $global:LASTEXITCODE = 0 }
function global:Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    return ConvertTo-SecureString 'fixture-token-value' -AsPlainText -Force
}

& ${installPath} -IngestUrl 'https://example.test/api/usage' | Out-Null
[pscustomobject]@{
    installRootExists = Test-Path -LiteralPath $installRoot
    createdTask = [bool]($global:taskCalls | Where-Object { $_ -match '/Create' })
    executableMatches = [StringComparer]::OrdinalIgnoreCase.Equals($global:createdExecutable, $nodePath)
    argumentsContainUpload = $global:createdArguments -match 'upload\.mjs'
    argumentsContainConfig = $global:createdArguments -match 'config\.json'
    hasLoginTrigger = $global:createdTaskXml -match '<LogonTrigger>'
    hasTwelveMinuteCadence = $global:createdTaskXml -match '<Interval>PT12M</Interval>'
    startsWhenAvailable = $global:createdTaskXml -match '<StartWhenAvailable>true</StartWhenAvailable>'
    wakesComputer = $global:createdTaskXml -match '<WakeToRun>true</WakeToRun>'
    ignoresOverlap = $global:createdTaskXml -match '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'
} | ConvertTo-Json -Compress
`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.observation?.installRootExists, true);
  assert.equal(result.observation?.createdTask, true);
  assert.equal(result.observation?.executableMatches, true);
  assert.equal(result.observation?.argumentsContainUpload, true);
  assert.equal(result.observation?.argumentsContainConfig, true);
  assert.equal(result.observation?.hasLoginTrigger, true);
  assert.equal(result.observation?.hasTwelveMinuteCadence, true);
  assert.equal(result.observation?.startsWhenAvailable, true);
  assert.equal(result.observation?.wakesComputer, false);
  assert.equal(result.observation?.ignoresOverlap, true);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-token-value/);
});

test('uninstaller tolerates native task-query stderr after an owned task is already absent', () => {
  const uninstallPath = psQuote(fileURLToPath(files.uninstall));
  const result = runPowerShellHarness((root) => `
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = ${psQuote(join(root, 'local'))}
$env:USERPROFILE = ${psQuote(join(root, 'profile'))}
$installRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboard'
$collectorRoot = Join-Path $installRoot 'collector'
$settingsPath = Join-Path (Join-Path $env:USERPROFILE '.claude') 'settings.json'
$manifestPath = Join-Path $installRoot 'install-manifest.json'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$statusLineCommand = '"{0}" "{1}"' -f $nodePath, (Join-Path $collectorRoot 'claude-statusline.mjs')
$taskArguments = '"{0}" "{1}"' -f (Join-Path $collectorRoot 'upload.mjs'), (Join-Path $installRoot 'config.json')
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settingsPath) | Out-Null
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
[IO.File]::WriteAllText($settingsPath, ([ordered]@{
    theme = 'dark'
    statusLine = [ordered]@{ type = 'command'; command = $statusLineCommand; padding = 0 }
} | ConvertTo-Json -Depth 20))
[IO.File]::WriteAllText($manifestPath, ([ordered]@{
    schemaVersion = 2
    owner = 'kindle-llm-dash/windows-collector'
    taskName = 'Kindle LLM Quota Uploader-89abcdef0123456789abcdef01234567'
    installRoot = $installRoot
    claudeSettingsPath = $settingsPath
    backupPath = $null
    statusLineCommand = $statusLineCommand
    taskAction = [ordered]@{ executable = $nodePath; arguments = $taskArguments }
} | ConvertTo-Json -Depth 20))
function global:schtasks.exe {
    $global:LASTEXITCODE = 1
    Write-Error 'ERROR: The system cannot find the file specified.'
}

& ${uninstallPath} | Out-Null
$settings = [IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json
[pscustomobject]@{
    installRootExists = Test-Path -LiteralPath $installRoot
    statusLinePresent = [bool]$settings.PSObject.Properties['statusLine']
} | ConvertTo-Json -Compress
`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.observation?.installRootExists, false);
  assert.equal(result.observation?.statusLinePresent, false);
});

test('reinstall keeps the first backup and uninstall restores it', () => {
  const installPath = psQuote(fileURLToPath(files.install));
  const uninstallPath = psQuote(fileURLToPath(files.uninstall));
  const result = runPowerShellHarness((root) => `
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = ${psQuote(join(root, 'local'))}
$env:USERPROFILE = ${psQuote(join(root, 'profile'))}
$installRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboard'
$collectorRoot = Join-Path $installRoot 'collector'
$settingsPath = Join-Path (Join-Path $env:USERPROFILE '.claude') 'settings.json'
$manifestPath = Join-Path $installRoot 'install-manifest.json'
$backupPath = "$settingsPath.kindlelmldashboard.original.bak"
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$statusScript = Join-Path $collectorRoot 'claude-statusline.mjs'
$uploadScript = Join-Path $collectorRoot 'upload.mjs'
$configPath = Join-Path $installRoot 'config.json'
$statusLineCommand = '"{0}" "{1}"' -f $nodePath, $statusScript
$taskArguments = '"{0}" "{1}"' -f $uploadScript, $configPath

function Write-FixtureJson {
    param([string]$Path, [object]$Value)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
}

$initialSettings = [ordered]@{ theme = 'dark'; telemetry = $false }
$currentSettings = [ordered]@{
    theme = 'dark'
    telemetry = $false
    statusLine = [ordered]@{ type = 'command'; command = $statusLineCommand; padding = 0 }
}
$manifest = [ordered]@{
    schemaVersion = 2
    owner = 'kindle-llm-dash/windows-collector'
    taskName = 'Kindle LLM Quota Uploader-0123456789abcdef0123456789abcdef'
    installRoot = $installRoot
    claudeSettingsPath = $settingsPath
    backupPath = $backupPath
    statusLineCommand = $statusLineCommand
    taskAction = [ordered]@{ executable = $nodePath; arguments = $taskArguments }
}
Write-FixtureJson -Path $backupPath -Value $initialSettings
Write-FixtureJson -Path $settingsPath -Value $currentSettings
Write-FixtureJson -Path $manifestPath -Value $manifest
New-Item -ItemType Directory -Force -Path $collectorRoot | Out-Null
[IO.File]::WriteAllText((Join-Path $collectorRoot 'old-install.txt'), 'owned')
$oldStateRoot = Join-Path $installRoot 'state'
New-Item -ItemType Directory -Force -Path $oldStateRoot | Out-Null
[IO.File]::WriteAllText((Join-Path $oldStateRoot 'claude.json'), '{"collectedAt":"2026-07-12T08:00:00.000Z","windows":{}}')

$xmlCommand = [Security.SecurityElement]::Escape($nodePath)
$xmlArguments = [Security.SecurityElement]::Escape($taskArguments)
$global:taskXml = '<?xml version="1.0" encoding="UTF-16"?><Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Actions><Exec><Command>{0}</Command><Arguments>{1}</Arguments></Exec></Actions></Task>' -f $xmlCommand, $xmlArguments
$global:taskCalls = @()
function global:schtasks.exe {
    $global:taskCalls += ($args -join ' ')
    if ($args -contains '/Query') { $global:LASTEXITCODE = 0; $global:taskXml; return }
    $global:LASTEXITCODE = 0
}
function global:icacls.exe { $global:LASTEXITCODE = 0 }
function global:Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    return ConvertTo-SecureString 'fixture-token-value' -AsPlainText -Force
}

& ${installPath} -IngestUrl 'https://example.test/api/usage' | Out-Null
$reinstalledManifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
$retainedBackupPath = [string]$reinstalledManifest.backupPath
$statePreservedAfterReinstall = Test-Path -LiteralPath (Join-Path (Join-Path $installRoot 'state') 'claude.json') -PathType Leaf
$settingsAfterInstall = [IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json
$settingsAfterInstall.theme = 'light'
$settingsAfterInstall | Add-Member -NotePropertyName fontScale -NotePropertyValue 1.25
Write-FixtureJson -Path $settingsPath -Value $settingsAfterInstall
& ${uninstallPath} | Out-Null
$restoredSettings = [IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json

[pscustomobject]@{
    retainedOriginalBackup = [StringComparer]::OrdinalIgnoreCase.Equals($retainedBackupPath, $backupPath)
    statePreservedAfterReinstall = $statePreservedAfterReinstall
    backupStillExists = Test-Path -LiteralPath $backupPath -PathType Leaf
    restoredTheme = [string]$restoredSettings.theme
    restoredTelemetry = [bool]$restoredSettings.telemetry
    restoredFontScale = [double]$restoredSettings.fontScale
    restoredHasStatusLine = [bool]$restoredSettings.PSObject.Properties['statusLine']
    installRootExists = Test-Path -LiteralPath $installRoot
    taskCalls = @($global:taskCalls)
} | ConvertTo-Json -Compress
`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.observation, result.stdout);
  assert.equal(result.observation.retainedOriginalBackup, true);
  assert.equal(result.observation.statePreservedAfterReinstall, true);
  assert.equal(result.observation.backupStillExists, true);
  assert.equal(result.observation.restoredTheme, 'light');
  assert.equal(result.observation.restoredTelemetry, false);
  assert.equal(result.observation.restoredFontScale, 1.25);
  assert.equal(result.observation.restoredHasStatusLine, false);
  assert.equal(result.observation.installRootExists, false);
  const endAt = result.observation.taskCalls.findIndex((call) => call.includes('/End'));
  const deleteAt = result.observation.taskCalls.findIndex((call) => call.includes('/Delete'));
  assert.ok(endAt >= 0 && endAt < deleteAt, 'behavioral uninstall must end the task before deletion');
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-token-value/);
});

test('installer rejects a foreign fixed-name task before prompting or creating', () => {
  const installPath = psQuote(fileURLToPath(files.install));
  const result = runPowerShellHarness((root) => `
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = ${psQuote(join(root, 'local'))}
$env:USERPROFILE = ${psQuote(join(root, 'profile'))}
$global:taskCalls = @()
$global:prompted = $false
$global:taskXml = '<?xml version="1.0" encoding="UTF-16"?><Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Actions><Exec><Command>C:\\Windows\\System32\\cmd.exe</Command><Arguments>/c exit 0</Arguments></Exec></Actions></Task>'
function global:schtasks.exe {
    $global:taskCalls += ($args -join ' ')
    $global:LASTEXITCODE = 0
    $global:taskXml
}
function global:Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    $global:prompted = $true
    return ConvertTo-SecureString 'fixture-token-value' -AsPlainText -Force
}

$failure = $null
try { & ${installPath} -IngestUrl 'https://example.test/api/usage' | Out-Null }
catch { $failure = $_.Exception.Message }
[pscustomobject]@{
    failure = $failure
    prompted = $global:prompted
    taskCalls = @($global:taskCalls)
} | ConvertTo-Json -Compress
`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.observation?.failure, 'Refusing to replace a foreign scheduled task');
  assert.equal(result.observation?.prompted, false);
  assert.equal(result.observation?.taskCalls.some((call) => call.includes('/Create')), false);
});

test('installer rolls back only its matching GUID task when create reports failure', () => {
  const installPath = psQuote(fileURLToPath(files.install));
  const result = runPowerShellHarness((root) => `
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = ${psQuote(join(root, 'local'))}
$env:USERPROFILE = ${psQuote(join(root, 'profile'))}
$installRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboard'
$manifestPath = Join-Path $installRoot 'install-manifest.json'
$global:taskCalls = @()
$global:taskExists = $false
$global:taskXml = $null
function global:schtasks.exe {
    $global:taskCalls += ($args -join ' ')
    if ($args -contains '/Query') {
        if ($global:taskExists) {
            $global:LASTEXITCODE = 0
            $global:taskXml
        }
        else {
            $global:LASTEXITCODE = 1
        }
        return
    }
    if ($args -contains '/Create') {
        $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
        $xmlCommand = [Security.SecurityElement]::Escape([string]$manifest.taskAction.executable)
        $xmlArguments = [Security.SecurityElement]::Escape([string]$manifest.taskAction.arguments)
        $global:taskXml = '<?xml version="1.0" encoding="UTF-16"?><Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Actions><Exec><Command>{0}</Command><Arguments>{1}</Arguments></Exec></Actions></Task>' -f $xmlCommand, $xmlArguments
        $global:taskExists = $true
        $global:LASTEXITCODE = 1
        return
    }
    if ($args -contains '/Delete') { $global:taskExists = $false }
    $global:LASTEXITCODE = 0
}
function global:icacls.exe { $global:LASTEXITCODE = 0 }
function global:Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    return ConvertTo-SecureString 'fixture-token-value' -AsPlainText -Force
}

$failure = $null
try { & ${installPath} -IngestUrl 'https://example.test/api/usage' | Out-Null }
catch { $failure = $_.Exception.Message }
[pscustomobject]@{
    failure = $failure
    taskExists = $global:taskExists
    installRootExists = Test-Path -LiteralPath $installRoot
    taskCalls = @($global:taskCalls)
} | ConvertTo-Json -Compress
`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.observation?.failure, 'Unable to register collector task');
  assert.equal(result.observation?.taskExists, false);
  assert.equal(result.observation?.installRootExists, false);
  const calls = result.observation?.taskCalls || [];
  const createAt = calls.findIndex((call) => call.includes('/Create'));
  const queryAfterCreateAt = calls.findIndex((call, index) => index > createAt && call.includes('/Query'));
  const endAt = calls.findIndex((call) => call.includes('/End'));
  const deleteAt = calls.findIndex((call) => call.includes('/Delete'));
  assert.ok(createAt >= 0 && queryAfterCreateAt > createAt);
  assert.ok(queryAfterCreateAt < endAt && endAt < deleteAt);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-token-value/);
});

test('uninstaller leaves resources intact when the task action is foreign', () => {
  const uninstallPath = psQuote(fileURLToPath(files.uninstall));
  const result = runPowerShellHarness((root) => `
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = ${psQuote(join(root, 'local'))}
$env:USERPROFILE = ${psQuote(join(root, 'profile'))}
$installRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboard'
$collectorRoot = Join-Path $installRoot 'collector'
$settingsPath = Join-Path (Join-Path $env:USERPROFILE '.claude') 'settings.json'
$manifestPath = Join-Path $installRoot 'install-manifest.json'
$backupPath = "$settingsPath.kindlelmldashboard.original.bak"
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$statusLineCommand = '"{0}" "{1}"' -f $nodePath, (Join-Path $collectorRoot 'claude-statusline.mjs')
$taskArguments = '"{0}" "{1}"' -f (Join-Path $collectorRoot 'upload.mjs'), (Join-Path $installRoot 'config.json')
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settingsPath) | Out-Null
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
[IO.File]::WriteAllText($settingsPath, '{"theme":"dark"}')
[IO.File]::WriteAllText($backupPath, '{"theme":"dark"}')
$manifest = [ordered]@{
    schemaVersion = 2
    owner = 'kindle-llm-dash/windows-collector'
    taskName = 'Kindle LLM Quota Uploader-fedcba9876543210fedcba9876543210'
    installRoot = $installRoot
    claudeSettingsPath = $settingsPath
    backupPath = $backupPath
    statusLineCommand = $statusLineCommand
    taskAction = [ordered]@{ executable = $nodePath; arguments = $taskArguments }
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20))

$global:taskCalls = @()
$global:taskXml = '<?xml version="1.0" encoding="UTF-16"?><Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Actions><Exec><Command>C:\\Windows\\System32\\cmd.exe</Command><Arguments>/c exit 0</Arguments></Exec></Actions></Task>'
function global:schtasks.exe {
    $global:taskCalls += ($args -join ' ')
    $global:LASTEXITCODE = 0
    $global:taskXml
}

$failure = $null
try { & ${uninstallPath} | Out-Null }
catch { $failure = $_.Exception.Message }
[pscustomobject]@{
    failure = $failure
    installRootExists = Test-Path -LiteralPath $installRoot
    taskCalls = @($global:taskCalls)
} | ConvertTo-Json -Compress
`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.observation?.failure || '', /task ownership is invalid; refusing unsafe removal/i);
  assert.equal(result.observation?.installRootExists, true);
  assert.equal(result.observation?.taskCalls.some((call) => call.includes('/End') || call.includes('/Delete')), false);
});

test('uninstaller is an idempotent no-op when no project resources exist', () => {
  const uninstallPath = psQuote(fileURLToPath(files.uninstall));
  const result = runPowerShellHarness((root) => `
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = ${psQuote(join(root, 'local'))}
$env:USERPROFILE = ${psQuote(join(root, 'profile'))}
$global:taskCalls = @()
function global:schtasks.exe {
    $global:taskCalls += ($args -join ' ')
    $global:LASTEXITCODE = 1
}

$failure = $null
try { & ${uninstallPath} | Out-Null }
catch { $failure = $_.Exception.Message }
[pscustomobject]@{
    failure = $failure
    taskCalls = @($global:taskCalls)
} | ConvertTo-Json -Compress
`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.observation?.failure, null);
  assert.equal(result.observation?.taskCalls.some((call) => call.includes('/Delete')), false);
});
}
