[CmdletBinding()]
param()

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
    param([object]$Manifest)
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
        throw 'Installation manifest is invalid; refusing unsafe removal'
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
            throw 'Unable to inspect scheduled task ownership; refusing unsafe removal'
        }
        try {
            $registeredTask = $folder.GetTask($Name)
            return $true
        }
        catch {
            if ((Get-InnermostHResult -Exception $_.Exception) -eq -2147024894) { return $false }
            throw 'Unable to inspect scheduled task ownership; refusing unsafe removal'
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
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $taskXmlText = (& schtasks.exe /Query /TN $Name /XML 2>$null | Out-String)
        $taskQueryExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($taskQueryExitCode -ne 0) {
        if (-not $RequireReliableAbsence) { return $null }
        if (Test-ScheduledTaskExists -Name $Name) { throw 'Unable to inspect scheduled task action; refusing unsafe removal' }
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
        }
    }
    catch {
        throw 'Unable to inspect scheduled task action; refusing unsafe removal'
    }
}

function Assert-TaskActionMatchesManifest {
    param([object]$TaskAction, [object]$Manifest)
    if ($null -eq $TaskAction -or $null -eq $Manifest) { throw 'Scheduled task ownership is invalid; refusing unsafe removal' }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$TaskAction.executable, [string]$Manifest.taskAction.executable)) {
        throw 'Scheduled task ownership is invalid; refusing unsafe removal'
    }
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([string]$TaskAction.arguments, [string]$Manifest.taskAction.arguments)) {
        throw 'Scheduled task ownership is invalid; refusing unsafe removal'
    }
}

function Test-ScheduledTaskRunning {
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
            throw 'Unable to confirm collector task state; refusing unsafe removal'
        }
        try {
            $registeredTask = $folder.GetTask($Name)
            return ([int]$registeredTask.State -eq 4)
        }
        catch {
            if ((Get-InnermostHResult -Exception $_.Exception) -eq -2147024894) { return $false }
            throw 'Unable to confirm collector task state; refusing unsafe removal'
        }
    }
    finally {
        if ($registeredTask) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($registeredTask) }
        if ($folder) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($folder) }
        if ($service) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($service) }
    }
}

$manifest = $null
if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
    try { $manifest = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json }
    catch { throw 'Installation manifest is invalid; refusing unsafe removal' }
    Assert-OwnedManifest -Manifest $manifest
    $TaskName = [string]$manifest.taskName
}
elseif (Test-Path -LiteralPath $InstallRoot) {
    throw 'Installation manifest is missing; refusing unsafe removal'
}

$scheduledTaskAction = if ($manifest) {
    Get-ScheduledTaskAction -Name $TaskName -RequireReliableAbsence
}
else {
    $null
}
if ($scheduledTaskAction) {
    Assert-TaskActionMatchesManifest -TaskAction $scheduledTaskAction -Manifest $manifest

    & schtasks.exe /End /TN $TaskName *> $null
    if ($LASTEXITCODE -ne 0 -and (Test-ScheduledTaskRunning -Name $TaskName)) {
        throw 'Unable to stop collector task'
    }
    $confirmedTaskAction = Get-ScheduledTaskAction -Name $TaskName -RequireReliableAbsence
    if ($confirmedTaskAction) {
        Assert-TaskActionMatchesManifest -TaskAction $confirmedTaskAction -Manifest $manifest
        & schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unable to remove collector task' }
    }
}

if ($manifest -and (Test-Path -LiteralPath $manifest.claudeSettingsPath)) {
    try {
        $settings = [IO.File]::ReadAllText($manifest.claudeSettingsPath) | ConvertFrom-Json
        $currentCommand = $null
        if ($settings.PSObject.Properties['statusLine'] -and $settings.statusLine -and $settings.statusLine.PSObject.Properties['command']) {
            $currentCommand = [string]$settings.statusLine.command
        }
        if ($currentCommand -and [StringComparer]::OrdinalIgnoreCase.Equals($currentCommand, [string]$manifest.statusLineCommand)) {
            if ($manifest.backupPath) {
                $originalText = [IO.File]::ReadAllText($manifest.backupPath)
                $originalSettings = if ($originalText.Trim()) { $originalText | ConvertFrom-Json } else { [pscustomobject]@{} }
                if ($originalSettings.PSObject.Properties['statusLine']) {
                    if ($settings.PSObject.Properties['statusLine']) { $settings.statusLine = $originalSettings.statusLine }
                    else { $settings | Add-Member -NotePropertyName statusLine -NotePropertyValue $originalSettings.statusLine }
                }
                else {
                    $settings.PSObject.Properties.Remove('statusLine')
                }
            }
            else {
                $settings.PSObject.Properties.Remove('statusLine')
            }
            Write-JsonAtomic -Path $manifest.claudeSettingsPath -Value $settings
        }
    }
    catch {
        throw 'Unable to safely restore Claude settings'
    }
}

if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
}

[pscustomobject]@{ uninstalled = $true; taskName = $TaskName } | ConvertTo-Json -Compress
