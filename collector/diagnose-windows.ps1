[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'SilentlyContinue'

$ManifestSchemaVersion = 2
$ManifestOwner = 'kindle-llm-dash/windows-collector'
$TaskNamePrefix = 'Kindle LLM Quota Uploader-'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboard'
$StateRoot = Join-Path $InstallRoot 'state'
$ManifestPath = Join-Path $InstallRoot 'install-manifest.json'

function Test-CommandAvailable {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$nodeAvailable = Test-CommandAvailable 'node.exe'
$nodeVersionClass = $null
if ($nodeAvailable) {
    $version = (& node.exe --version 2>$null | Select-Object -First 1)
    if ($version -match '^v(\d+)') { $nodeVersionClass = "major-$($Matches[1])" }
}

$claudeCommand = Get-Command 'claude' -ErrorAction SilentlyContinue
$claudeAvailable = [bool]$claudeCommand
$claudeAuthenticated = $false
if ($claudeAvailable) {
    & $claudeCommand.Source auth status *> $null
    $claudeAuthenticated = ($LASTEXITCODE -eq 0)
}

$codexAvailable = Test-CommandAvailable 'codex'
$configPresent = Test-Path -LiteralPath (Join-Path $InstallRoot 'config.json')
$claudeSpoolPresent = Test-Path -LiteralPath (Join-Path $StateRoot 'claude.json')
$lastUploadPresent = Test-Path -LiteralPath (Join-Path $StateRoot 'last-upload.json')
$taskPresent = $false
$taskLoginTrigger = $false
$taskTwelveMinuteCadence = $false
$taskStartWhenAvailable = $false
$taskWakeDisabled = $false
$taskOverlapDisabled = $false
if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
    try {
        $manifest = [IO.File]::ReadAllText($ManifestPath) | ConvertFrom-Json
        $taskNamePattern = '^' + [regex]::Escape($TaskNamePrefix) + '[0-9a-f]{32}$'
        if ($manifest.schemaVersion -eq $ManifestSchemaVersion -and
            $manifest.owner -ceq $ManifestOwner -and
            $manifest.taskName -is [string] -and
            $manifest.taskName -cmatch $taskNamePattern) {
            $taskXmlText = (& schtasks.exe /Query /TN ([string]$manifest.taskName) /XML 2>$null | Out-String)
            $taskPresent = ($LASTEXITCODE -eq 0)
            if ($taskPresent) {
                [xml]$taskXml = $taskXmlText
                $taskLoginTrigger = ($null -ne $taskXml.Task.Triggers.LogonTrigger)
                $taskTwelveMinuteCadence = @($taskXml.Task.Triggers.TimeTrigger).Where({
                    $_.Repetition.Interval -eq 'PT12M'
                }).Count -gt 0
                $taskStartWhenAvailable = ([string]$taskXml.Task.Settings.StartWhenAvailable -eq 'true')
                $taskWakeDisabled = ([string]$taskXml.Task.Settings.WakeToRun -ne 'true')
                $taskOverlapDisabled = ([string]$taskXml.Task.Settings.MultipleInstancesPolicy -eq 'IgnoreNew')
            }
        }
    }
    catch {}
}

[pscustomobject]@{
    nodeAvailable = $nodeAvailable
    nodeVersionClass = $nodeVersionClass
    claudeAvailable = $claudeAvailable
    claudeAuthenticated = $claudeAuthenticated
    codexAvailable = $codexAvailable
    configPresent = $configPresent
    claudeSpoolPresent = $claudeSpoolPresent
    taskPresent = $taskPresent
    taskLoginTrigger = $taskLoginTrigger
    taskTwelveMinuteCadence = $taskTwelveMinuteCadence
    taskStartWhenAvailable = $taskStartWhenAvailable
    taskWakeDisabled = $taskWakeDisabled
    taskOverlapDisabled = $taskOverlapDisabled
    lastUploadPresent = $lastUploadPresent
} | ConvertTo-Json -Compress
