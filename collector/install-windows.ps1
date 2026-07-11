[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$IngestUrl,
    [string]$CodexCommand = 'codex',
    [switch]$ReplaceExistingStatusLine
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$ManifestSchemaVersion = 2
$ManifestOwner = 'kindle-llm-dash/windows-collector'
$TaskNamePrefix = 'Kindle LLM Quota Uploader-'
$TaskName = $null
$InstallRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboard'
$CollectorRoot = Join-Path $InstallRoot 'collector'
$ConfigPath = Join-Path $InstallRoot 'config.json'
$ManifestPath = Join-Path $InstallRoot 'install-manifest.json'
$ClaudeSettingsPath = Join-Path (Join-Path $env:USERPROFILE '.claude') 'settings.json'

function Write-JsonAtomic {
    param([string]$Path, [object]$Value)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = "$Path.tmp.$([Guid]::NewGuid().ToString('N'))"
    try {
        $json = $Value | ConvertTo-Json -Depth 20
        [IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Protect-ProjectFile {
    param([string]$Path)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $Path '/inheritance:r' '/grant:r' "${identity}:(R,W)" 'SYSTEM:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to protect collector configuration' }
}

function Test-PathEqual {
    param([string]$Left, [string]$Right)
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    try {
        return [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($Left), [IO.Path]::GetFullPath($Right))
    }
    catch {
        return $false
    }
}

function Assert-ExactProperties {
    param([object]$Value, [string[]]$Names)
    if (-not ($Value -is [pscustomobject])) { throw 'Invalid object shape' }
    $actualNames = @($Value.PSObject.Properties | ForEach-Object { $_.Name })
    if ($actualNames.Count -ne $Names.Count) { throw 'Invalid object shape' }
    foreach ($name in $Names) {
        if ($actualNames -notcontains $name) { throw 'Invalid object shape' }
    }
}

function Assert-OwnedManifest {
    param([object]$Manifest, [string]$FailureMessage)
    try {
        Assert-ExactProperties -Value $Manifest -Names @(
            'schemaVersion',
            'owner',
            'taskName',
            'installRoot',
            'claudeSettingsPath',
            'backupPath',
            'statusLineCommand',
            'taskAction'
        )
        if (-not ($Manifest.schemaVersion -is [int]) -or $Manifest.schemaVersion -ne $ManifestSchemaVersion) { throw 'Invalid schema version' }
        if (-not ($Manifest.owner -is [string]) -or $Manifest.owner -cne $ManifestOwner) { throw 'Invalid owner' }
        $taskNamePattern = '^' + [regex]::Escape($TaskNamePrefix) + '[0-9a-f]{32}$'
        if (-not ($Manifest.taskName -is [string]) -or $Manifest.taskName -cnotmatch $taskNamePattern) { throw 'Invalid task name' }
        if (-not ($Manifest.installRoot -is [string]) -or -not (Test-PathEqual -Left $Manifest.installRoot -Right $InstallRoot)) { throw 'Invalid install root' }
        if (-not ($Manifest.claudeSettingsPath -is [string]) -or -not (Test-PathEqual -Left $Manifest.claudeSettingsPath -Right $ClaudeSettingsPath)) { throw 'Invalid Claude settings path' }

        if ($null -ne $Manifest.backupPath) {
            if (-not ($Manifest.backupPath -is [string]) -or [string]::IsNullOrWhiteSpace($Manifest.backupPath)) { throw 'Invalid backup path' }
            $fullBackupPath = [IO.Path]::GetFullPath($Manifest.backupPath)
            $backupPrefix = [IO.Path]::GetFullPath($ClaudeSettingsPath) + '.kindlelmldashboard.'
            if (-not $fullBackupPath.StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not $fullBackupPath.EndsWith('.bak', [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Invalid backup path'
            }
            if (-not (Test-Path -LiteralPath $fullBackupPath -PathType Leaf)) { throw 'Original Claude settings backup is missing' }
        }

        Assert-ExactProperties -Value $Manifest.taskAction -Names @('executable', 'arguments')
        if (-not ($Manifest.taskAction.executable -is [string]) -or -not [IO.Path]::IsPathRooted($Manifest.taskAction.executable)) { throw 'Invalid task executable' }
        if ([IO.Path]::GetFileName($Manifest.taskAction.executable) -ine 'node.exe') { throw 'Invalid task executable' }
        if (-not ($Manifest.taskAction.arguments -is [string])) { throw 'Invalid task arguments' }
        $expectedTaskArguments = '"{0}" "{1}"' -f (Join-Path $CollectorRoot 'upload.mjs'), $ConfigPath
        if (-not [StringComparer]::OrdinalIgnoreCase.Equals($Manifest.taskAction.arguments, $expectedTaskArguments)) { throw 'Invalid task arguments' }
        $expectedStatusLineCommand = '"{0}" "{1}"' -f $Manifest.taskAction.executable, (Join-Path $CollectorRoot 'claude-statusline.mjs')
        if (-not ($Manifest.statusLineCommand -is [string]) -or -not [StringComparer]::OrdinalIgnoreCase.Equals($Manifest.statusLineCommand, $expectedStatusLineCommand)) {
            throw 'Invalid status line command'
        }
    }
    catch {
        throw $FailureMessage
    }
}

function Get-InnermostHResult {
    param([Exception]$Exception)
    $current = $Exception
    while ($current.InnerException) { $current = $current.InnerException }
    return $current.HResult
}

function Test-ScheduledTaskExists {
    param([string]$Name)
    $service = $null
    $folder = $null
    $registeredTask = $null
    try {
        try {
            $service = New-Object -ComObject 'Schedule.Service'
            $service.Connect()
            $folder = $service.GetFolder('\')
        }
        catch {
            throw 'Unable to inspect scheduled task ownership'
        }
        try {
            $registeredTask = $folder.GetTask($Name)
            return $true
        }
        catch {
            if ((Get-InnermostHResult -Exception $_.Exception) -eq -2147024894) { return $false }
            throw 'Unable to inspect scheduled task ownership'
        }
    }
    finally {
        if ($registeredTask) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($registeredTask) }
        if ($folder) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($folder) }
        if ($service) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($service) }
    }
}

function Get-ScheduledTaskAction {
    param([string]$Name, [switch]$RequireReliableAbsence)
    $taskXmlText = (& schtasks.exe /Query /TN $Name /XML 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) {
        if ($RequireReliableAbsence -and (Test-ScheduledTaskExists -Name $Name)) { throw 'Unable to inspect scheduled task action' }
        return $null
    }
    try {
        [xml]$taskXml = $taskXmlText
        $execActions = @($taskXml.Task.Actions.Exec)
        if ($execActions.Count -ne 1) { throw 'Unexpected task action count' }
        $executable = [string]$execActions[0].Command
        $arguments = [string]$execActions[0].Arguments
        if ([string]::IsNullOrWhiteSpace($executable)) { throw 'Missing task executable' }
        return [pscustomobject]@{
            executable = $executable.Trim()
            arguments = $arguments.Trim()
            xml = $taskXmlText
        }
    }
    catch {
        throw 'Unable to inspect scheduled task action'
    }
}

function Assert-TaskActionMatchesManifest {
    param([object]$TaskAction, [object]$Manifest, [string]$FailureMessage)
    if ($null -eq $TaskAction -or $null -eq $Manifest) { throw $FailureMessage }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$TaskAction.executable, [string]$Manifest.taskAction.executable)) { throw $FailureMessage }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$TaskAction.arguments, [string]$Manifest.taskAction.arguments)) { throw $FailureMessage }
}

function Test-TaskActionMatches {
    param([object]$TaskAction, [object]$ExpectedAction)
    if ($null -eq $TaskAction -or $null -eq $ExpectedAction) { return $false }
    return [StringComparer]::OrdinalIgnoreCase.Equals([string]$TaskAction.executable, [string]$ExpectedAction.executable) -and
        [StringComparer]::OrdinalIgnoreCase.Equals([string]$TaskAction.arguments, [string]$ExpectedAction.arguments)
}

$uri = $null
if (-not [Uri]::TryCreate($IngestUrl, [UriKind]::Absolute, [ref]$uri)) { throw 'Ingest URL is invalid' }
if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and [Net.IPAddress]::IsLoopback(([Net.Dns]::GetHostAddresses($uri.DnsSafeHost)[0])))) {
    throw 'Ingest URL must use HTTPS'
}

$node = Get-Command node.exe -ErrorAction Stop
$nodePath = $node.Source
$installedStatusScript = Join-Path $CollectorRoot 'claude-statusline.mjs'
$installedUploadScript = Join-Path $CollectorRoot 'upload.mjs'
$statusLineCommand = '"{0}" "{1}"' -f $nodePath, $installedStatusScript
$taskArguments = '"{0}" "{1}"' -f $installedUploadScript, $ConfigPath
$newTaskAction = [pscustomobject]@{ executable = $nodePath; arguments = $taskArguments }

$previousManifest = $null
if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
    try { $previousManifest = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json }
    catch { throw 'Installation manifest is invalid; refusing unsafe replacement' }
    Assert-OwnedManifest -Manifest $previousManifest -FailureMessage 'Installation manifest is invalid; refusing unsafe replacement'
}
elseif (Test-Path -LiteralPath $InstallRoot) {
    throw 'Installation manifest is missing; refusing unsafe replacement'
}

$TaskName = if ($previousManifest) {
    [string]$previousManifest.taskName
}
else {
    $TaskNamePrefix + [Guid]::NewGuid().ToString('N')
}

$existingTaskAction = Get-ScheduledTaskAction -Name $TaskName -RequireReliableAbsence:($null -ne $previousManifest)
$taskExistedBefore = ($null -ne $existingTaskAction)
if ($previousManifest) {
    if (-not $taskExistedBefore) { throw 'Owned scheduled task is missing; run uninstall before reinstalling' }
    Assert-TaskActionMatchesManifest -TaskAction $existingTaskAction -Manifest $previousManifest -FailureMessage 'Refusing to replace a foreign scheduled task'
    if (-not (Test-TaskActionMatches -TaskAction $newTaskAction -ExpectedAction $previousManifest.taskAction)) {
        throw 'Owned scheduled task action changed; run uninstall before reinstalling'
    }
}
elseif ($taskExistedBefore) {
    throw 'Refusing to replace a foreign scheduled task'
}

$settings = [pscustomobject]@{}
$settingsExisted = Test-Path -LiteralPath $ClaudeSettingsPath
if ($settingsExisted) {
    $rawSettings = [IO.File]::ReadAllText($ClaudeSettingsPath)
    if ($rawSettings.Trim()) { $settings = $rawSettings | ConvertFrom-Json }
}

$existingCommand = $null
if ($settings.PSObject.Properties['statusLine'] -and $settings.statusLine -and $settings.statusLine.PSObject.Properties['command']) {
    $existingCommand = [string]$settings.statusLine.command
}
$previousStatusLineOwned = ($previousManifest -and $existingCommand -and [StringComparer]::OrdinalIgnoreCase.Equals($existingCommand, [string]$previousManifest.statusLineCommand))
if ($existingCommand -and -not [StringComparer]::OrdinalIgnoreCase.Equals($existingCommand, $statusLineCommand) -and -not $previousStatusLineOwned -and -not $ReplaceExistingStatusLine) {
    throw 'Refusing to replace a foreign or another statusLine without -ReplaceExistingStatusLine'
}

$backupPath = $null
if ($previousManifest -and $null -ne $previousManifest.backupPath) {
    $backupPath = [string]$previousManifest.backupPath
}
if (-not $previousManifest -and $settingsExisted) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupPath = "$ClaudeSettingsPath.kindlelmldashboard.$stamp.bak"
}

$secureToken = $null
$bstr = [IntPtr]::Zero
$plainToken = $null
$settingsMutationStarted = $false
$settingsRollbackPath = $null
$installBackup = $null
$newInstallStarted = $false
$taskRegistrationAttempted = $false
$taskRollbackFailed = $false
$backupCreatedThisRun = $false
try {
    if (-not $previousManifest -and $settingsExisted) {
        Copy-Item -LiteralPath $ClaudeSettingsPath -Destination $backupPath
        $backupCreatedThisRun = $true
    }
    if ($backupPath) {
        Protect-ProjectFile -Path $backupPath
    }
    if ($settingsExisted) {
        $settingsRollbackPath = "$ClaudeSettingsPath.kindlelmldashboard.rollback.$([Guid]::NewGuid().ToString('N')).tmp"
        Copy-Item -LiteralPath $ClaudeSettingsPath -Destination $settingsRollbackPath
    }

    $secureToken = Read-Host 'Dashboard ingest token' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrWhiteSpace($plainToken)) { throw 'Dashboard ingest token is required' }

    if (Test-Path -LiteralPath $InstallRoot) {
        $installBackup = "$InstallRoot.rollback.$([Guid]::NewGuid().ToString('N'))"
        Move-Item -LiteralPath $InstallRoot -Destination $installBackup
    }
    $newInstallStarted = $true
    New-Item -ItemType Directory -Force -Path $CollectorRoot | Out-Null
    Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $CollectorRoot -Recurse -Force
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $contractSource = Join-Path $projectRoot 'app\api\dashboard\quotaSnapshot.mjs'
    $contractDestination = Join-Path $InstallRoot 'app\api\dashboard\quotaSnapshot.mjs'
    if (-not (Test-Path -LiteralPath $contractSource)) { throw 'Quota contract module is missing' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $contractDestination) | Out-Null
    Copy-Item -LiteralPath $contractSource -Destination $contractDestination -Force

    $config = [ordered]@{
        ingestUrl = $uri.AbsoluteUri
        ingestToken = $plainToken
        codexCommand = $CodexCommand
        timeoutMs = 30000
        timeZone = 'Asia/Taipei'
    }
    Write-JsonAtomic -Path $ConfigPath -Value $config
    Protect-ProjectFile -Path $ConfigPath

    $manifest = [ordered]@{
        schemaVersion = $ManifestSchemaVersion
        owner = $ManifestOwner
        taskName = $TaskName
        installRoot = $InstallRoot
        claudeSettingsPath = $ClaudeSettingsPath
        backupPath = $backupPath
        statusLineCommand = $statusLineCommand
        taskAction = [ordered]@{
            executable = $nodePath
            arguments = $taskArguments
        }
    }
    Write-JsonAtomic -Path $ManifestPath -Value $manifest
    Protect-ProjectFile -Path $ManifestPath

    $statusLine = [pscustomobject]@{ type = 'command'; command = $statusLineCommand; padding = 0 }
    if ($settings.PSObject.Properties['statusLine']) { $settings.statusLine = $statusLine }
    else { $settings | Add-Member -NotePropertyName statusLine -NotePropertyValue $statusLine }
    $settingsMutationStarted = $true
    Write-JsonAtomic -Path $ClaudeSettingsPath -Value $settings

    $taskCommand = '"{0}" {1}' -f $nodePath, $taskArguments
    if (-not $taskExistedBefore) {
        $taskRegistrationAttempted = $true
        & schtasks.exe /Create /SC MINUTE /MO 5 /TN $TaskName /TR $taskCommand | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unable to register collector task' }
    }

    if ($installBackup -and (Test-Path -LiteralPath $installBackup)) {
        Remove-Item -LiteralPath $installBackup -Recurse -Force
        $installBackup = $null
    }
}
catch {
    if (-not $taskExistedBefore -and $taskRegistrationAttempted) {
        try {
            $createdTaskAction = Get-ScheduledTaskAction -Name $TaskName -RequireReliableAbsence
            if ($createdTaskAction) {
                if (Test-TaskActionMatches -TaskAction $createdTaskAction -ExpectedAction $newTaskAction) {
                    & schtasks.exe /End /TN $TaskName 2>$null | Out-Null
                    & schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
                    if ($LASTEXITCODE -ne 0) { $taskRollbackFailed = $true }
                }
                else {
                    $taskRollbackFailed = $true
                }
            }
        }
        catch {
            $taskRollbackFailed = $true
        }
    }

    if ($settingsMutationStarted) {
        if ($settingsExisted -and $settingsRollbackPath -and (Test-Path -LiteralPath $settingsRollbackPath)) {
            Copy-Item -LiteralPath $settingsRollbackPath -Destination $ClaudeSettingsPath -Force
        }
        elseif (-not $settingsExisted -and (Test-Path -LiteralPath $ClaudeSettingsPath)) {
            try {
                $rollbackSettings = [IO.File]::ReadAllText($ClaudeSettingsPath) | ConvertFrom-Json
                $rollbackSettings.PSObject.Properties.Remove('statusLine')
                Write-JsonAtomic -Path $ClaudeSettingsPath -Value $rollbackSettings
            }
            catch {}
        }
    }

    if ($newInstallStarted -and (Test-Path -LiteralPath $InstallRoot)) {
        Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    }
    if ($installBackup -and (Test-Path -LiteralPath $installBackup)) {
        Move-Item -LiteralPath $installBackup -Destination $InstallRoot
    }
    if ($backupCreatedThisRun -and (Test-Path -LiteralPath $backupPath)) {
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    }
    if ($taskRollbackFailed) { throw 'Installation failed and scheduled task rollback failed' }
    throw
}
finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $plainToken = $null
    $secureToken = $null
    if ($settingsRollbackPath -and (Test-Path -LiteralPath $settingsRollbackPath)) { Remove-Item -LiteralPath $settingsRollbackPath -Force -ErrorAction SilentlyContinue }
}

[pscustomobject]@{ installed = $true; taskName = $TaskName } | ConvertTo-Json -Compress
