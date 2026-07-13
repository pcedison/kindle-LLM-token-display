# Production View Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close anonymous production reads immediately, migrate the Kindle to private URLs, and make every Vercel deployment fail closed when the view token is missing.

**Architecture:** Phase 0 first ensures project-level Vercel Authentication
Standard Protection and proves generated Production/Preview URLs are protected.
It then writes Production only, binds the exact canonical source, creates and
conditionally promotes a distinct redeployment only when the strict current
state cannot be reused, proves the canonical alias by double-read identity, and requires anonymous 401 plus
exact-token 200 before setting `PrivacyClosureAchieved=True`. Only then does it
write Preview/Development and apply a credential-only USB migration. PR 1 then
replaces the current absent-token-public boolean with a four-state access
resolver and an isolated local-only fixture mode.

**Tech Stack:** PowerShell 7, .NET `HttpClient`, Vercel CLI 55+, Next.js route handlers, Node.js test runner, Kindle FAT32 USB storage.

## Global Constraints

- Every repository PR runs the exact fixed gate in `2026-07-13-project-hardening-master.md`; the shorter commands below are additional focused gates, not replacements.
- Every complete PowerShell block in this plan runs through the master plan's
  `Invoke-FailClosedPowerShellPlanBlock` runner. Raw `pwsh -Command -`, pasted or
  line-by-line standard input, and any runner that can turn `throw` into exit
  code 0 are prohibited for gates and mutations.

- Never display the view token. Its permitted holders are Vercel, private Kindle `env.sh`, and one current-user DPAPI-encrypted operator file used for later authenticated smoke; the operator file is outside the repository and deleted after final acceptance unless the user explicitly retains it as an authorized read client.
- The newly generated view token must have this run's CSPRNG/32-byte/independent
  provenance. Ingest/admin each require a trusted creation record proving CSPRNG,
  at least 32 random bytes, and independent generation; a handoff saying only
  “random” is insufficient. Missing ingest/admin evidence sets
  `RotationRequired=True` and blocks final remediation completion, but it does
  not prevent Phase 0 from closing immediate public-read exposure. Blob evidence
  records only Vercel-issued provenance and server-only placement.
- Do not export existing Vercel secrets merely to compare them.
- Project-level Vercel Authentication Standard Protection must be ensured before
  any view-token environment write or redeployment. It protects every Preview
  and generated Production URL while leaving the canonical production domain on
  application view-token authentication so the Kindle needs no Vercel login.
- Do not select All Deployments unless a separately approved design introduces
  and real-device-validates a Kindle-capable Vercel bypass. Never create or use a
  Shareable Link, automation bypass, or Deployment Protection Exception; any
  existing one stops Phase 0.
- Phase 0 rollback keeps Standard Protection, the application view token, and
  the Kindle cache intact; disabling protection or public mode is never a
  rollback.
- The current downloader can replace the cache with a nonempty 401 body, so the Kindle dashboard must be stopped before Vercel protection is enabled and must remain stopped/USB-mounted until its private URLs are written.
- All Vercel Production, Preview, and Development environments fail closed
  without `DASHBOARD_VIEW_TOKEN`; Phase 0 provisions them in the fixed
  Production-closure-first order and never treats a partial write as completion.
- Local public fixture rendering is allowed only when `DASHBOARD_PUBLIC_FIXTURE=true`, `VERCEL_ENV` is absent, `NODE_ENV` is not production, no view token is configured, the request is unmanaged Dashboard rendering, and no Blob/config/quota read occurs.
- Authorization error responses are `no-store` and contain no private details.
- `.recovery/` and all Kindle/private backups remain outside Git.

---

### Task 1: Verify Phase 0 Preconditions and Establish the View Token

**Files:**
- Read: `.vercel/project.json`
- Read: `kindle-extension/local/env.sh`
- Read from device only: `<KINDLE_DRIVE>:\extensions\kindle-dash\local\env.sh`
- Read from device only: `<KINDLE_DRIVE>:\extensions\kindle-dash\dash.png`

**Interfaces:**
- Consumes: user-authorized maintenance window, linked Vercel project, connected Kindle drive.
- Produces: a new Base64URL view token derived from 32 random bytes plus a new
  current-user DPAPI holder, or the confirmed same-run holder/token for a bounded
  resume, together with secret-free pre-change metadata.

- [ ] **Step 0: Stop the Kindle dashboard before connecting USB**

On the Kindle, use KUAL `Stop Dashboard / Restore Kindle`, confirm native chrome is restored, then connect USB. Do not enable view protection while the old unauthenticated downloader can still run.

Expected: Dashboard daemon is stopped and the selected Kindle drive is mounted. Keep the Kindle USB-mounted through Tasks 1-3. If it disconnects or reboots after protection is enabled, do not start the dashboard; reconnect USB and finish the private URL update first.

- [ ] **Step 1: Confirm repository, project, and device identity**

Run:

```powershell
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Phase 0 requires PowerShell 7 or later'
}
$ProductionOrigin = (Read-Host 'Production origin, including https://').TrimEnd('/')
$KindleDriveLetter = (Read-Host 'Kindle USB drive letter (single letter)').Trim().TrimEnd(':').ToUpperInvariant()
if ($KindleDriveLetter -cnotmatch '^[A-Z]$') {
    throw 'Kindle USB drive letter must be one uppercase ASCII letter'
}
$KindleRoot = "$KindleDriveLetter`:\extensions\kindle-dash"

$originUri = [Uri]$ProductionOrigin
$canonicalOrigin = $originUri.GetLeftPart([UriPartial]::Authority)
if (
    -not $originUri.IsAbsoluteUri -or
    $originUri.Scheme -ne 'https' -or
    $originUri.UserInfo -or
    $originUri.AbsolutePath -ne '/' -or
    $originUri.Query -or
    $originUri.Fragment -or
    $ProductionOrigin -ne $canonicalOrigin
) { throw 'Production origin must be one canonical HTTPS origin without credentials, path, query, or fragment' }

$linkRaw = Get-Content -LiteralPath '.vercel\project.json' -Raw
if (-not $linkRaw.TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
    throw 'Linked Vercel project metadata root is not one JSON object'
}
try { $link = $linkRaw | ConvertFrom-Json -NoEnumerate }
catch { throw 'Linked Vercel project metadata is invalid' }
$linkNameProperties = @($link.PSObject.Properties | Where-Object Name -CEQ 'projectName')
$linkIdProperties = @($link.PSObject.Properties | Where-Object Name -CEQ 'projectId')
if (
    $link -isnot [Management.Automation.PSCustomObject] -or $link -is [Array] -or
    $linkNameProperties.Count -ne 1 -or $linkNameProperties[0].Value -isnot [string] -or
    $linkIdProperties.Count -ne 1 -or $linkIdProperties[0].Value -isnot [string] -or
    $linkNameProperties[0].Value -cne 'kindle-llm-dash-1' -or
    $linkIdProperties[0].Value -cnotmatch '^prj_[A-Za-z0-9]+$'
) { throw 'Unexpected Vercel project link' }
$drive = Get-Volume -DriveLetter $KindleDriveLetter
$KindleVolumeUniqueId = [string]$drive.UniqueId
$gitHead = git rev-parse HEAD
$gitStatus = git status --short --branch

if (
    $drive.FileSystemLabel -cne 'Kindle' -or
    $drive.FileSystem -cne 'FAT32' -or
    [string]::IsNullOrWhiteSpace($KindleVolumeUniqueId)
) { throw 'Selected drive is not the expected Kindle volume' }
if (-not (Test-Path -LiteralPath "$KindleRoot\local\env.sh" -PathType Leaf)) { throw 'Kindle env.sh is missing' }

[pscustomobject]@{
    VercelProjectMatches = $true
    KindleVolumeMatches = $true
    KindleVolumeIdentityCaptured = $true
    GitHead = $gitHead
    GitStatusLineCount = @($gitStatus).Count
}
```

Expected: only booleans, SHA, and dirty-line count are printed. If device or project identity differs, stop without writing.

- [ ] **Step 2: Confirm environment-variable presence without values**

Run:

```powershell
function Invoke-BoundedJsonNative {
    param(
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [string[]]$Arguments,
        [Parameter(Mandatory)] [int]$MaximumLength,
        [Parameter(Mandatory)] [string]$FailureMessage,
        [AllowNull()] [string]$InputText
    )

    $savedPreference = $ErrorActionPreference
    $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    if ($nativePreference) { $savedNativePreference = $PSNativeCommandUseErrorActionPreference }
    $hadLastExitCode = Test-Path Variable:global:LASTEXITCODE
    if ($hadLastExitCode) { $savedLastExitCode = $global:LASTEXITCODE }
    try {
        $ErrorActionPreference = 'Continue'
        if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
        $global:LASTEXITCODE = $null
        if ($PSBoundParameters.ContainsKey('InputText')) {
            $raw = @($InputText | & $Executable @Arguments 2>$null)
        } else {
            $raw = @(& $Executable @Arguments 2>$null)
        }
        $invocationSucceeded = $?
        $exitCode = $global:LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPreference
        if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $savedNativePreference }
        if ($hadLastExitCode) { $global:LASTEXITCODE = $savedLastExitCode }
        else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
    }
    if (-not $invocationSucceeded -or $null -eq $exitCode -or $exitCode -ne 0) {
        throw $FailureMessage
    }
    $text = $raw -join "`n"
    if ($text.Length -lt 2 -or $text.Length -gt $MaximumLength) {
        throw "$FailureMessage (response length invalid)"
    }
    if (-not $text.TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
        throw "$FailureMessage (JSON root is not one object)"
    }
    try { $document = $text | ConvertFrom-Json -NoEnumerate }
    catch { throw "$FailureMessage (invalid JSON)" }
    if ($document -isnot [Management.Automation.PSCustomObject] -or $document -is [Array]) {
        throw "$FailureMessage (JSON root is not one object)"
    }
    return $document
}

function ConvertTo-ExactEnvironmentMetadataProjection {
    param([Parameter(Mandatory)] $Document)

    if ($Document -isnot [Management.Automation.PSCustomObject] -or $Document -is [Array]) {
        throw 'Environment metadata root is not one JSON object'
    }
    $rootProperties = @($Document.PSObject.Properties)
    $envsProperties = @($rootProperties | Where-Object Name -CEQ 'envs')
    if (
        $rootProperties.Count -ne 1 -or
        $envsProperties.Count -ne 1 -or
        $envsProperties[0].Value -isnot [Array]
    ) { throw 'Environment metadata must contain only one exact envs array' }

    $requiredRowProperties = @('createdAt', 'key', 'target', 'type', 'updatedAt')
    $allowedRowProperties = @(
        'configurationId', 'createdAt', 'gitBranch', 'key',
        'target', 'type', 'updatedAt', 'value'
    )
    $knownTypes = @('plain', 'encrypted', 'sensitive', 'system')
    foreach ($row in $envsProperties[0].Value) {
        if ($row -isnot [Management.Automation.PSCustomObject] -or $row -is [Array]) {
            throw 'Environment metadata row is not one JSON object'
        }
        $rowPropertyNames = @($row.PSObject.Properties | ForEach-Object Name)
        if (@($rowPropertyNames | Where-Object { $_ -cnotin $allowedRowProperties }).Count -ne 0) {
            throw 'Environment metadata row contains an unknown property'
        }
        foreach ($requiredName in $requiredRowProperties) {
            if (@($row.PSObject.Properties | Where-Object Name -CEQ $requiredName).Count -ne 1) {
                throw 'Environment metadata row is missing a required case-exact property'
            }
        }

        $keyProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'key')
        $typeProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'type')
        $targetProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'target')
        $valueProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'value')
        $branchProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'gitBranch')
        $configurationProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'configurationId')
        $createdProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'createdAt')
        $updatedProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'updatedAt')
        if (
            $keyProperties.Count -ne 1 -or $keyProperties[0].Value -isnot [string] -or
            [string]::IsNullOrWhiteSpace($keyProperties[0].Value) -or
            $keyProperties[0].Value -cne $keyProperties[0].Value.Trim() -or
            $typeProperties.Count -ne 1 -or $typeProperties[0].Value -isnot [string] -or
            $typeProperties[0].Value -cnotin $knownTypes -or
            $targetProperties.Count -ne 1 -or $targetProperties[0].Value -isnot [Array] -or
            $targetProperties[0].Value.Count -eq 0 -or
            $valueProperties.Count -gt 1 -or
            $branchProperties.Count -gt 1 -or
            $configurationProperties.Count -gt 1 -or
            $createdProperties.Count -ne 1 -or $createdProperties[0].Value -isnot [Int64] -or
            $updatedProperties.Count -ne 1 -or $updatedProperties[0].Value -isnot [Int64]
        ) { throw 'Environment metadata row contains a malformed scalar or array field' }

        $type = $typeProperties[0].Value
        if (
            ($type -ceq 'plain' -and ($valueProperties.Count -ne 1 -or $valueProperties[0].Value -isnot [string])) -or
            ($type -cne 'plain' -and $valueProperties.Count -ne 0) -or
            ($branchProperties.Count -eq 1 -and (
                $branchProperties[0].Value -isnot [string] -or
                [string]::IsNullOrWhiteSpace($branchProperties[0].Value) -or
                $branchProperties[0].Value -cne $branchProperties[0].Value.Trim()
            )) -or
            ($configurationProperties.Count -eq 1 -and
                $null -ne $configurationProperties[0].Value -and
                $configurationProperties[0].Value -isnot [string])
        ) { throw 'Environment metadata optional fields do not match their exact conditional shape' }

        $targets = @($targetProperties[0].Value)
        foreach ($target in $targets) {
            if (
                $target -isnot [string] -or
                [string]::IsNullOrWhiteSpace($target) -or
                $target -cne $target.Trim()
            ) {
                throw 'Environment metadata target is not one exact nonempty scalar string'
            }
        }
        if (@($targets | Sort-Object -Unique).Count -ne $targets.Count) {
            throw 'Environment metadata row repeats a target'
        }
        [pscustomobject]@{
            Key = $keyProperties[0].Value
            Type = $type
            Targets = $targets
            HasGitBranch = $branchProperties.Count -eq 1
            HasConfigurationBinding =
                $configurationProperties.Count -eq 1 -and
                $null -ne $configurationProperties[0].Value
        }
    }
}

$validEnvironmentProbeJson = @(
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","type":"sensitive","target":["production"],"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"PUBLIC_LABEL","value":"synthetic","type":"plain","target":["custom-environment"],"gitBranch":"feature/probe","createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"SYSTEM_PROBE","type":"system","target":["custom-environment"],"configurationId":"env_probe","createdAt":1700000000000,"updatedAt":1700000000001}]}'
)
$validEnvironmentProbes = @($validEnvironmentProbeJson | ForEach-Object {
    ConvertTo-ExactEnvironmentMetadataProjection ($_ | ConvertFrom-Json -NoEnumerate)
})
if (
    $validEnvironmentProbes.Count -ne $validEnvironmentProbeJson.Count -or
    @($validEnvironmentProbes | Where-Object {
        @($_.PSObject.Properties | Where-Object Name -CEQ 'Value').Count -ne 0
    }).Count -ne 0
) { throw 'Strict environment valid probes failed or projected a plain value' }
$malformedEnvironmentProbeJson = @(
    '[{"envs":[]}]',
    '{"envs":{"key":"DASHBOARD_VIEW_TOKEN"}}',
    '{"envs":[[{"key":"DASHBOARD_VIEW_TOKEN","type":"sensitive","target":["production"],"configurationId":null,"createdAt":1700000000000,"updatedAt":1700000000001}]]}',
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","type":["sensitive"],"target":["production"],"configurationId":null,"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","type":"sensitive","target":"production","configurationId":null,"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","type":"sensitive","target":[["production"]],"configurationId":null,"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","Type":"sensitive","target":["production"],"configurationId":null,"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","value":"synthetic","type":"sensitive","target":["production"],"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"PUBLIC_LABEL","type":"plain","target":["custom-environment"],"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"BRANCH_PROBE","type":"encrypted","target":["preview"],"gitBranch":["feature/probe"],"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"UNKNOWN_PROBE","type":"encrypted","target":["preview"],"unknown":true,"createdAt":1700000000000,"updatedAt":1700000000001}]}'
)
$malformedEnvironmentProbesRejected = 0
foreach ($probeJson in $malformedEnvironmentProbeJson) {
    try {
        ConvertTo-ExactEnvironmentMetadataProjection `
            ($probeJson | ConvertFrom-Json -NoEnumerate) | Out-Null
    } catch { $malformedEnvironmentProbesRejected++ }
}
if ($malformedEnvironmentProbesRejected -ne $malformedEnvironmentProbeJson.Count) {
    throw 'Strict environment malformed-shape probes did not all fail closed'
}

$envDocument = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('env', 'list', '--format=json') `
    -MaximumLength 4194304 `
    -FailureMessage 'Unable to inspect environment-variable metadata'
$envRows = @(ConvertTo-ExactEnvironmentMetadataProjection $envDocument)
$requiredNames = @(
    'BLOB_READ_WRITE_TOKEN',
    'DASHBOARD_INGEST_TOKEN',
    'DASHBOARD_ADMIN_TOKEN'
)

$requiredPresence = @($requiredNames | ForEach-Object {
    $name = $_
    [pscustomobject]@{
        Name = $name
        Present = [bool]($envRows | Where-Object { $_.Key -ceq $name })
    }
})
$requiredPresence
if (@($requiredPresence | Where-Object { -not $_.Present }).Count -ne 0) {
    throw 'One or more required credential roles are absent'
}

$viewRows = @($envRows | Where-Object { $_.Key -ceq 'DASHBOARD_VIEW_TOKEN' })
$viewEntries = @($viewRows | ForEach-Object {
    if ($_.HasGitBranch -or $_.HasConfigurationBinding) {
        throw 'A view-token row has a branch or custom-environment binding'
    }
    $type = $_.Type
    foreach ($target in $_.Targets) {
        $expectedType = if ($target -in @('production', 'preview')) { 'sensitive' } else { 'encrypted' }
        if ($type -cne $expectedType) { throw 'A view-token target has the wrong type' }
        [pscustomobject]@{ Target = $target; Type = $type }
    }
})
if (@($viewEntries | Group-Object Target | Where-Object Count -ne 1).Count -ne 0) {
    throw 'View-token metadata contains a duplicate target'
}
$viewTargets = @($viewEntries.Target | Sort-Object -Unique)
$targetSignature = $viewTargets -join ','
$operatorSecretPath = Join-Path (Join-Path $env:LOCALAPPDATA 'KindleLLMDashboardOperator') 'view-token.dpapi'
$operatorHolderPresent = Test-Path -LiteralPath $operatorSecretPath -PathType Leaf
$Phase0RunMode = switch ($targetSignature) {
    '' { if ($operatorHolderPresent) { 'ResumePrepared' } else { 'NewProvisioning' } }
    'production' { 'ResumeProduction' }
    'preview,production' { 'ResumeProductionPreview' }
    'development,preview,production' { 'ResumeAllScopes' }
    default { throw 'Existing view-token scopes are outside the bounded resume states; use a reviewed rotation' }
}
if ($Phase0RunMode -ne 'NewProvisioning') {
    if (-not $operatorHolderPresent) {
        throw 'Bounded resume requires the interrupted run operator holder'
    }
    $resumeAnswer = (Read-Host 'Confirmed this holder belongs to the same interrupted Phase 0 run [yes/no]').Trim().ToLowerInvariant()
    if ($resumeAnswer -ne 'yes') {
        throw 'Holder provenance is not confirmed; use dedicated reviewed cleanup/rotation'
    }
}
$viewPresence = [pscustomobject]@{
    Production = $viewTargets -contains 'production'
    Preview = $viewTargets -contains 'preview'
    Development = $viewTargets -contains 'development'
    VariableRows = $viewRows.Count
    OperatorHolderPresent = $operatorHolderPresent
    RunMode = $Phase0RunMode
    MalformedEnvironmentProbesRejected = $malformedEnvironmentProbesRejected
}
$viewPresence
```

Expected: required roles are hard-required. The live/official CLI root and row
schema is projected through exact object/scalar/array checks before any
classification. Official optional `value`, `gitBranch`, and `configurationId`
fields plus the `system` type and unrelated custom-environment targets are
accepted only in their bounded shapes; a plain `value` is never projected or
printed, and no decrypt/readback is requested. The synthetic plain, branch,
system, custom-target, optional-field, array, case, and unknown-property probes
must all produce their expected pass/reject categories. Zero view-token scopes
plus no holder is `NewProvisioning`; zero scopes plus a holder is
`ResumePrepared`, never a new generation. Every resume requires an existing
holder and explicit proof it belongs to the same interrupted run. Exact typed
Production, Production+Preview, and all-three states map to their fixed resume
categories. Unconfirmed holder provenance requires dedicated reviewed
cleanup/rotation. Missing/empty/duplicate/unexpected view-token targets, wrong
types, branch/custom view-token overrides, or any other combination also stops.
Raw JSON and values are never printed.

- [ ] **Step 3: Generate a new token or load the interrupted run's DPAPI holder**

Run:

```powershell
if ($Phase0RunMode -eq 'NewProvisioning') {
    $randomBytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
    $viewToken = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $tokenGenerated = $true
    $holderLoaded = $false
} else {
    Add-Type -AssemblyName System.Security
    $entropy = [Text.Encoding]::UTF8.GetBytes('kindle-llm-dash/view-token/v1')
    $protectedBytes = [IO.File]::ReadAllBytes($operatorSecretPath)
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $protectedBytes,
        $entropy,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    try { $viewToken = [Text.Encoding]::UTF8.GetString($plainBytes) }
    finally {
        [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
        [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
    $randomBytes = $null
    $tokenGenerated = $false
    $holderLoaded = $true
}

if ($viewToken.Length -lt 43) { throw 'View token generation/holder load failed' }
[pscustomobject]@{
    Generated = $tokenGenerated
    HolderLoaded = $holderLoaded
    RandomBytes = if ($tokenGenerated) { $randomBytes.Length } else { $null }
    TokenCharacters = $viewToken.Length
    RunMode = $Phase0RunMode
}
```

Expected: a fresh run reports `Generated=True`, `RandomBytes=32`; a resume
reports `HolderLoaded=True`. Both report token length and run category only.
Never evaluate `$viewToken` by itself at the prompt.

- [ ] **Step 4: Record exact credential provenance, exercise role separation, and create the authorized operator holder**

First inspect trusted, secret-free creation records. A trusted application-role
record must identify the role and prove the generator class was CSPRNG, the
random input was at least 32 bytes, and generation was independent from every
other role. Do not infer those facts from a handoff that merely says “random,”
and never read back a value. Record the exact table below before creating the
operator holder:

| Role | Presence/provenance source | CSPRNG >=32 bytes proven | Independent generation proven | Vercel-issued | Server-only placement | Rotation required |
| --- | --- | --- | --- | --- | --- | --- |
| View | This run, or trusted interrupted-run creation record | Record boolean | Record boolean | `False` | `False` | `True` if either proof is missing |
| Ingest | Trusted role-specific creation record only | Record boolean | Record boolean | `False` | Record server-side/collector placement category only | `True` if either proof is missing |
| Admin | Trusted role-specific creation record only | Record boolean | Record boolean | `False` | Record server-side/admin-session placement category only | `True` if either proof is missing |
| Blob | Vercel platform metadata | Not applicable | Not applicable | Record boolean | Record boolean | Not an application-token rotation |

Use this gate; answer `yes` only after reviewing the required record, never from
memory or the existing handoff adjective:

```powershell
function Read-ReviewedEvidenceBoolean([string]$Prompt) {
    $answer = (Read-Host "$Prompt [yes/no]").Trim().ToLowerInvariant()
    if ($answer -notin @('yes', 'no')) { throw 'Evidence answer must be yes or no' }
    return $answer -eq 'yes'
}

if ($Phase0RunMode -eq 'NewProvisioning') {
    $viewCsprng32 = $randomBytes.Length -eq 32
    $viewIndependent = $true
    $viewProvenance = 'ThisRun'
} else {
    $viewCsprng32 = Read-ReviewedEvidenceBoolean 'Trusted interrupted-run view record proves CSPRNG and at least 32 random bytes'
    $viewIndependent = Read-ReviewedEvidenceBoolean 'Trusted interrupted-run view record proves independent role generation'
    $viewProvenance = 'TrustedInterruptedRunRecord'
}
$ingestCsprng32 = Read-ReviewedEvidenceBoolean 'Trusted ingest record proves CSPRNG and at least 32 random bytes'
$ingestIndependent = Read-ReviewedEvidenceBoolean 'Trusted ingest record proves independent role generation'
$adminCsprng32 = Read-ReviewedEvidenceBoolean 'Trusted admin record proves CSPRNG and at least 32 random bytes'
$adminIndependent = Read-ReviewedEvidenceBoolean 'Trusted admin record proves independent role generation'
$blobVercelIssued = Read-ReviewedEvidenceBoolean 'Vercel metadata proves Blob token was platform-issued'
$blobServerOnly = Read-ReviewedEvidenceBoolean 'Reviewed placement proves Blob token is server-only'

$credentialEvidence = @(
    [pscustomobject]@{
        Role = 'View'; Provenance = $viewProvenance; CsprngAtLeast32Bytes = $viewCsprng32
        IndependentGeneration = $viewIndependent; VercelIssued = $false; ServerOnly = $false
        RotationRequired = -not ($viewCsprng32 -and $viewIndependent)
    }
    [pscustomobject]@{
        Role = 'Ingest'; Provenance = 'TrustedCreationRecord'; CsprngAtLeast32Bytes = $ingestCsprng32
        IndependentGeneration = $ingestIndependent; VercelIssued = $false; ServerOnly = $null
        RotationRequired = -not ($ingestCsprng32 -and $ingestIndependent)
    }
    [pscustomobject]@{
        Role = 'Admin'; Provenance = 'TrustedCreationRecord'; CsprngAtLeast32Bytes = $adminCsprng32
        IndependentGeneration = $adminIndependent; VercelIssued = $false; ServerOnly = $null
        RotationRequired = -not ($adminCsprng32 -and $adminIndependent)
    }
    [pscustomobject]@{
        Role = 'Blob'; Provenance = 'VercelPlatform'; CsprngAtLeast32Bytes = $null
        IndependentGeneration = $null; VercelIssued = $blobVercelIssued; ServerOnly = $blobServerOnly
        RotationRequired = $false
    }
)
$applicationRotationRequired = [bool]($credentialEvidence | Where-Object RotationRequired)
$blobEvidenceBlocked = -not ($blobVercelIssued -and $blobServerOnly)
$credentialEvidence
[pscustomobject]@{
    Phase0PrivacyClosureAllowed = $viewToken.Length -ge 43 -and $Phase0RunMode -in @(
        'NewProvisioning', 'ResumePrepared', 'ResumeProduction', 'ResumeProductionPreview', 'ResumeAllScopes'
    )
    RotationRequired = $applicationRotationRequired
    BlobEvidenceBlocked = $blobEvidenceBlocked
    RemediationCompletionBlocked = $applicationRotationRequired -or $blobEvidenceBlocked
}
```

Project the table as booleans/categories only. Compute
`RemediationCompletionBlocked=True` if ingest/admin requires rotation or Blob
provenance/server-only placement is not proven. Also print
`Phase0PrivacyClosureAllowed=True` when the exact new/resume scope gate and Step 3
generation/holder load passed. Missing trusted view provenance on a resume joins
the rotation blockers but does not prevent the existing credential from closing
immediate public access. Any required rotation is a separately reviewed task.

Then use an in-memory helper that rejects an equal role pair and returns booleans
only. First execute a forced-duplicate self-test (`view-a`, `view-a`, `admin-b`)
and require rejection without printing the values. For actual provisioning,
compare application-role values only when they are newly generated together; do
not export existing Vercel values merely for comparison.

```powershell
function Assert-DistinctApplicationRoles([hashtable]$Roles) {
    $names = @('view', 'ingest', 'admin')
    $equalPairs = for ($left = 0; $left -lt $names.Count; $left++) {
        for ($right = $left + 1; $right -lt $names.Count; $right++) {
            $leftBytes = [Text.Encoding]::UTF8.GetBytes([string]$Roles[$names[$left]])
            $rightBytes = [Text.Encoding]::UTF8.GetBytes([string]$Roles[$names[$right]])
            try {
                $equal = $leftBytes.Length -eq $rightBytes.Length
                $difference = $leftBytes.Length -bxor $rightBytes.Length
                for ($index = 0; $index -lt [Math]::Min($leftBytes.Length, $rightBytes.Length); $index++) {
                    $difference = $difference -bor ($leftBytes[$index] -bxor $rightBytes[$index])
                }
                $equal -and $difference -eq 0
            } finally {
                [Array]::Clear($leftBytes, 0, $leftBytes.Length)
                [Array]::Clear($rightBytes, 0, $rightBytes.Length)
            }
        }
    }
    if ($equalPairs -contains $true) { throw 'Application credential roles must be distinct' }
    [pscustomobject]@{ Distinct = $true; PairChecks = $equalPairs.Count }
}

$duplicateProbeRejected = $false
try { Assert-DistinctApplicationRoles @{ view = 'probe-a'; ingest = 'probe-a'; admin = 'probe-b' } | Out-Null }
catch { $duplicateProbeRejected = $true }
if (-not $duplicateProbeRejected) { throw 'Role-separation duplicate probe failed' }
[pscustomobject]@{ DuplicateProbeRejected = $true }
```

Persist the new view token for later PR 1/Phase 4 smoke with Windows DPAPI CurrentUser scope:

```powershell
$operatorSecretRoot = Join-Path $env:LOCALAPPDATA 'KindleLLMDashboardOperator'
$operatorSecretPath = Join-Path $operatorSecretRoot 'view-token.dpapi'
if ($Phase0RunMode -eq 'NewProvisioning') {
    if (Test-Path -LiteralPath $operatorSecretPath) { throw 'An operator view credential holder already exists; use the reviewed rotation path' }
    Add-Type -AssemblyName System.Security
    $entropy = [Text.Encoding]::UTF8.GetBytes('kindle-llm-dash/view-token/v1')
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($viewToken)
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
        $plainBytes,
        $entropy,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $holderCreatedByThisRun = $false
    try {
        [IO.Directory]::CreateDirectory($operatorSecretRoot) | Out-Null
        $holderStream = [IO.FileStream]::new(
            $operatorSecretPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            4096,
            [IO.FileOptions]::WriteThrough
        )
        $holderCreatedByThisRun = $true
        try {
            $holderStream.Write($protectedBytes, 0, $protectedBytes.Length)
            $holderStream.Flush($true)
        } finally {
            $holderStream.Dispose()
        }
    } catch {
        if ($holderCreatedByThisRun) { Remove-Item -LiteralPath $operatorSecretPath -Force -ErrorAction SilentlyContinue }
        throw
    } finally {
        [Array]::Clear($plainBytes, 0, $plainBytes.Length)
        [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
    }
    if (-not (Test-Path -LiteralPath $operatorSecretPath -PathType Leaf)) { throw 'Operator view credential holder was not created' }
} else {
    if (-not (Test-Path -LiteralPath $operatorSecretPath -PathType Leaf) -or -not $holderLoaded) {
        throw 'Bounded resume did not retain one loaded operator holder'
    }
}
[pscustomobject]@{
    HolderCreated = $Phase0RunMode -eq 'NewProvisioning'
    HolderReused = $Phase0RunMode -ne 'NewProvisioning'
}
```

Later smoke loads with `ProtectedData.Unprotect(..., CurrentUser)`, uses the string only in memory/stdin, clears the byte arrays and variables in `finally`, and never prints the origin-plus-key. `KindleLLMDashboardOperator` is intentionally separate from the collector-owned `%LOCALAPPDATA%\KindleLLMDashboard` install root, so collector install/rollback/uninstall never owns or removes it. Rotation writes and validates a `CreateNew` DPAPI temp holder, retains the old holder until the new Vercel and Kindle values both validate, then uses the same checked rename/rollback pattern as USB A; it never overwrites the only usable holder in place. Final release deletes the holder and then its empty operator-only directory; deletion failure is reported without revealing content.

### Task 2: Close Canonical Production First, Then Configure Non-Production Scopes

**Files:**
- No repository file changes.

**Interfaces:**
- Consumes: linked project metadata, in-memory `$viewToken`, authorized operator
  holder, and canonical Production origin used to resolve the exact deployment
  authority.
- Produces: project-level Vercel Authentication Standard Protection, protected
  generated deployment URLs, a Production-only token write immediately followed
  by exact canonical authority, a distinct READY candidate when required,
  conditional promotion plus strict project/alias post-state, and canonical
  `401/200` proof, then a sensitive Preview token and platform-encrypted
  Development token.

- [ ] **Step 0a: Audit bypasses and idempotently ensure Standard Protection**

Inspect the Vercel project's Deployment Protection UI and the project API
metadata captured below. Do not create or use a Shareable Link, automation
bypass, or Deployment Protection Exception. Record only whether each category
is present; any `True` stops before mutation.

Run:

```powershell
function Get-ExactScalarStringProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string]$Name
    )
    if ($Object -isnot [Management.Automation.PSCustomObject] -or $Object -is [Array]) {
        throw 'Expected one JSON object'
    }
    $properties = @($Object.PSObject.Properties | Where-Object Name -CEQ $Name)
    if ($properties.Count -ne 1 -or $properties[0].Value -isnot [string]) {
        throw 'Expected one case-exact scalar string property'
    }
    return $properties[0].Value
}

$linkRaw = Get-Content -LiteralPath '.vercel\project.json' -Raw
if (-not $linkRaw.TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
    throw 'Linked project metadata root is not one JSON object'
}
try { $link = $linkRaw | ConvertFrom-Json -NoEnumerate }
catch { throw 'Linked project metadata is invalid' }
$linkedProjectName = Get-ExactScalarStringProperty $link 'projectName'
$projectId = Get-ExactScalarStringProperty $link 'projectId'
if ($linkedProjectName -cne 'kindle-llm-dash-1' -or $projectId -cnotmatch '^prj_[A-Za-z0-9]+$') {
    throw 'Linked project identity is invalid'
}

function Invoke-BoundedJsonNative {
    param(
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [string[]]$Arguments,
        [Parameter(Mandatory)] [int]$MaximumLength,
        [Parameter(Mandatory)] [string]$FailureMessage,
        [AllowNull()] [string]$InputText
    )

    $savedPreference = $ErrorActionPreference
    $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    if ($nativePreference) { $savedNativePreference = $PSNativeCommandUseErrorActionPreference }
    $hadLastExitCode = Test-Path Variable:global:LASTEXITCODE
    if ($hadLastExitCode) { $savedLastExitCode = $global:LASTEXITCODE }
    try {
        $ErrorActionPreference = 'Continue'
        if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
        $global:LASTEXITCODE = $null
        if ($PSBoundParameters.ContainsKey('InputText')) {
            $raw = @($InputText | & $Executable @Arguments 2>$null)
        } else {
            $raw = @(& $Executable @Arguments 2>$null)
        }
        $invocationSucceeded = $?
        $exitCode = $global:LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPreference
        if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $savedNativePreference }
        if ($hadLastExitCode) { $global:LASTEXITCODE = $savedLastExitCode }
        else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
    }
    if (-not $invocationSucceeded -or $null -eq $exitCode -or $exitCode -ne 0) {
        throw $FailureMessage
    }
    $text = $raw -join "`n"
    if ($text.Length -lt 2 -or $text.Length -gt $MaximumLength) {
        throw "$FailureMessage (response length invalid)"
    }
    if (-not $text.TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
        throw "$FailureMessage (JSON root is not one object)"
    }
    try { $document = $text | ConvertFrom-Json -NoEnumerate }
    catch { throw "$FailureMessage (invalid JSON)" }
    if ($document -isnot [Management.Automation.PSCustomObject] -or $document -is [Array]) {
        throw "$FailureMessage (JSON root is not one object)"
    }
    return $document
}

function Invoke-VercelProjectGet([string]$Id) {
    Invoke-BoundedJsonNative `
        -Executable 'vercel' `
        -Arguments @('api', "/v9/projects/$Id", '--raw') `
        -MaximumLength 1048576 `
        -FailureMessage 'Unable to read Vercel project metadata'
}

$projectBefore = Invoke-VercelProjectGet $projectId
if ((Get-ExactScalarStringProperty $projectBefore 'id') -cne $projectId) {
    throw 'Project API identity mismatch'
}

function Get-RollbackControlState($Project) {
    $autoAssignProperties = @($Project.PSObject.Properties | Where-Object Name -CEQ 'autoAssignCustomDomains')
    if ($autoAssignProperties.Count -ne 1 -or $autoAssignProperties[0].Value -isnot [bool]) {
        throw 'Project auto-assignment state is not one exact Boolean'
    }
    $rollbackProperties = @($Project.PSObject.Properties | Where-Object Name -CEQ 'lastRollbackTarget')
    if ($rollbackProperties.Count -ne 1) { throw 'Project rollback marker is missing' }
    $rollbackValue = $rollbackProperties[0].Value
    if (
        $null -ne $rollbackValue -and
        ($rollbackValue -isnot [Management.Automation.PSCustomObject] -or $rollbackValue -is [Array])
    ) { throw 'Project rollback marker has an invalid shape' }
    [pscustomobject]@{
        AutoAssignCustomDomains = $autoAssignProperties[0].Value
        RollbackMarkerPresent = $null -ne $rollbackValue
    }
}
$rollbackControlBefore = Get-RollbackControlState $projectBefore
[pscustomobject]@{
    AutoAssignCustomDomainsBefore = $rollbackControlBefore.AutoAssignCustomDomains
    RollbackMarkerPresentBefore = $rollbackControlBefore.RollbackMarkerPresent
}

function Read-AuditBoolean([string]$Prompt) {
    $answer = (Read-Host "$Prompt [yes/no]").Trim().ToLowerInvariant()
    if ($answer -notin @('yes', 'no')) { throw 'Audit answer must be yes or no' }
    return $answer -eq 'yes'
}
$bypassAudit = [pscustomobject]@{
    ShareableLinkPresent = Read-AuditBoolean 'UI/API metadata shows a Shareable Link'
    AutomationBypassPresent = Read-AuditBoolean 'UI/API metadata shows an automation bypass'
    DeploymentProtectionExceptionPresent = Read-AuditBoolean 'UI/API metadata shows a Deployment Protection Exception'
}
$bypassAudit
if (
    $bypassAudit.ShareableLinkPresent -or
    $bypassAudit.AutomationBypassPresent -or
    $bypassAudit.DeploymentProtectionExceptionPresent
) { throw 'A Vercel protection bypass or exception exists; stop Phase 0' }

$currentStandardWriteEnum = 'prod_deployment_urls_and_all_previews'
$compatibilityReadEnum = 'all_except_custom_domains'

function Get-StandardProtectionState {
    param(
        [Parameter(Mandatory)] $Project,
        [switch]$AllowDisabled
    )

    $topProperties = @($Project.PSObject.Properties | Where-Object Name -CEQ 'ssoProtection')
    if ($topProperties.Count -ne 1) { throw 'Project metadata must contain exactly one ssoProtection property' }
    $protectionObject = $topProperties[0].Value
    if ($null -eq $protectionObject) {
        if (-not $AllowDisabled) { throw 'Standard Protection readback is null' }
        return [pscustomobject]@{ Category = 'Disabled'; DeploymentType = $null }
    }
    if (
        $protectionObject -is [Array] -or
        $protectionObject -is [string] -or
        $protectionObject -is [ValueType] -or
        $protectionObject -isnot [pscustomobject]
    ) { throw 'ssoProtection must be one object or explicit null' }

    $typeProperties = @($protectionObject.PSObject.Properties | Where-Object Name -CEQ 'deploymentType')
    if ($typeProperties.Count -ne 1 -or $typeProperties[0].Value -isnot [string]) {
        throw 'ssoProtection must contain exactly one string deploymentType'
    }
    $deploymentType = [string]$typeProperties[0].Value
    if ([string]::IsNullOrWhiteSpace($deploymentType)) { throw 'deploymentType must be nonempty' }
    if ($deploymentType -ceq $currentStandardWriteEnum) {
        return [pscustomobject]@{ Category = 'CurrentWriteEnum'; DeploymentType = $deploymentType }
    }
    if ($deploymentType -ceq $compatibilityReadEnum) {
        return [pscustomobject]@{ Category = 'CompatibilityReadback'; DeploymentType = $deploymentType }
    }
    if ($deploymentType -ceq 'all') { throw 'All Deployments requires separate approval' }
    throw 'Standard Protection deploymentType is unknown'
}

$protectionBeforeState = Get-StandardProtectionState -Project $projectBefore -AllowDisabled
[pscustomobject]@{ ProtectionBeforeCategory = $protectionBeforeState.Category }

if ($protectionBeforeState.Category -eq 'Disabled') {
    $patchBody = [ordered]@{
        ssoProtection = [ordered]@{
            deploymentType = $currentStandardWriteEnum
        }
    } | ConvertTo-Json -Compress
    $patchResult = Invoke-BoundedJsonNative `
        -Executable 'vercel' `
        -Arguments @('api', "/v9/projects/$projectId", '--method', 'PATCH', '--input', '-', '--raw') `
        -MaximumLength 1048576 `
        -FailureMessage 'Unable to enable Standard Protection' `
        -InputText $patchBody
    if ((Get-ExactScalarStringProperty $patchResult 'id') -cne $projectId) {
        throw 'Standard Protection patch identity mismatch'
    }
    $protectionChanged = $true
} else {
    $protectionChanged = $false
}

$projectAfter = Invoke-VercelProjectGet $projectId
$protectionAfterState = Get-StandardProtectionState -Project $projectAfter
if ((Get-ExactScalarStringProperty $projectAfter 'id') -cne $projectId) {
    throw 'Standard Protection confirmation identity failed'
}
$rollbackControlAfter = Get-RollbackControlState $projectAfter
if (
    $rollbackControlAfter.AutoAssignCustomDomains -ne $rollbackControlBefore.AutoAssignCustomDomains -or
    $rollbackControlAfter.RollbackMarkerPresent -ne $rollbackControlBefore.RollbackMarkerPresent
) { throw 'Rollback/auto-assignment state changed concurrently during Standard Protection setup' }
$StandardProtectionProofComplete = $false
[pscustomobject]@{
    ProjectMatches = $true
    ProtectionChanged = $protectionChanged
    ProtectionAfterCategory = $protectionAfterState.Category
    AcceptedProtectionEnum = $protectionAfterState.DeploymentType
    CompatibilityReadbackPendingGeneratedGate = $protectionAfterState.Category -eq 'CompatibilityReadback'
    GeneratedUrlProofPending = $true
    ProductionDomainsUseApplicationViewToken = $true
    AutoAssignCustomDomains = $rollbackControlAfter.AutoAssignCustomDomains
    RollbackMarkerPresent = $rollbackControlAfter.RollbackMarkerPresent
}
```

Expected: every raw API body remains in memory. The top-level project object must
contain exactly one `ssoProtection` property. Only that property's explicit null
value is Disabled and receives the fixed nested write enum
`prod_deployment_urls_and_all_previews`. A non-null value must be one object—not
an array/scalar—with exactly one nonempty string `deploymentType`. The current
write enum is `CurrentWriteEnum`; live-confirmed
`all_except_custom_domains` is a read-only `CompatibilityReadback`. Compatibility
is not complete proof by itself. Null after write, `all`, unknown values, and
malformed shapes hard-stop. The same read-only baseline records one exact
Boolean `autoAssignCustomDomains` and a null-or-object `lastRollbackTarget`
presence category before/after the protection write; drift stops, and a false
Boolean alone is not labelled as proof of a historical rollback. Step 0b is
mandatory before any environment write.

- [ ] **Step 0b: Prove generated Production and Preview URLs receive Vercel Authentication**

Run only after Step 0a succeeds:

```powershell
$projectGate = Invoke-VercelProjectGet $projectId
$projectGateState = Get-StandardProtectionState -Project $projectGate
$projectGateEnum = $projectGateState.DeploymentType
if ((Get-ExactScalarStringProperty $projectGate 'id') -cne $projectId) {
    throw 'Project-wide Standard Protection identity is not confirmed'
}

function Read-AllDeploymentPages {
    param(
        [Parameter(Mandatory)]
        [ValidateSet('production', 'preview')]
        [string]$Environment,
        [ValidateRange(1, 20)] [int]$MaximumPages = 20,
        [ValidateRange(1, 2000)] [int]$MaximumDeployments = 2000
    )

    $deployments = [Collections.Generic.List[object]]::new()
    $seenCursors = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $seenUrls = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $cursor = $null
    $pageCount = 0
    while ($true) {
        if ($pageCount -ge $MaximumPages) {
            throw 'Deployment enumeration reached its page safety limit before the terminal cursor'
        }
        $arguments = @(
            'list', 'kindle-llm-dash-1', '--environment', $Environment,
            '--limit', '100', '--format=json'
        )
        if ($null -ne $cursor) { $arguments += @('--next', $cursor) }
        $document = Invoke-BoundedJsonNative `
            -Executable 'vercel' `
            -Arguments $arguments `
            -MaximumLength 4194304 `
            -FailureMessage 'Unable to enumerate generated deployment metadata'
        $pageCount++

        if ($document -isnot [Management.Automation.PSCustomObject] -or $document -is [Array]) {
            throw 'Deployment-list page is not one JSON object'
        }
        $deploymentProperties = @($document.PSObject.Properties | Where-Object Name -CEQ 'deployments')
        $paginationProperties = @($document.PSObject.Properties | Where-Object Name -CEQ 'pagination')
        if (
            $deploymentProperties.Count -ne 1 -or
            $deploymentProperties[0].Value -isnot [Array] -or
            $paginationProperties.Count -ne 1
        ) {
            throw 'Deployment-list page is missing exact deployments/pagination properties'
        }
        $pagination = $paginationProperties[0].Value
        if ($pagination -isnot [Management.Automation.PSCustomObject] -or $pagination -is [Array]) {
            throw 'Deployment-list pagination is not one JSON object'
        }
        $countProperties = @($pagination.PSObject.Properties | Where-Object Name -CEQ 'count')
        $nextProperties = @($pagination.PSObject.Properties | Where-Object Name -CEQ 'next')
        if (
            $countProperties.Count -ne 1 -or
            $countProperties[0].Value -isnot [Int32] -or
            $nextProperties.Count -ne 1
        ) {
            throw 'Deployment-list pagination does not contain exact count/next scalars'
        }

        $pageDeployments = @($deploymentProperties[0].Value)
        if ($countProperties[0].Value -ne $pageDeployments.Count) {
            throw 'Deployment-list pagination count does not match the page array'
        }
        foreach ($deployment in $pageDeployments) {
            if ($deployment -isnot [Management.Automation.PSCustomObject] -or $deployment -is [Array]) {
                throw 'Deployment-list entry is not one JSON object'
            }
            $urlProperties = @($deployment.PSObject.Properties | Where-Object Name -CEQ 'url')
            if (
                $urlProperties.Count -ne 1 -or
                $urlProperties[0].Value -isnot [string] -or
                [string]::IsNullOrWhiteSpace($urlProperties[0].Value)
            ) { throw 'Deployment-list entry does not contain one exact scalar URL' }
            if (-not $seenUrls.Add($urlProperties[0].Value)) {
                throw 'Deployment-list pagination repeated a deployment URL'
            }
            if ($deployments.Count -ge $MaximumDeployments) {
                throw 'Deployment enumeration reached its deployment safety limit'
            }
            $deployments.Add($deployment)
        }

        $nextValue = $nextProperties[0].Value
        if ($null -eq $nextValue) { break }
        if ($nextValue -isnot [Int64]) {
            throw 'Deployment-list next cursor is not the live-confirmed Int64 millisecond type'
        }
        $nextCursor = $nextValue.ToString([Globalization.CultureInfo]::InvariantCulture)
        if ($nextCursor -notmatch '^[1-9][0-9]{9,15}$') {
            throw 'Deployment-list next cursor is not a bounded millisecond timestamp'
        }
        if (-not $seenCursors.Add($nextCursor)) {
            throw 'Deployment-list pagination repeated a cursor'
        }
        $cursor = $nextCursor
    }

    [pscustomobject]@{
        Environment = $Environment
        Deployments = $deployments.ToArray()
        PageCount = $pageCount
        TerminalCursorReached = $true
    }
}

function Get-GeneratedUris($Deployments) {
    $uris = @($Deployments | ForEach-Object {
        $candidate = [string]$_.url
        if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate -cne $candidate.Trim()) {
            throw 'Generated deployment URL metadata contains surrounding whitespace'
        }
        if ($candidate -cnotmatch '^(?:https://)?(?<host>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.vercel\.app)/?$') {
            throw 'Generated deployment URL metadata violates the exact raw origin grammar'
        }
        $rawHost = $Matches.host
        if ($candidate -cnotmatch '^https://') {
            if ($candidate -cmatch '://') { throw 'Generated deployment URL scheme is invalid' }
            $candidate = "https://$candidate"
        }
        try { $uri = [Uri]::new($candidate) }
        catch { throw 'Generated deployment URL metadata is invalid' }
        if (
            $uri.Scheme -ne 'https' -or -not $uri.IsDefaultPort -or $uri.UserInfo -or
            $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or
            $uri.DnsSafeHost -cne $rawHost
        ) { throw 'Generated deployment URL metadata violates the expected category' }
        $uri
    })
    $uniqueUris = @($uris | Sort-Object AbsoluteUri -Unique)
    if ($uniqueUris.Count -ne $uris.Count) {
        throw 'Deployment enumeration repeated a normalized generated URL'
    }
    return $uniqueUris
}

$productionEnumeration = Read-AllDeploymentPages -Environment 'production'
$previewEnumeration = Read-AllDeploymentPages -Environment 'preview'
$productionGenerated = @(Get-GeneratedUris $productionEnumeration.Deployments)
$previewGenerated = @(Get-GeneratedUris $previewEnumeration.Deployments)

Add-Type -AssemblyName System.Net.Http
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.UseCookies = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(20)
try {
    function Test-ExactVercelAuthenticationLocation([AllowNull()] [Uri]$Location) {
        return $null -ne $Location -and
            $Location.IsAbsoluteUri -and
            $Location.Scheme -ceq 'https' -and
            $Location.IsDefaultPort -and
            -not $Location.UserInfo -and
            $Location.DnsSafeHost -cmatch '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*vercel\.com$' -and
            $Location.AbsolutePath -cmatch '^/sso-api(?:/|$)' -and
            -not $Location.Fragment
    }

    function Test-VercelAuthenticationRedirect([Uri]$Uri) {
        $response = $null
        try {
            $response = $client.GetAsync($Uri).GetAwaiter().GetResult()
            $location = $response.Headers.Location
            return [int]$response.StatusCode -eq 302 -and
                (Test-ExactVercelAuthenticationLocation $location)
        } catch {
            throw 'Generated-deployment Authentication probe failed without usable evidence'
        } finally {
            if ($null -ne $response) { $response.Dispose() }
        }
    }

    $productionResults = @($productionGenerated | ForEach-Object { Test-VercelAuthenticationRedirect $_ })
    $previewResults = @($previewGenerated | ForEach-Object { Test-VercelAuthenticationRedirect $_ })
} finally {
    $client.Dispose()
    $handler.Dispose()
}

$projectGateAfter = Invoke-VercelProjectGet $projectId
if ((Get-ExactScalarStringProperty $projectGateAfter 'id') -cne $projectId) {
    throw 'Post-enumeration Standard Protection identity is not confirmed'
}
$projectGateAfterState = Get-StandardProtectionState -Project $projectGateAfter
$protectionBracketStable =
    $projectGateAfterState.Category -ceq $projectGateState.Category -and
    $projectGateAfterState.DeploymentType -ceq $projectGateEnum
if (-not $protectionBracketStable) {
    throw 'Standard Protection changed while generated URLs were being proved'
}

$generatedGate = [pscustomobject]@{
    ProjectProtectionCategory = $projectGateState.Category
    ProjectProtectionEnum = $projectGateEnum
    PostProjectProtectionCategory = $projectGateAfterState.Category
    ProtectionBracketStable = $protectionBracketStable
    ProductionPageCount = $productionEnumeration.PageCount
    ProductionTerminalCursorReached = $productionEnumeration.TerminalCursorReached
    ProductionGeneratedPresent = $productionGenerated.Count -gt 0
    ProductionGeneratedCount = $productionGenerated.Count
    ProductionAllVercelAuthentication = $productionGenerated.Count -gt 0 -and $productionResults -notcontains $false
    PreviewPageCount = $previewEnumeration.PageCount
    PreviewTerminalCursorReached = $previewEnumeration.TerminalCursorReached
    PreviewGeneratedPresent = $previewGenerated.Count -gt 0
    PreviewGeneratedCount = $previewGenerated.Count
    PreviewAllVercelAuthentication = $previewGenerated.Count -eq 0 -or $previewResults -notcontains $false
}
$generatedGate
if (
    -not $generatedGate.ProductionTerminalCursorReached -or
    -not $generatedGate.PreviewTerminalCursorReached -or
    -not $generatedGate.ProductionAllVercelAuthentication -or
    -not $generatedGate.PreviewAllVercelAuthentication -or
    -not $generatedGate.ProtectionBracketStable
) { throw 'A generated deployment URL did not return the Vercel Authentication redirect category' }
$StandardProtectionProofComplete =
    $generatedGate.ProtectionBracketStable -and
    $generatedGate.ProductionTerminalCursorReached -and
    $generatedGate.PreviewTerminalCursorReached -and
    $generatedGate.ProductionAllVercelAuthentication -and
    $generatedGate.PreviewAllVercelAuthentication
[pscustomobject]@{
    StandardProtectionProofComplete = $StandardProtectionProofComplete
    CompatibilityReadbackUsed = $projectGateState.Category -eq 'CompatibilityReadback'
    CompatibilityReadbackCorroborated = $projectGateState.Category -ne 'CompatibilityReadback' -or $StandardProtectionProofComplete
}
```

Expected: the strict project setting validator brackets the full enumeration
with two fresh, identity-bound reads whose category and enum remain exactly
stable, and all discoverable current/past
Production generated URLs plus all discoverable Preview generated URLs return a
302 HTTPS Vercel Authentication `/sso-api` redirect with redirects disabled.
Production and Preview are each paginated from the first page through an
explicit null terminal `pagination.next`. Every page requires an exact array,
an exact scalar count equal to that array, case-exact scalar URL fields, and the
live-confirmed Int64 millisecond cursor. A malformed/repeated cursor, repeated
URL, nonterminal 20-page cap, or 2,000-deployment cap fails closed for separate
review; it can never set the proof flag. An arbitrary non-302 or wrong redirect
category is a failure. If no Preview exists, output explicitly says
`PreviewGeneratedPresent=False`. Never print a generated URL, canonical URL,
`Location`, response body, or raw list/API JSON. A compatibility readback becomes
acceptable only when both environments reach terminal pagination and every
generated-URL check passes. Only then is
`StandardProtectionProofComplete=True`, allowing Step 1 to write
`DASHBOARD_VIEW_TOKEN`. A disabled, malformed, unknown, `all`, or category/enum
drift on the post-enumeration read fails closed even if every earlier redirect
probe passed.

- [ ] **Step 1: Write Production only, or enter an exact bounded resume state**

Run:

```powershell
function Invoke-QuietNative {
    param(
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [string[]]$Arguments,
        [Parameter(Mandatory)] [int]$MaximumLength,
        [Parameter(Mandatory)] [string]$FailureMessage,
        [AllowNull()] [string]$InputText,
        [switch]$PassThru
    )

    $savedPreference = $ErrorActionPreference
    $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    if ($nativePreference) { $savedNativePreference = $PSNativeCommandUseErrorActionPreference }
    $hadLastExitCode = Test-Path Variable:global:LASTEXITCODE
    if ($hadLastExitCode) { $savedLastExitCode = $global:LASTEXITCODE }
    try {
        $ErrorActionPreference = 'Continue'
        if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
        $global:LASTEXITCODE = $null
        if ($PSBoundParameters.ContainsKey('InputText')) {
            $raw = @($InputText | & $Executable @Arguments 2>$null)
        } else {
            $raw = @(& $Executable @Arguments 2>$null)
        }
        $invocationSucceeded = $?
        $exitCode = $global:LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPreference
        if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $savedNativePreference }
        if ($hadLastExitCode) { $global:LASTEXITCODE = $savedLastExitCode }
        else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
    }
    if (-not $invocationSucceeded -or $null -eq $exitCode -or $exitCode -ne 0) {
        throw $FailureMessage
    }
    $length = ($raw -join "`n").Length
    if ($length -gt $MaximumLength) { throw "$FailureMessage (response length invalid)" }
    if ($PassThru) { return ,$raw }
}

function Get-ViewMetadata {
    $document = Invoke-BoundedJsonNative `
        -Executable 'vercel' `
        -Arguments @('env', 'list', '--format=json') `
        -MaximumLength 4194304 `
        -FailureMessage 'Unable to read view-token metadata'
    @(ConvertTo-ExactEnvironmentMetadataProjection $document | Where-Object {
        $_.Key -ceq 'DASHBOARD_VIEW_TOKEN'
    })
}

function Assert-ViewScopeContract([string[]]$ExpectedScopes) {
    $knownScopes = @('production', 'preview', 'development')
    $expected = @($ExpectedScopes | Sort-Object -Unique)
    if ($expected.Count -ne $ExpectedScopes.Count -or @($expected | Where-Object { $_ -cnotin $knownScopes }).Count -ne 0) {
        throw 'Expected view-token scope contract is invalid'
    }

    $rows = @(Get-ViewMetadata)
    $entries = @($rows | ForEach-Object {
        if ($_.HasGitBranch -or $_.HasConfigurationBinding) {
            throw 'A view-token row has a branch or custom-environment binding'
        }
        $type = $_.Type
        foreach ($target in $_.Targets) {
            $expectedType = if ($target -in @('production', 'preview')) { 'sensitive' } else { 'encrypted' }
            if ($type -cne $expectedType) { throw 'A view-token target has the wrong type' }
            [pscustomobject]@{ Target = $target; Type = $type }
        }
    })
    if (@($entries | Group-Object Target | Where-Object Count -ne 1).Count -ne 0) {
        throw 'View-token metadata contains a duplicate target'
    }
    $actual = @($entries.Target | Sort-Object -Unique)
    if ($actual.Count -ne $expected.Count -or (Compare-Object $actual $expected).Count -ne 0) {
        throw 'View-token scope coverage is not exact'
    }
    [pscustomobject]@{
        VariableRows = $rows.Count
        ExactCoverage = $true
        ExactTypes = $true
        NoDuplicateTargets = $true
        NoUnexpectedTargets = $true
    }
}

$PrivacyClosureAchieved = $false
if (-not $StandardProtectionProofComplete) {
    throw 'Standard Protection setting and generated-URL proof are incomplete'
}
$resumeMode = $Phase0RunMode -ne 'NewProvisioning'
switch ($Phase0RunMode) {
    'NewProvisioning' {
        if (@(Get-ViewMetadata).Count -ne 0) { throw 'Fresh provisioning no longer has an empty view-token state' }
        Invoke-QuietNative `
            -Executable 'vercel' `
            -Arguments @('env', 'add', 'DASHBOARD_VIEW_TOKEN', 'production', '--sensitive', '--yes') `
            -MaximumLength 1048576 `
            -FailureMessage 'Production view-token write failed; privacy closure was not achieved' `
            -InputText $viewToken
        $preClosureGate = Assert-ViewScopeContract @('production')
    }
    'ResumePrepared' {
        if (-not $holderLoaded -or @(Get-ViewMetadata).Count -ne 0) {
            throw 'Prepared resume no longer has the exact zero-scope/loaded-holder state'
        }
        Invoke-QuietNative `
            -Executable 'vercel' `
            -Arguments @('env', 'add', 'DASHBOARD_VIEW_TOKEN', 'production', '--sensitive', '--yes') `
            -MaximumLength 1048576 `
            -FailureMessage 'Prepared-resume Production write failed; privacy closure was not achieved' `
            -InputText $viewToken
        $preClosureGate = Assert-ViewScopeContract @('production')
    }
    'ResumeProduction' {
        if (-not $holderLoaded) { throw 'Resume holder was not loaded' }
        $preClosureGate = Assert-ViewScopeContract @('production')
    }
    'ResumeProductionPreview' {
        if (-not $holderLoaded) { throw 'Resume holder was not loaded' }
        $preClosureGate = Assert-ViewScopeContract @('production', 'preview')
    }
    'ResumeAllScopes' {
        if (-not $holderLoaded) { throw 'Resume holder was not loaded' }
        $preClosureGate = Assert-ViewScopeContract @('production', 'preview', 'development')
    }
    default {
        throw 'Phase 0 run mode is outside the bounded provisioning/resume contract'
    }
}
[pscustomobject]@{
    ProductionWriteOrResumeAccepted = $true
    ResumeMode = $resumeMode
    RunMode = $Phase0RunMode
    ExactPreClosureScopeState = $preClosureGate.ExactCoverage -and $preClosureGate.ExactTypes
    PrivacyClosureAchieved = $PrivacyClosureAchieved
}
```

Expected: `NewProvisioning` and `ResumePrepared` each write only Production
through stdin and without `--force`; the prepared resume reuses its confirmed
holder and never regenerates. Other fresh resumes retain only their already
validated exact Production, Production+Preview, or all-three state. Every mode
then runs the same pre-canonical authority, conditional candidate/promotion,
fresh post-state, and canonical-smoke chain before closure is true. No value is exported or
overwritten. Any drift, missing holder, or Production write failure stops with
`PrivacyClosureAchieved=False`. Do not pause before Steps 2-5. Standard
Protection stays enabled, and this procedure never selects All Deployments.

- [ ] **Step 2: Enforce the exact normal or bounded-resume scope/type gate**

Run:

```powershell
[pscustomobject]@{
    FreshProductionWrite = $Phase0RunMode -in @('NewProvisioning', 'ResumePrepared')
    ResumeScopeState = if ($resumeMode) { $Phase0RunMode } else { 'None' }
    ExactCoverage = $preClosureGate.ExactCoverage
    ExactTypes = $preClosureGate.ExactTypes
    NoDuplicateTargets = $preClosureGate.NoDuplicateTargets
    NoUnexpectedTargets = $preClosureGate.NoUnexpectedTargets
    PrivacyClosureAchieved = $PrivacyClosureAchieved
}
```

Expected: a normal first run or prepared resume has exact
Production-only/sensitive metadata with Preview and Development absent. Other
fresh resumes may retain only their validated exact Production,
Production+Preview, or all-three state. Every state hard-fails missing, empty,
duplicate, unexpected, or wrong-type targets instead of merely printing false.
`PrivacyClosureAchieved` remains false until Steps 3-5 re-run successfully.

- [ ] **Step 3: Bind canonical authority, create an exact candidate when needed, and conditionally promote it**

Run:

```powershell
function ConvertTo-GeneratedDeploymentUri([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -cne $Value.Trim()) {
        throw 'Generated deployment URL metadata contains surrounding whitespace'
    }
    $candidate = $Value
    if ($candidate -cnotmatch '^(?:https://)?(?<host>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.vercel\.app)/?$') {
        throw 'Generated deployment URL metadata violates the exact raw origin grammar'
    }
    $rawHost = $Matches.host
    if ($candidate -cnotmatch '^https://') {
        if ($candidate -cmatch '://') { throw 'Generated deployment URL scheme is invalid' }
        $candidate = "https://$candidate"
    }
    try { $uri = [Uri]::new($candidate) }
    catch { throw 'Generated deployment URL metadata is invalid' }
    if (
        -not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or
        -not $uri.IsDefaultPort -or $uri.UserInfo -or
        $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or
        $uri.DnsSafeHost -cne $rawHost
    ) { throw 'Generated deployment URL is not one exact HTTPS origin' }
    return $uri
}

function Get-ExactScalarStringProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string]$Name
    )
    if ($Object -isnot [Management.Automation.PSCustomObject] -or $Object -is [Array]) {
        throw 'Expected one JSON object'
    }
    $properties = @($Object.PSObject.Properties | Where-Object Name -CEQ $Name)
    if ($properties.Count -ne 1 -or $properties[0].Value -isnot [string]) {
        throw 'Expected one case-exact scalar string property'
    }
    return $properties[0].Value
}

function Get-ExactJsonObjectProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string]$Name
    )
    if ($Object -isnot [Management.Automation.PSCustomObject] -or $Object -is [Array]) {
        throw 'Expected one JSON object'
    }
    $properties = @($Object.PSObject.Properties | Where-Object Name -CEQ $Name)
    if (
        $properties.Count -ne 1 -or
        $properties[0].Value -isnot [Management.Automation.PSCustomObject] -or
        $properties[0].Value -is [Array]
    ) { throw 'Expected one case-exact JSON object property' }
    return $properties[0].Value
}

function ConvertTo-ExactCanonicalAliasProjection {
    param(
        [Parameter(Mandatory)] $AliasRecord,
        [Parameter(Mandatory)] [string]$ExpectedAlias,
        [Parameter(Mandatory)] [string]$ExpectedProjectId
    )

    $alias = Get-ExactScalarStringProperty $AliasRecord 'alias'
    $aliasProjectId = Get-ExactScalarStringProperty $AliasRecord 'projectId'
    $deploymentId = Get-ExactScalarStringProperty $AliasRecord 'deploymentId'
    $deployment = Get-ExactJsonObjectProperty $AliasRecord 'deployment'
    $nestedDeploymentId = Get-ExactScalarStringProperty $deployment 'id'
    $nestedDeploymentUrl = Get-ExactScalarStringProperty $deployment 'url'
    $redirectProperties = @($AliasRecord.PSObject.Properties | Where-Object Name -CEQ 'redirect')
    if ($redirectProperties.Count -ne 1 -or $null -ne $redirectProperties[0].Value) {
        throw 'Canonical alias must contain one case-exact explicit-null redirect'
    }
    $uri = ConvertTo-GeneratedDeploymentUri $nestedDeploymentUrl
    if (
        $alias -cne $ExpectedAlias -or
        $aliasProjectId -cne $ExpectedProjectId -or
        $deploymentId -cnotmatch '^dpl_[A-Za-z0-9]+$' -or
        $nestedDeploymentId -cne $deploymentId
    ) { throw 'Canonical alias is not one exact direct linked deployment binding' }

    $bindingText = [ordered]@{
        Alias = $alias
        ProjectId = $aliasProjectId
        DeploymentId = $deploymentId
        NestedDeploymentId = $nestedDeploymentId
        NestedDeploymentHost = $uri.DnsSafeHost.ToLowerInvariant()
        Redirect = $null
    } | ConvertTo-Json -Compress
    [pscustomobject]@{
        Alias = $alias
        ProjectId = $aliasProjectId
        DeploymentId = $deploymentId
        NestedDeploymentId = $nestedDeploymentId
        Uri = $uri
        Host = $uri.DnsSafeHost.ToLowerInvariant()
        BindingText = $bindingText
    }
}

function ConvertTo-ExactProductionDeploymentEvidence {
    param(
        [Parameter(Mandatory)] $Deployment,
        [Parameter(Mandatory)] [string]$ExpectedDeploymentId,
        [Parameter(Mandatory)] [string]$ExpectedProjectId,
        [AllowEmptyString()] [string]$ExpectedSha = ''
    )

    $deploymentId = Get-ExactScalarStringProperty $Deployment 'id'
    $deploymentProjectId = Get-ExactScalarStringProperty $Deployment 'projectId'
    $readyState = Get-ExactScalarStringProperty $Deployment 'readyState'
    $target = Get-ExactScalarStringProperty $Deployment 'target'
    $url = Get-ExactScalarStringProperty $Deployment 'url'
    $meta = Get-ExactJsonObjectProperty $Deployment 'meta'
    $sha = (Get-ExactScalarStringProperty $meta 'githubCommitSha').ToLowerInvariant()
    $uri = ConvertTo-GeneratedDeploymentUri $url
    if (
        $deploymentId -cne $ExpectedDeploymentId -or
        $deploymentProjectId -cne $ExpectedProjectId -or
        $readyState -cne 'READY' -or
        $target -cne 'production' -or
        $sha -notmatch '^[0-9a-f]{40}$' -or
        ($ExpectedSha -and $sha -cne $ExpectedSha)
    ) { throw 'Deployment API evidence is not the exact READY Production authority' }
    [pscustomobject]@{
        DeploymentId = $deploymentId
        ProjectId = $deploymentProjectId
        ReadyState = $readyState
        Target = $target
        Uri = $uri
        Host = $uri.DnsSafeHost.ToLowerInvariant()
        SourceSha = $sha
    }
}

function Get-ExactProjectPromotionState {
    param(
        [Parameter(Mandatory)] $Project,
        [Parameter(Mandatory)] [string]$ExpectedProjectId
    )

    $projectApiId = Get-ExactScalarStringProperty $Project 'id'
    if ($projectApiId -cne $ExpectedProjectId) { throw 'Project promotion-state identity mismatch' }
    $autoAssignProperties = @($Project.PSObject.Properties | Where-Object Name -CEQ 'autoAssignCustomDomains')
    if ($autoAssignProperties.Count -ne 1 -or $autoAssignProperties[0].Value -isnot [bool]) {
        throw 'Project auto-assignment state is not one exact Boolean'
    }
    $rollbackProperties = @($Project.PSObject.Properties | Where-Object Name -CEQ 'lastRollbackTarget')
    if ($rollbackProperties.Count -ne 1) { throw 'Project rollback marker is missing' }
    $rollbackValue = $rollbackProperties[0].Value
    if (
        $null -ne $rollbackValue -and
        ($rollbackValue -isnot [Management.Automation.PSCustomObject] -or $rollbackValue -is [Array])
    ) { throw 'Project rollback marker has an invalid shape' }

    $targets = Get-ExactJsonObjectProperty $Project 'targets'
    $production = Get-ExactJsonObjectProperty $targets 'production'
    $meta = Get-ExactJsonObjectProperty $production 'meta'
    $productionId = Get-ExactScalarStringProperty $production 'id'
    $productionState = Get-ExactScalarStringProperty $production 'readyState'
    $productionTarget = Get-ExactScalarStringProperty $production 'target'
    $productionSha = (Get-ExactScalarStringProperty $meta 'githubCommitSha').ToLowerInvariant()
    if (
        $productionId -cnotmatch '^dpl_[A-Za-z0-9]+$' -or
        $productionState -cne 'READY' -or
        $productionTarget -cne 'production' -or
        $productionSha -notmatch '^[0-9a-f]{40}$'
    ) { throw 'Project production target is not strict READY Production evidence' }

    [pscustomobject]@{
        AutoAssignCustomDomains = $autoAssignProperties[0].Value
        RollbackMarkerPresent = $null -ne $rollbackValue
        ProductionDeploymentId = $productionId
        ProductionSha = $productionSha
    }
}

function Get-CanonicalPrivacyStatus {
    Add-Type -AssemblyName System.Net.Http
    $privacyHandler = [Net.Http.HttpClientHandler]::new()
    $privacyHandler.AllowAutoRedirect = $false
    $privacyHandler.UseCookies = $false
    $privacyClient = [Net.Http.HttpClient]::new($privacyHandler)
    $privacyClient.Timeout = [TimeSpan]::FromSeconds(20)
    $privacyResponses = [Collections.Generic.List[Net.Http.HttpResponseMessage]]::new()
    $privateKey = $null
    try {
        try {
            $anonymousDashboard = $privacyClient.GetAsync("$ProductionOrigin/api/dashboard?profile=dp75sdi&managed=true").GetAwaiter().GetResult()
            $privacyResponses.Add($anonymousDashboard)
            $anonymousConfig = $privacyClient.GetAsync("$ProductionOrigin/api/device-config?profile=dp75sdi").GetAwaiter().GetResult()
            $privacyResponses.Add($anonymousConfig)
            $privateKey = [Uri]::EscapeDataString($viewToken)
            $privateDashboard = $privacyClient.GetAsync("$ProductionOrigin/api/dashboard?profile=dp75sdi&managed=true&key=$privateKey").GetAwaiter().GetResult()
            $privacyResponses.Add($privateDashboard)
            $privateConfig = $privacyClient.GetAsync("$ProductionOrigin/api/device-config?profile=dp75sdi&key=$privateKey").GetAwaiter().GetResult()
            $privacyResponses.Add($privateConfig)
            [pscustomobject]@{
                AnonymousDashboard = [int]$anonymousDashboard.StatusCode
                AnonymousDeviceConfig = [int]$anonymousConfig.StatusCode
                PrivateDashboard = [int]$privateDashboard.StatusCode
                PrivateDeviceConfig = [int]$privateConfig.StatusCode
            }
        } catch {
            throw 'Canonical privacy probe failed without usable evidence'
        }
    } finally {
        foreach ($response in $privacyResponses) { $response.Dispose() }
        $privacyClient.Dispose()
        $privacyHandler.Dispose()
        $privateKey = $null
        Remove-Variable privateKey -ErrorAction SilentlyContinue
    }
}

$productionHost = ([Uri]$ProductionOrigin).DnsSafeHost.ToLowerInvariant()
$escapedHost = [Uri]::EscapeDataString($productionHost)
$aliasPath = "/v4/aliases/$escapedHost"
$preAliasFirst = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', $aliasPath, '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to read pre-redeploy canonical alias'
$preAliasFirstProjection = ConvertTo-ExactCanonicalAliasProjection `
    -AliasRecord $preAliasFirst `
    -ExpectedAlias $productionHost `
    -ExpectedProjectId $projectId
$preCanonicalDeploymentId = $preAliasFirstProjection.DeploymentId
$preDeploymentPath = "/v13/deployments/$preCanonicalDeploymentId"
$preCanonicalDeployment = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', $preDeploymentPath, '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to read pre-redeploy canonical deployment'
$preAliasSecond = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', $aliasPath, '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to re-read pre-redeploy canonical alias'

$preAliasSecondProjection = ConvertTo-ExactCanonicalAliasProjection `
    -AliasRecord $preAliasSecond `
    -ExpectedAlias $productionHost `
    -ExpectedProjectId $projectId
$preFirstBinding = $preAliasFirstProjection.BindingText
$preSecondBinding = $preAliasSecondProjection.BindingText
$preAliasBindingStable = [string]::Equals($preFirstBinding, $preSecondBinding, [StringComparison]::Ordinal)
$preDeploymentEvidence = ConvertTo-ExactProductionDeploymentEvidence `
    -Deployment $preCanonicalDeployment `
    -ExpectedDeploymentId $preCanonicalDeploymentId `
    -ExpectedProjectId $projectId
$preCanonicalDeploymentUri = $preDeploymentEvidence.Uri
$preCanonicalHost = $preDeploymentEvidence.Host
$preFirstHost = $preAliasFirstProjection.Host
$preSecondHost = $preAliasSecondProjection.Host
$preCanonicalSha = $preDeploymentEvidence.SourceSha
$preProjectState = Get-ExactProjectPromotionState `
    -Project (Invoke-VercelProjectGet $projectId) `
    -ExpectedProjectId $projectId
$preCanonicalAuthority =
    $preAliasFirstProjection.DeploymentId -ceq $preCanonicalDeploymentId -and
    $preAliasFirstProjection.NestedDeploymentId -ceq $preCanonicalDeploymentId -and
    $preAliasSecondProjection.DeploymentId -ceq $preCanonicalDeploymentId -and
    $preAliasSecondProjection.NestedDeploymentId -ceq $preCanonicalDeploymentId -and
    $preFirstHost -ceq $preCanonicalHost -and $preSecondHost -ceq $preCanonicalHost -and
    $preCanonicalSha -match '^[0-9a-f]{40}$' -and
    $preProjectState.ProductionDeploymentId -ceq $preCanonicalDeploymentId -and
    $preProjectState.ProductionSha -ceq $preCanonicalSha -and
    $preAliasBindingStable
if (-not $preCanonicalAuthority) {
    throw 'Pre-redeploy canonical alias/deployment authority is not exact and stable'
}

$preCanonicalPrivacy = Get-CanonicalPrivacyStatus
$alreadyPrivate =
    $preCanonicalPrivacy.AnonymousDashboard -eq 401 -and
    $preCanonicalPrivacy.AnonymousDeviceConfig -eq 401 -and
    $preCanonicalPrivacy.PrivateDashboard -eq 200 -and
    $preCanonicalPrivacy.PrivateDeviceConfig -eq 200
$legacyPublic =
    $preCanonicalPrivacy.AnonymousDashboard -eq 200 -and
    $preCanonicalPrivacy.AnonymousDeviceConfig -eq 200 -and
    $preCanonicalPrivacy.PrivateDashboard -eq 200 -and
    $preCanonicalPrivacy.PrivateDeviceConfig -eq 200
if (-not $alreadyPrivate -and -not $legacyPublic) {
    throw 'Canonical preflight is neither exact private resume nor exact legacy-public state'
}

$phase0MutationAuthorized = $false
$redeploymentPerformed = $false
$requiresRedeployment =
    $legacyPublic -or
    -not $preProjectState.AutoAssignCustomDomains -or
    $preProjectState.RollbackMarkerPresent
if ($requiresRedeployment) {
    $mutationAnswer = (Read-Host 'Phase 0 maintenance approval authorizes exact-source redeploy and accepts that promote restores lasting production-domain auto-assignment [yes/no]').Trim().ToLowerInvariant()
    if ($mutationAnswer -ne 'yes') {
        throw 'Phase 0 redeploy/promotion mutation contract was not authorized'
    }
    $phase0MutationAuthorized = $true
    $redeployOutput = @(Invoke-QuietNative `
        -Executable 'vercel' `
        -Arguments @('redeploy', $preCanonicalDeploymentUri.AbsoluteUri, '--target', 'production') `
        -MaximumLength 1048576 `
        -FailureMessage 'Production redeployment failed; privacy closure was not achieved' `
        -PassThru)
    $redeployCandidates = @($redeployOutput | ForEach-Object {
        [regex]::Matches([string]$_, 'https://[a-z0-9.-]+\.vercel\.app(?:/)?') | ForEach-Object Value
    } | Sort-Object -Unique)
    if ($redeployCandidates.Count -ne 1) { throw 'Redeployment result did not identify one generated deployment' }
    $redeployUrl = $redeployCandidates[0]
    $after = Invoke-BoundedJsonNative `
        -Executable 'vercel' `
        -Arguments @('inspect', $redeployUrl, '--wait', '--timeout', '3m', '--format=json') `
        -MaximumLength 4194304 `
        -FailureMessage 'Unable to inspect the production redeployment'
    $inspectedDeploymentId = Get-ExactScalarStringProperty $after 'id'
    $inspectedReadyState = Get-ExactScalarStringProperty $after 'readyState'
    $inspectedTarget = Get-ExactScalarStringProperty $after 'target'
    $inspectedUri = ConvertTo-GeneratedDeploymentUri (Get-ExactScalarStringProperty $after 'url')
    $redeployResultUri = ConvertTo-GeneratedDeploymentUri $redeployUrl
    if (
        $inspectedDeploymentId -cnotmatch '^dpl_[A-Za-z0-9]+$' -or
        $inspectedDeploymentId -ceq $preCanonicalDeploymentId -or
        $inspectedReadyState -cne 'READY' -or
        $inspectedTarget -cne 'production' -or
        $inspectedUri.DnsSafeHost -cne $redeployResultUri.DnsSafeHost
    ) { throw 'Inspected redeployment is not one distinct READY Production candidate' }

    $candidateDocument = Invoke-BoundedJsonNative `
        -Executable 'vercel' `
        -Arguments @('api', "/v13/deployments/$inspectedDeploymentId", '--raw') `
        -MaximumLength 1048576 `
        -FailureMessage 'Unable to read the exact redeployment candidate'
    $candidateEvidence = ConvertTo-ExactProductionDeploymentEvidence `
        -Deployment $candidateDocument `
        -ExpectedDeploymentId $inspectedDeploymentId `
        -ExpectedProjectId $projectId `
        -ExpectedSha $preCanonicalSha
    if ($candidateEvidence.Host -cne $inspectedUri.DnsSafeHost.ToLowerInvariant()) {
        throw 'Inspect and deployment API disagree on the redeployment candidate'
    }
    $redeploymentPerformed = $true
    $deploymentAction = if ($alreadyPrivate) {
        'RedeployedPrivatePinnedCanonicalSource'
    } else {
        'RedeployedLegacyPublicCanonicalSource'
    }
} else {
    $candidateEvidence = $preDeploymentEvidence
    $deploymentAction = 'ReusedAlreadyPrivateCanonical'
}

$redeployedDeploymentId = $candidateEvidence.DeploymentId
$afterHost = $candidateEvidence.Host
$beforePromotionAliasFirst = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', $aliasPath, '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to reconcile the canonical alias before promotion'
$beforePromotionAliasSecond = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', $aliasPath, '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to re-read the canonical alias before promotion'
$beforePromotionFirstProjection = ConvertTo-ExactCanonicalAliasProjection `
    -AliasRecord $beforePromotionAliasFirst `
    -ExpectedAlias $productionHost `
    -ExpectedProjectId $projectId
$beforePromotionSecondProjection = ConvertTo-ExactCanonicalAliasProjection `
    -AliasRecord $beforePromotionAliasSecond `
    -ExpectedAlias $productionHost `
    -ExpectedProjectId $projectId
$beforePromotionStable = [string]::Equals(
    $beforePromotionFirstProjection.BindingText,
    $beforePromotionSecondProjection.BindingText,
    [StringComparison]::Ordinal
)
$beforePromotionDirect = $beforePromotionStable
if (-not $beforePromotionDirect) {
    throw 'Canonical alias became indirect or unstable before promotion reconciliation'
}
$beforePromotionIds = @(
    $beforePromotionFirstProjection.DeploymentId,
    $beforePromotionFirstProjection.NestedDeploymentId,
    $beforePromotionSecondProjection.DeploymentId,
    $beforePromotionSecondProjection.NestedDeploymentId
)
$aliasAlreadyCandidate = @($beforePromotionIds | Where-Object { $_ -cne $redeployedDeploymentId }).Count -eq 0
$aliasStillPreCanonical = @($beforePromotionIds | Where-Object { $_ -cne $preCanonicalDeploymentId }).Count -eq 0
if (-not $aliasAlreadyCandidate -and -not $aliasStillPreCanonical) {
    throw 'Canonical alias moved to a third deployment; stop for concurrency review'
}

$beforePromotionProjectState = Get-ExactProjectPromotionState `
    -Project (Invoke-VercelProjectGet $projectId) `
    -ExpectedProjectId $projectId
$expectedBeforePromotionId = if ($aliasAlreadyCandidate) { $redeployedDeploymentId } else { $preCanonicalDeploymentId }
if (
    $beforePromotionProjectState.ProductionDeploymentId -cne $expectedBeforePromotionId -or
    $beforePromotionProjectState.ProductionSha -cne $preCanonicalSha
) { throw 'Project production target disagrees with the reconciled alias' }

$promotionAlreadyComplete =
    $aliasAlreadyCandidate -and
    $beforePromotionProjectState.AutoAssignCustomDomains -and
    -not $beforePromotionProjectState.RollbackMarkerPresent
$promotionAttempted = $false
$promotionCliZeroExit = $null
if (-not $promotionAlreadyComplete) {
    if (-not $phase0MutationAuthorized) {
        $mutationAnswer = (Read-Host 'Phase 0 maintenance approval accepts that promoting this exact private Production deployment restores lasting production-domain auto-assignment [yes/no]').Trim().ToLowerInvariant()
        if ($mutationAnswer -ne 'yes') { throw 'Phase 0 promotion mutation contract was not authorized' }
        $phase0MutationAuthorized = $true
    }
    $promotionAttempted = $true
    try {
        Invoke-QuietNative `
            -Executable 'vercel' `
            -Arguments @('promote', $redeployedDeploymentId, '--yes', '--timeout', '3m', '--non-interactive', '--no-color') `
            -MaximumLength 1048576 `
            -FailureMessage 'Promotion command did not report success; reconcile exact post-state'
        $promotionCliZeroExit = $true
    } catch {
        $promotionCliZeroExit = $false
    }
}

[pscustomobject]@{
    PreCanonicalDeploymentId = $preCanonicalDeploymentId
    PreCanonicalAuthority = $preCanonicalAuthority
    PreAliasBindingStable = $preAliasBindingStable
    PreAutoAssignCustomDomains = $preProjectState.AutoAssignCustomDomains
    PreRollbackMarkerPresent = $preProjectState.RollbackMarkerPresent
    PreflightAlreadyPrivate = $alreadyPrivate
    DeploymentAction = $deploymentAction
    RedeploymentPerformed = $redeploymentPerformed
    CandidateDeploymentId = $redeployedDeploymentId
    CandidateReadyProductionSourceMatches = $candidateEvidence.SourceSha -ceq $preCanonicalSha
    AliasAlreadyCandidateBeforePromote = $aliasAlreadyCandidate
    AliasStillPreCanonicalBeforePromote = $aliasStillPreCanonical
    PromotionSkippedBecausePostStateAlreadyComplete = $promotionAlreadyComplete
    PromotionAttempted = $promotionAttempted
    PromotionCliZeroExit = $promotionCliZeroExit
    PrivacyClosureAchieved = $PrivacyClosureAchieved
}
```

Expected: after the Production scope write, canonical alias GET → exact
deployment API GET → the same alias GET freezes one stable, direct, linked,
READY Production authority with a scalar 40-character GitHub SHA. Only that API
deployment's strictly normalized generated HTTPS URL is passed to `redeploy`.
No recent-deployment list is required: alias/API/alias and the exact project
target are the authority, so a valid old rollback deployment is not rejected
for falling outside a recent window. A read-only canonical `401/200` preflight
reuses an already private deployment and avoids another redeploy after a
successful interrupted run only when auto-assignment is already restored and
the rollback marker is null. Exact legacy `200/200`, or a private-but-pinned
canonical state, triggers one distinct redeploy from the frozen API URL. Every
other status combination stops. Inspect identifies the
new ID/URL, then `/v13/deployments/{id}` alone proves the linked project,
READY/Production state, and same scalar SHA.

The alias is read twice before promotion. If it is already the candidate and
the project reports `autoAssignCustomDomains=True` plus an explicit null
`lastRollbackTarget`, promotion is skipped. If it is still the pre-canonical ID,
or the candidate is current but rollback/auto-assignment state is not closed,
the already-authorized Phase 0 mutation contract runs `vercel promote` for that
exact candidate. A third ID or unstable binding is a concurrency stop. The
lasting side effect is explicit: promote restores automatic assignment of
production domains after rollback/pinning. `redeploy --target production` only
creates a Production candidate and is never described as promotion. CLI output
and even exit zero are non-authoritative; Step 4 proves the post-state. A failed
or timed-out command still proceeds only to read-only reconciliation. On a
later bounded resume, exact canonical `401/200` avoids another deployment if the
promotion actually completed; no local deployment checkpoint is trusted. Do
not use `vercel deploy` from the dirty local directory. Any unresolved state
leaves `PrivacyClosureAchieved=False` and forbids Preview/Development.

- [ ] **Step 4: Prove promotion post-state and canonical alias identity**

Run immediately after Step 3 in the same guarded session:

```powershell
$aliasFirst = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', $aliasPath, '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to read the canonical alias'
$aliasFirstProjection = ConvertTo-ExactCanonicalAliasProjection `
    -AliasRecord $aliasFirst `
    -ExpectedAlias $productionHost `
    -ExpectedProjectId $projectId
$aliasDeploymentId = $aliasFirstProjection.DeploymentId
$deploymentPath = "/v13/deployments/$aliasDeploymentId"
$aliasDeployment = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', $deploymentPath, '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to read the alias-bound deployment'
$aliasSecond = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', $aliasPath, '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to re-read the canonical alias'

$aliasSecondProjection = ConvertTo-ExactCanonicalAliasProjection `
    -AliasRecord $aliasSecond `
    -ExpectedAlias $productionHost `
    -ExpectedProjectId $projectId
$firstBinding = $aliasFirstProjection.BindingText
$secondBinding = $aliasSecondProjection.BindingText
$postAliasBindingStable = [string]::Equals($firstBinding, $secondBinding, [StringComparison]::Ordinal)
$aliasDeploymentEvidence = ConvertTo-ExactProductionDeploymentEvidence `
    -Deployment $aliasDeployment `
    -ExpectedDeploymentId $aliasDeploymentId `
    -ExpectedProjectId $projectId `
    -ExpectedSha $preCanonicalSha
$firstHost = $aliasFirstProjection.Host
$secondHost = $aliasSecondProjection.Host
$deploymentHost = $aliasDeploymentEvidence.Host
$apiSourceSha = $aliasDeploymentEvidence.SourceSha
$postPromotionProjectState = Get-ExactProjectPromotionState `
    -Project (Invoke-VercelProjectGet $projectId) `
    -ExpectedProjectId $projectId
$canonicalIdentityProven =
    $aliasFirstProjection.DeploymentId -ceq $redeployedDeploymentId -and
    $aliasFirstProjection.NestedDeploymentId -ceq $redeployedDeploymentId -and
    $aliasSecondProjection.DeploymentId -ceq $redeployedDeploymentId -and
    $aliasSecondProjection.NestedDeploymentId -ceq $redeployedDeploymentId -and
    $firstHost -ceq $afterHost -and $secondHost -ceq $afterHost -and
    $deploymentHost -ceq $afterHost -and
    $apiSourceSha -match '^[0-9a-f]{40}$' -and
    $apiSourceSha -ceq $preCanonicalSha -and
    $postPromotionProjectState.AutoAssignCustomDomains -and
    -not $postPromotionProjectState.RollbackMarkerPresent -and
    $postPromotionProjectState.ProductionDeploymentId -ceq $redeployedDeploymentId -and
    $postPromotionProjectState.ProductionSha -ceq $preCanonicalSha -and
    $postAliasBindingStable
if (-not $canonicalIdentityProven) {
    throw 'Canonical alias double-read identity failed; privacy closure was not achieved'
}
[pscustomobject]@{
    AliasDeploymentId = $aliasDeploymentId
    LinkedProjectMatches = $true
    RedeploymentIdMatches = $true
    ReadyProductionTarget = $true
    ApiSourceMatchesPreCanonical = $apiSourceSha -ceq $preCanonicalSha
    AliasBindingStable = $postAliasBindingStable
    AutoAssignmentRestored = $postPromotionProjectState.AutoAssignCustomDomains
    RollbackMarkerCleared = -not $postPromotionProjectState.RollbackMarkerPresent
    ProjectTargetMatchesCandidate = $postPromotionProjectState.ProductionDeploymentId -ceq $redeployedDeploymentId
    PrivacyClosureAchieved = $PrivacyClosureAchieved
}
```

Expected: alias GET, deployment GET, then the same alias GET must agree exactly
on linked project, deployment ID/URL category, direct aliasing, `READY`, and
Production target; the new deployment API SHA must equal the pre-canonical/API
source SHA, and the selected alias binding is equivalent across both reads. The
exact project read must also prove `autoAssignCustomDomains=True`, an explicit
null `lastRollbackTarget`, and `targets.production` bound to the same candidate
ID/SHA. These post-state reads, not promote output or exit code, are completion
authority. No alias, host, deployment URL, API body, or redirect is printed.
Failure leaves `PrivacyClosureAchieved=False` and enters only the bounded resume;
it does not authorize Preview/Development or any approval checkpoint.

- [ ] **Step 5: Verify anonymous rejection and authenticated success in memory**

Run:

```powershell
$canonicalSmoke = Get-CanonicalPrivacyStatus
if (
    $canonicalSmoke.AnonymousDashboard -ne 401 -or
    $canonicalSmoke.AnonymousDeviceConfig -ne 401 -or
    $canonicalSmoke.PrivateDashboard -ne 200 -or
    $canonicalSmoke.PrivateDeviceConfig -ne 200
) { throw 'Canonical 401/200 privacy gate failed; privacy closure was not achieved' }
$PrivacyClosureAchieved = [bool]$canonicalIdentityProven
if (-not $PrivacyClosureAchieved) { throw 'Canonical identity was not proven' }
$canonicalSmoke
[pscustomobject]@{
    PrivacyClosureAchieved = $PrivacyClosureAchieved
    AutoAssignmentRestored = $postPromotionProjectState.AutoAssignCustomDomains
    RollbackMarkerCleared = -not $postPromotionProjectState.RollbackMarkerPresent
}
```

Expected: exact `401`, `401`, `200`, `200`, followed by
`PrivacyClosureAchieved=True`. The authenticated URLs remain only in process
memory. Any Production write, redeploy, alias, or smoke failure leaves closure
false: do not call production protected, do not write Preview/Development, do
not request Phase 0/PR 1 approval, and resume only from the exact classifier with
the same DPAPI holder. All Deployments is never enabled by this flow.

- [ ] **Step 6: Only after privacy closure, write missing Preview/Development scopes**

Run only when the same guarded session has
`$PrivacyClosureAchieved -eq $true`:

```powershell
if (-not $PrivacyClosureAchieved) {
    throw 'Preview/Development writes are forbidden before canonical privacy closure'
}

$resumeCandidates = @(
    @{ Name = 'ProductionOnly'; Scopes = @('production'); Remaining = @('preview', 'development') },
    @{ Name = 'ProductionPreview'; Scopes = @('production', 'preview'); Remaining = @('development') },
    @{ Name = 'AllScopes'; Scopes = @('production', 'preview', 'development'); Remaining = @() }
)
$resumeState = $null
foreach ($candidate in $resumeCandidates) {
    try {
        $null = Assert-ViewScopeContract $candidate.Scopes
        $resumeState = $candidate
        break
    } catch {
        continue
    }
}
if ($null -eq $resumeState) {
    throw 'View-token metadata is outside the bounded non-production resume states'
}

foreach ($scope in $resumeState.Remaining) {
    $writeArguments = if ($scope -eq 'preview') {
        @('env', 'add', 'DASHBOARD_VIEW_TOKEN', 'preview', '--sensitive', '--yes')
    } else {
        @('env', 'add', 'DASHBOARD_VIEW_TOKEN', 'development', '--yes')
    }
    try {
        Invoke-QuietNative `
            -Executable 'vercel' `
            -Arguments $writeArguments `
            -MaximumLength 1048576 `
            -FailureMessage 'A non-production view-token scope write failed' `
            -InputText $viewToken
    } catch {
        throw 'Non-production scope provisioning is incomplete; privacy closure remains true, but Phase 0 requires the bounded resume'
    }
}
[pscustomobject]@{
    StartingScopeCategory = $resumeState.Name
    PreviewDevelopmentWritesCompleted = $true
    PrivacyClosureAchieved = $PrivacyClosureAchieved
}
```

Expected: the normal path adds sensitive Preview and then encrypted Development
without `--force`; the bounded resume accepts only exact Production-only,
Production+Preview, or all-three metadata with exact types and no duplicate or
unexpected targets, and writes only the missing suffix. A partial
non-production failure never removes or overwrites a value and never reopens
production: record `PrivacyClosureAchieved=True`, `Phase0Complete=False`, and
resume only with the same DPAPI holder. Development is private/fail-closed even
though Vercel CLI 55 cannot mark it `sensitive`. No All Deployments operation is
performed.

- [ ] **Step 7: Enforce the final exact three-scope/type contract**

Run:

```powershell
if (-not $PrivacyClosureAchieved) { throw 'Privacy closure is not proven' }
$finalScopeGate = Assert-ViewScopeContract @('production', 'preview', 'development')
[pscustomobject]@{
    ProductionSensitive = $finalScopeGate.ExactTypes
    PreviewSensitive = $finalScopeGate.ExactTypes
    DevelopmentEncrypted = $finalScopeGate.ExactTypes
    ExactThreeScopeCoverage = $finalScopeGate.ExactCoverage
    NoDuplicateTargets = $finalScopeGate.NoDuplicateTargets
    NoUnexpectedTargets = $finalScopeGate.NoUnexpectedTargets
    PrivacyClosureAchieved = $PrivacyClosureAchieved
}
```

Expected: exact Production/Preview/Development coverage, sensitive
Production/Preview, encrypted Development, and no duplicate, empty, or
unexpected target. Any mismatch throws; false booleans are never treated as a
passing gate. Only after this succeeds may Task 3 migrate the Kindle.

### Task 3: Perform USB A Credential Migration

**Files:**
- Modify on device only: `<KINDLE_DRIVE>:\extensions\kindle-dash\local\env.sh`
- Preserve on device: `<KINDLE_DRIVE>:\extensions\kindle-dash\dash.png`
- Create private device backup under: `<KINDLE_DRIVE>:\extensions\kindle-dash\backups\pre-view-$stamp\`

**Interfaces:**
- Consumes: `$viewToken`, `PrivacyClosureAchieved=True`, the exact final
  three-scope/type gate, and DP75SDI dimensions.
- Produces: two authenticated URLs with the key exactly once and explicit 758x1024 expectations.

- [ ] **Step 1: Back up the private device state before editing**

Run:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = "$KindleRoot\backups\pre-view-$stamp"
New-Item -ItemType Directory -Path $backupRoot | Out-Null
Copy-Item -LiteralPath "$KindleRoot\local\env.sh" -Destination "$backupRoot\env.sh" -Force
if (Test-Path -LiteralPath "$KindleRoot\dash.png") {
    Copy-Item -LiteralPath "$KindleRoot\dash.png" -Destination "$backupRoot\dash.png" -Force
}
$cacheSourceExists = Test-Path -LiteralPath "$KindleRoot\dash.png" -PathType Leaf
$cacheBackupMatches = -not $cacheSourceExists -or (
    (Test-Path -LiteralPath "$backupRoot\dash.png" -PathType Leaf) -and
    (Get-FileHash -LiteralPath "$KindleRoot\dash.png" -Algorithm SHA256).Hash -eq
        (Get-FileHash -LiteralPath "$backupRoot\dash.png" -Algorithm SHA256).Hash
)
if (-not $cacheBackupMatches) { throw 'Cached PNG backup does not match its source' }

[pscustomobject]@{
    BackupCreated = Test-Path -LiteralPath "$backupRoot\env.sh"
    CachedPngBackedUp = $cacheBackupMatches
}
```

Expected: booleans only; no file content is printed.

- [ ] **Step 2: Replace only the managed URLs and dimension settings**

Run:

```powershell
$envPath = "$KindleRoot\local\env.sh"
$backupEnvPath = "$backupRoot\env.sh"
$tempPath = "$envPath.new.$stamp"
$rollbackPath = "$envPath.rollback.$stamp"
$failedPath = "$envPath.failed.$stamp"
$UsbCredentialResidueDetected = $false
$UsbViewTokenRotationRequired = $false
$UsbCredentialResidueAbsenceProven = $false
$InMemoryCredentialMaterialCleared = $false
$envDirectory = [IO.Path]::GetDirectoryName($envPath)

$clearUsbCredentialMemory = {
    foreach ($arrayName in @('randomBytes', 'originalBytes', 'backupBytes', 'newBytes', 'restoredBytes')) {
        $arrayVariable = Get-Variable -Name $arrayName -ErrorAction SilentlyContinue
        if ($arrayVariable -and $arrayVariable.Value -is [Array]) {
            [Array]::Clear($arrayVariable.Value, 0, $arrayVariable.Value.Length)
        }
    }
    foreach ($privateName in @(
        'randomBytes', 'originalBytes', 'backupBytes', 'newBytes', 'restoredBytes',
        'viewToken', 'encodedKey', 'dashboardUrl', 'configUrl',
        'dashboardLine', 'configLine', 'text', 'originalText',
        'beforeUnmanaged', 'afterUnmanaged', 'updated'
    )) {
        Set-Variable -Name $privateName -Value $null -ErrorAction SilentlyContinue
    }
    Remove-Variable randomBytes, originalBytes, backupBytes, newBytes, restoredBytes, viewToken, encodedKey, dashboardUrl, configUrl, dashboardLine, configLine, text, originalText, beforeUnmanaged, afterUnmanaged, updated -ErrorAction SilentlyContinue
    $InMemoryCredentialMaterialCleared = $true
}

$getUsbTransactionResidueInventory = {
    try {
        $volumes = @(Get-Volume -DriveLetter $KindleDriveLetter -ErrorAction Stop)
        if ($volumes.Count -ne 1) { throw 'USB volume cardinality changed' }
        $currentVolume = $volumes[0]
        if (
            $currentVolume.FileSystemLabel -cne 'Kindle' -or
            $currentVolume.FileSystem -cne 'FAT32' -or
            [string]$currentVolume.UniqueId -cne $KindleVolumeUniqueId
        ) { throw 'USB volume identity changed' }

        $rootItem = Get-Item -LiteralPath $KindleRoot -Force -ErrorAction Stop
        $envDirectoryItem = Get-Item -LiteralPath $envDirectory -Force -ErrorAction Stop
        if (
            -not $rootItem.PSIsContainer -or
            -not $envDirectoryItem.PSIsContainer -or
            ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            ($envDirectoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
        ) { throw 'USB root identity is not a direct directory' }

        $residueItems = @(Get-ChildItem -LiteralPath $envDirectory -Force -ErrorAction Stop | Where-Object {
            $_.Name -cmatch '^env\.sh\.(?:new|failed|rollback)(?:\.|$)'
        })
        foreach ($residueItem in $residueItems) {
            if (
                $residueItem.PSIsContainer -or
                ($residueItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                $residueItem.Name -cnotmatch '^env\.sh\.(?:new|failed|rollback)\.[0-9]{8}-[0-9]{6}$'
            ) { throw 'USB transaction residue has an unexpected name or file type' }
        }
        $residueItems
    } catch {
        $UsbCredentialResidueDetected = $true
        $UsbViewTokenRotationRequired = $true
        $UsbCredentialResidueAbsenceProven = $false
        $RemediationCompletionBlocked = $true
        throw 'USB volume identity and residue inventory could not be proved'
    }
}

$removeCurrentUsbCredentialResidue = {
    $UsbCredentialResidueAbsenceProven = $false
    try {
        $beforeResidue = @(. $getUsbTransactionResidueInventory)
        foreach ($privatePath in @($tempPath, $failedPath)) {
            $privateName = [IO.Path]::GetFileName($privatePath)
            if (@($beforeResidue | Where-Object Name -CEQ $privateName).Count -eq 1) {
                Remove-Item -LiteralPath $privatePath -Force -ErrorAction Stop
            }
        }
        $afterResidue = @(. $getUsbTransactionResidueInventory)
        if ($afterResidue.Count -ne 0) { throw 'USB transaction residue remains' }
        $UsbCredentialResidueDetected = $false
        $UsbCredentialResidueAbsenceProven = $true
    } catch {
        $UsbCredentialResidueDetected = $true
        $UsbViewTokenRotationRequired = $true
        $UsbCredentialResidueAbsenceProven = $false
        $RemediationCompletionBlocked = $true
        throw 'USB credential residue could not be removed; reviewed cleanup and view-token rotation are required'
    }
}

try { $preExistingUsbResidue = @(. $getUsbTransactionResidueInventory) }
catch {
    . $clearUsbCredentialMemory
    throw
}
if ($preExistingUsbResidue.Count -ne 0) {
    $UsbCredentialResidueDetected = $true
    $UsbViewTokenRotationRequired = $true
    $UsbCredentialResidueAbsenceProven = $false
    $RemediationCompletionBlocked = $true
    . $clearUsbCredentialMemory
    throw 'Pre-existing USB transaction residue requires reviewed cleanup and view-token rotation'
}
$UsbCredentialResidueAbsenceProven = $true

try {
    $UsbCredentialResidueAbsenceProven = $false
    $originalBytes = [IO.File]::ReadAllBytes($envPath)
    $backupBytes = [IO.File]::ReadAllBytes($backupEnvPath)
    if (-not [Collections.StructuralComparisons]::StructuralEqualityComparer.Equals($originalBytes, $backupBytes)) {
        throw 'Private env backup is not byte-identical'
    }
    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    $text = $utf8.GetString($originalBytes)
    $originalText = $text
    $encodedKey = [Uri]::EscapeDataString($viewToken)
    $dashboardUrl = "$ProductionOrigin/api/dashboard?profile=dp75sdi&managed=true&key=$encodedKey"
    $configUrl = "$ProductionOrigin/api/device-config?profile=dp75sdi&key=$encodedKey"

    $dashboardPattern = [regex]::new('(?m)^export DASHBOARD_URL=.*$')
    $configPattern = [regex]::new('(?m)^export REMOTE_CONFIG_URL=.*$')
    if ($dashboardPattern.Matches($text).Count -ne 1 -or $configPattern.Matches($text).Count -ne 1) {
        throw 'Expected exactly one managed URL assignment for each endpoint'
    }

    $text = $dashboardPattern.Replace($text, "export DASHBOARD_URL=`"$dashboardUrl`"", 1)
    $text = $configPattern.Replace($text, "export REMOTE_CONFIG_URL=`"$configUrl`"", 1)

    foreach ($setting in @(
        @{ Name = 'DASHBOARD_EXPECTED_WIDTH'; Value = '758' },
        @{ Name = 'DASHBOARD_EXPECTED_HEIGHT'; Value = '1024' }
    )) {
        $pattern = [regex]::new("(?m)^export $($setting.Name)=.*$")
        $line = "export $($setting.Name)=$($setting.Value)"
        if ($pattern.Matches($text).Count -eq 0) {
            $separator = if ($text.EndsWith("`n")) { '' } else { "`n" }
            $text = $text + $separator + $line + "`n"
        }
        elseif ($pattern.Matches($text).Count -eq 1) { $text = $pattern.Replace($text, $line, 1) }
        else { throw "Duplicate $($setting.Name) assignments" }
    }

    $managedPattern = '(?m)^export (DASHBOARD_URL|REMOTE_CONFIG_URL|DASHBOARD_EXPECTED_WIDTH|DASHBOARD_EXPECTED_HEIGHT)=.*(?:\r?\n|$)'
    $beforeUnmanaged = [regex]::Replace($originalText, $managedPattern, '')
    $afterUnmanaged = [regex]::Replace($text, $managedPattern, '')
    if ($beforeUnmanaged.TrimEnd("`r", "`n") -cne $afterUnmanaged.TrimEnd("`r", "`n")) {
        throw 'A non-managed private setting changed'
    }

    $newBytes = $utf8.GetBytes($text)
    $stream = $null
    try {
        $stream = [IO.FileStream]::new(
            $tempPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            4096,
            [IO.FileOptions]::WriteThrough
        )
        $stream.Write($newBytes, 0, $newBytes.Length)
        $stream.Flush($true)
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if ($null -ne $newBytes) { [Array]::Clear($newBytes, 0, $newBytes.Length) }
    }

    [IO.File]::Move($envPath, $rollbackPath)
    try {
        [IO.File]::Move($tempPath, $envPath)
    } catch {
        if (
            (Test-Path -LiteralPath $rollbackPath -PathType Leaf) -and
            -not (Test-Path -LiteralPath $envPath)
        ) { [IO.File]::Move($rollbackPath, $envPath) }
        throw
    }
} catch {
    $usbWriteFailure = $_
    $usbResidueFailure = $null
    try { . $removeCurrentUsbCredentialResidue }
    catch { $usbResidueFailure = $_ }
    . $clearUsbCredentialMemory
    if ($null -ne $usbResidueFailure) { throw $usbResidueFailure }
    throw $usbWriteFailure
}
```

Expected: the backup is byte-identical, all non-managed lines are unchanged, and
the device file is UTF-8 without BOM. Before and after cleanup, the same captured
Kindle volume identity and direct non-reparse root must be readable; disconnect,
replacement media, or an inventory error is never interpreted as absence. The
bounded same-directory inventory covers every historical/current
`env.sh.new.*`, `env.sh.failed.*`, and `env.sh.rollback.*`. Pre-existing residue
is never silently overwritten or deleted; it blocks completion and requires
reviewed cleanup and view-token rotation. Any Step 2 failure deletes only this
run's `.new`/`.failed` copy, then proves the global inventory is empty and clears
in-memory credential material before it rethrows. Step 3 validates the committed
file, restores `$rollbackPath` on failure, and stops. Only after Step 3 passes
may it delete `$rollbackPath`, re-prove the mounted-volume identity plus zero
global residue, and continue.

- [ ] **Step 3: Validate structure without printing authenticated URLs**

Run:

```powershell
$restoreUsbEnv = {
    try {
        $restoreInventory = @(. $getUsbTransactionResidueInventory)
        $rollbackName = [IO.Path]::GetFileName($rollbackPath)
        $failedName = [IO.Path]::GetFileName($failedPath)
        if (@($restoreInventory | Where-Object Name -CEQ $rollbackName).Count -ne 1) {
            throw 'USB update rollback source is unavailable'
        }
        if (@($restoreInventory | Where-Object Name -CEQ $failedName).Count -ne 0) {
            $UsbCredentialResidueDetected = $true
            $UsbViewTokenRotationRequired = $true
            $RemediationCompletionBlocked = $true
            throw 'USB credential quarantine path was not clean before rollback'
        }
        if ([IO.File]::Exists($envPath)) {
            [IO.File]::Move($envPath, $failedPath)
        }
        [IO.File]::Move($rollbackPath, $envPath)
        $restoredBytes = [IO.File]::ReadAllBytes($envPath)
        if (-not [Collections.StructuralComparisons]::StructuralEqualityComparer.Equals($originalBytes, $restoredBytes)) {
            throw 'USB update rollback could not be proven byte-identical'
        }
    } finally {
        . $removeCurrentUsbCredentialResidue
    }
}

$rollbackRemovedAfterValidation = $false
try {
    $updated = [IO.File]::ReadAllText($envPath)
    $dashboardLine = [regex]::Match($updated, '(?m)^export DASHBOARD_URL="([^"]+)"$').Groups[1].Value
    $configLine = [regex]::Match($updated, '(?m)^export REMOTE_CONFIG_URL="([^"]+)"$').Groups[1].Value

    $validation = [pscustomobject]@{
        DashboardKeyCount = ([regex]::Matches($dashboardLine, '([?&])key=')).Count
        DeviceConfigKeyCount = ([regex]::Matches($configLine, '([?&])key=')).Count
        DashboardUrlExact = $dashboardLine -ceq $dashboardUrl
        DeviceConfigUrlExact = $configLine -ceq $configUrl
        DashboardOriginMatches = ([Uri]$dashboardLine).GetLeftPart([UriPartial]::Authority) -eq $canonicalOrigin
        DeviceConfigOriginMatches = ([Uri]$configLine).GetLeftPart([UriPartial]::Authority) -eq $canonicalOrigin
        WidthConfigured = $updated -match '(?m)^export DASHBOARD_EXPECTED_WIDTH=758$'
        HeightConfigured = $updated -match '(?m)^export DASHBOARD_EXPECTED_HEIGHT=1024$'
    }
    if (
        $validation.DashboardKeyCount -ne 1 -or
        $validation.DeviceConfigKeyCount -ne 1 -or
        -not $validation.DashboardUrlExact -or
        -not $validation.DeviceConfigUrlExact -or
        -not $validation.DashboardOriginMatches -or
        -not $validation.DeviceConfigOriginMatches -or
        -not $validation.WidthConfigured -or
        -not $validation.HeightConfigured
    ) {
        throw 'USB update validation failed'
    }
    Remove-Item -LiteralPath $rollbackPath -Force -ErrorAction Stop
    $rollbackRemovedAfterValidation = $true
    . $removeCurrentUsbCredentialResidue
    $validation
} catch {
    $usbValidationFailure = $_
    if (-not $rollbackRemovedAfterValidation) {
        try { . $restoreUsbEnv }
        catch { $usbValidationFailure = $_ }
    }
    throw $usbValidationFailure
} finally {
    . $clearUsbCredentialMemory
    Remove-Variable clearUsbCredentialMemory, removeCurrentUsbCredentialResidue, restoreUsbEnv -ErrorAction SilentlyContinue
}
```

Expected: key counts are 1 and all validation booleans are true. Any validation,
read, cleanup, or rollback error first attempts byte-identical restoration, then
uses the identity-bound global `.new`/`.failed`/`.rollback` inventory to prove
zero residue. A disconnected/replaced volume, malformed/reparse inventory item,
or copy that cannot be removed sets the residue and rotation blockers and can
never be retained for diagnosis. In-memory credential material is cleared in
`finally` on both success and failure.

- [ ] **Step 4: Clear in-memory token material after USB writing**

Run:

```powershell
$privateVariableNames = @(
    'randomBytes', 'originalBytes', 'backupBytes', 'newBytes', 'restoredBytes',
    'viewToken', 'encodedKey', 'dashboardUrl', 'configUrl', 'dashboardLine',
    'configLine', 'text', 'originalText', 'beforeUnmanaged', 'afterUnmanaged', 'updated'
)
$privateVariablesAbsent = @($privateVariableNames | Where-Object {
    Get-Variable -Name $_ -ErrorAction SilentlyContinue
}).Count -eq 0
$privateResidueAbsent = $UsbCredentialResidueAbsenceProven
if (
    -not $InMemoryCredentialMaterialCleared -or
    -not $privateVariablesAbsent -or
    -not $privateResidueAbsent -or
    $UsbCredentialResidueDetected -or
    $UsbViewTokenRotationRequired
) { throw 'USB private-material cleanup gate failed' }
[pscustomobject]@{
    InMemoryCredentialMaterialCleared = $true
    PrivateVariablesAbsent = $true
    UsbCredentialResidueAbsent = $true
    KindleVolumeIdentityAndResidueProof = $true
    UsbViewTokenRotationRequired = $false
}
Remove-Variable getUsbTransactionResidueInventory -ErrorAction SilentlyContinue
```

Expected: only true cleanup booleans and a false rotation flag. This is an
assertion of the Step 2/3 `catch`/`finally` cleanup, not the cleanup mechanism;
an earlier exception must already have cleared memory before rethrowing.

- [ ] **Step 5: Safely eject and perform the first private refresh**

Use Windows safe-eject UI, then KUAL `Start LLM Token Dashboard`.

Expected: a new valid private Dashboard appears; if it fails, keep Vercel protected, use the cached PNG, reconnect USB, and restore/fix the private backup. Do not remove the server token.

### Task 4: Add Fail-Closed Access Resolution Tests

**Files:**
- Modify: `tests/requestAuth.test.mjs:4-24`
- Modify: `tests/dashboardRoute.test.mjs:146-164,228-263`
- Modify: `tests/deviceConfigRoute.test.mjs:21-70`
- Create from the user-approved baseline: `docs/audits/hardening-coverage-baseline.json`

**Interfaces:**
- Consumes: current `authorizeDashboardView(url, expected)` boolean.
- Produces: test contract for `resolveDashboardViewAccess(url, env, { allowLocalFixture }) -> 'authorized' | 'fixture' | 'unauthorized' | 'misconfigured'`.

- [ ] **Step 0a: Commit the approved numeric coverage baseline contract**

Use `apply_patch` to create `docs/audits/hardening-coverage-baseline.json` from the freshly approved Task 1 evidence. Before writing, assert its `head` equals the captured pre-change HEAD. It contains exactly six keys: `head` and `node` as nonempty strings; `tests` as an integer at least 226; and `lines`, `branches`, `functions` as finite numbers from 0 through 100. Add a static test that rejects missing/extra keys, empty strings, test count below 226, or out-of-range metrics. Never invent or round values beyond the two decimals emitted by Node.

- [ ] **Step 0b: Make the existing real Next test reusable as the pre-PR-10 built-start gate**

In `tests/dashboardRoute.test.mjs`, name the current child environment `integrationEnvironment`, then select only the server command from a test flag while preserving `dev` as the default:

```js
const nextCommand = process.env.KINDLE_LLM_NEXT_INTEGRATION_MODE === 'start' ? 'start' : 'dev';
const child = spawn(process.execPath, [
  nextBin,
  nextCommand,
  '--hostname', '127.0.0.1',
  '--port', String(port),
], {
  cwd: process.cwd(),
  env: integrationEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

No production URL or credential is introduced; the existing fixture token remains local to the child process.

- [ ] **Step 1: Replace the public-by-absence unit test with the complete state table**

Add to `tests/requestAuth.test.mjs`:

```js
import {
  authorizeBearer,
  resolveDashboardViewAccess,
} from '../app/api/dashboard/requestAuth.mjs';

test('dashboard view access fails closed and isolates the local fixture', () => {
  const url = new URL('https://x/api/dashboard');
  assert.equal(resolveDashboardViewAccess(url, {}), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(url, { VERCEL_ENV: 'production' }), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(url, { VERCEL_ENV: 'preview' }), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(url, { VERCEL_ENV: 'development' }), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(url, { DASHBOARD_VIEW_TOKEN: 'view' }), 'unauthorized');
  assert.equal(resolveDashboardViewAccess(
    new URL('https://x/api/dashboard?key=view'),
    { DASHBOARD_VIEW_TOKEN: 'view' },
  ), 'authorized');

  const fixtureEnv = { DASHBOARD_PUBLIC_FIXTURE: 'true', NODE_ENV: 'development' };
  assert.equal(resolveDashboardViewAccess(url, fixtureEnv, { allowLocalFixture: true }), 'fixture');
  assert.equal(resolveDashboardViewAccess(url, fixtureEnv), 'misconfigured');
  assert.equal(resolveDashboardViewAccess(
    new URL('https://x/api/dashboard?managed=true'),
    fixtureEnv,
    { allowLocalFixture: true },
  ), 'misconfigured');

  for (const env of [
    { ...fixtureEnv, VERCEL_ENV: 'production' },
    { ...fixtureEnv, VERCEL_ENV: 'preview' },
    { ...fixtureEnv, VERCEL_ENV: 'development' },
    { ...fixtureEnv, NODE_ENV: 'production' },
    { ...fixtureEnv, DASHBOARD_VIEW_TOKEN: 'view' },
  ]) {
    assert.equal(resolveDashboardViewAccess(url, env, { allowLocalFixture: true }), 'misconfigured');
  }
});
```

- [ ] **Step 2: Add handler tests proving storage isolation**

Add to `tests/dashboardRoute.test.mjs`:

```js
test('missing view configuration returns no-store 503 before quota storage', async () => {
  let reads = 0;
  const handler = createDashboardHandler({
    env: {},
    readQuotaSnapshot: async () => { reads += 1; return liveSnapshot(); },
  });
  const response = await handler(new Request('https://dashboard.test/api/dashboard'));
  assert.equal(response.status, 503);
  assert.equal(reads, 0);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
});

test('local fixture renders unmanaged manual data without private reads', async () => {
  let quotaReads = 0;
  let configReads = 0;
  const handler = createDashboardHandler({
    env: { DASHBOARD_PUBLIC_FIXTURE: 'true', NODE_ENV: 'test' },
    readQuotaSnapshot: async () => { quotaReads += 1; throw new Error('private quota read'); },
    readDashboardConfig: async () => { configReads += 1; throw new Error('private config read'); },
  });
  const response = await handler(new Request('https://dashboard.test/api/dashboard?profile=dp75sdi'));
  assert.equal(response.status, 200);
  assert.equal(quotaReads, 0);
  assert.equal(configReads, 0);

  const managed = await handler(new Request('https://dashboard.test/api/dashboard?managed=true'));
  assert.equal(managed.status, 503);
  assert.equal(quotaReads, 0);
  assert.equal(configReads, 0);
});
```

Replace the public device-config test with:

```js
test('device config fails closed without a view token or under fixture mode', async () => {
  for (const env of [
    {},
    { DASHBOARD_PUBLIC_FIXTURE: 'true', NODE_ENV: 'test' },
  ]) {
    let reads = 0;
    const handler = createDeviceConfigHandler({
      env,
      readDashboardConfig: async () => { reads += 1; return storedConfig(); },
    });
    const response = await handler(new Request('https://dashboard.test/api/device-config'));
    assert.equal(response.status, 503);
    assert.equal(reads, 0);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
  }
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
node --test tests/requestAuth.test.mjs tests/deviceConfigRoute.test.mjs tests/dashboardRoute.test.mjs
```

Expected: FAIL because `resolveDashboardViewAccess` is not exported and current handlers allow absent-token reads.

### Task 5: Implement the Access Resolver and Handler Gates

**Files:**
- Modify: `app/api/dashboard/requestAuth.mjs:21-23`
- Modify: `app/api/dashboard/dashboardHandler.mjs:323-345`
- Modify: `app/api/device-config/deviceConfigHandler.mjs:7-21`
- Modify: `tests/dashboardRoute.test.mjs:146-164` test helper
- Modify: `tests/deviceConfigRoute.test.mjs:53-70` authorized fixtures

**Interfaces:**
- Consumes: `safeTokenEqual(actual, expected)`.
- Produces: `resolveDashboardViewAccess()` state machine used by both read handlers.

- [ ] **Step 1: Replace the boolean authorization helper**

Replace `authorizeDashboardView` in `requestAuth.mjs` with:

```js
export function resolveDashboardViewAccess(
  url,
  env = {},
  { allowLocalFixture = false } = {},
) {
  const viewToken = typeof env.DASHBOARD_VIEW_TOKEN === 'string'
    ? env.DASHBOARD_VIEW_TOKEN
    : '';
  const fixtureRequested = env.DASHBOARD_PUBLIC_FIXTURE === 'true';

  if (fixtureRequested) {
    const fixtureAllowed = allowLocalFixture
      && !viewToken
      && !env.VERCEL_ENV
      && env.NODE_ENV !== 'production'
      && url.searchParams.get('managed') !== 'true';
    return fixtureAllowed ? 'fixture' : 'misconfigured';
  }

  if (!viewToken) return 'misconfigured';
  return safeTokenEqual(url.searchParams.get('key'), viewToken)
    ? 'authorized'
    : 'unauthorized';
}
```

- [ ] **Step 2: Gate Dashboard storage and isolate fixture data**

Replace the initial authorization/snapshot portion of `dashboardHandler` with:

```js
const url = new URL(request.url);
const access = resolveDashboardViewAccess(url, env, { allowLocalFixture: true });
if (access === 'misconfigured') {
  return new Response('Service unavailable', {
    status: 503,
    headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
  });
}
if (access === 'unauthorized') {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
  });
}

const snapshot = access === 'fixture' ? null : await readSnapshot();
```

Update the import to `resolveDashboardViewAccess`. Keep managed config reads unchanged; fixture mode has already rejected `managed=true`.

- [ ] **Step 3: Gate device-config with no fixture allowance**

Replace its initial authorization block with:

```js
const url = new URL(request.url);
const access = resolveDashboardViewAccess(url, env);
if (access === 'misconfigured') {
  return new Response('Service unavailable', {
    status: 503,
    headers: { 'Cache-Control': NO_STORE },
  });
}
if (access === 'unauthorized') {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'Cache-Control': NO_STORE },
  });
}
```

Update the import accordingly.

- [ ] **Step 4: Make all existing successful test requests explicitly private**

In `renderFixture`, default `env` to a private token and add the matching key through `URL`:

```js
async function renderFixture({
  snapshot = null,
  env = { DASHBOARD_VIEW_TOKEN: 'fixture-view-token' },
  query = '',
  readDashboardConfig,
  resolvePikachuSrc = () => PIKACHU_DATA_URL,
} = {}) {
  const handler = createDashboardHandler({
    env,
    now: () => FIXED_NOW,
    readQuotaSnapshot: async () => snapshot,
    readDashboardConfig,
    resolvePikachuSrc,
  });
  const url = new URL('https://dashboard.test/api/dashboard');
  for (const [key, value] of new URLSearchParams(query)) url.searchParams.append(key, value);
  if (env.DASHBOARD_VIEW_TOKEN) url.searchParams.set('key', env.DASHBOARD_VIEW_TOKEN);
  const response = await handler(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  return parseGrayscalePng(await response.arrayBuffer());
}
```

For successful device-config tests, set `DASHBOARD_VIEW_TOKEN: 'fixture-view-token'` and add `key=fixture-view-token` to the request.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/requestAuth.test.mjs tests/deviceConfigRoute.test.mjs tests/dashboardRoute.test.mjs
```

Expected: all focused tests pass; no storage reader is invoked for 401/503/fixture isolation cases.

### Task 6: Update Environment and Public Documentation Contracts

**Files:**
- Modify: `.env.example:1-7`
- Modify: `README.md:13-23,79-110`
- Modify: `docs/VERCEL-SETUP.md:7-16,34-46`
- Modify: `docs/SECURITY.md:15-37`
- Modify: `tests/openSourceRelease.test.mjs:79-190`
- Modify: `PROJECT_STATUS.md` only to remove live host/authenticated examples and mark evidence pending

**Interfaces:**
- Consumes: new access-state contract.
- Produces: documentation that cannot imply absent-token public production.

- [ ] **Step 1: Write the documentation contract test**

Add to `tests/openSourceRelease.test.mjs`:

```js
test('public docs require fail-closed view protection and isolate local fixtures', () => {
  const envExample = readFileSync('.env.example', 'utf8');
  const readme = readFileSync('README.md', 'utf8');
  const setup = readFileSync('docs/VERCEL-SETUP.md', 'utf8');
  const security = readFileSync('docs/SECURITY.md', 'utf8');

  assert.match(envExample, /DASHBOARD_VIEW_TOKEN=GENERATE_A_SEPARATE_LONG_RANDOM_SECRET/);
  assert.match(envExample, /# DASHBOARD_PUBLIC_FIXTURE=true/);
  assert.match(readme, /local-only unmanaged fixture/i);
  assert.match(setup, /Production, Preview, and Development/i);
  assert.match(setup, /missing.*503/i);
  assert.match(security, /never.*implicitly.*public/i);
  assert.doesNotMatch(readme, /https:\/\/[^/\s]+\.vercel\.app/);
});
```

- [ ] **Step 2: Run the documentation test and verify RED**

Run:

```powershell
node --test tests/openSourceRelease.test.mjs
```

Expected: FAIL because the current view token is optional and deployable public Demo Mode is documented.

- [ ] **Step 3: Apply exact environment-template changes**

Use:

```text
DASHBOARD_VIEW_TOKEN=GENERATE_A_SEPARATE_LONG_RANDOM_SECRET

# Local `next dev` unmanaged fixture only. Never set this in Vercel.
# DASHBOARD_PUBLIC_FIXTURE=true
```

Document that the fixture cannot use managed mode, Blob, live quota, or device-config and conflicts return 503.

- [ ] **Step 4: Update README, Vercel setup, Security, and status truthfully**

Required wording:

```text
All Vercel environments require DASHBOARD_VIEW_TOKEN. Missing configuration returns 503; a missing or wrong request key returns 401. Public fixture rendering is local-only, explicit, unmanaged, and disconnected from Blob, managed configuration, device configuration, and live quota state.
```

Remove owner-specific production URLs entirely. Tell operators to use the deployment origin returned by `vercel inspect`; do not embed any host in tracked documentation. Do not claim the new tests/deployment passed until their current evidence is collected.

- [ ] **Step 5: Run focused documentation tests**

Run:

```powershell
node --test tests/openSourceRelease.test.mjs tests/requestAuth.test.mjs tests/deviceConfigRoute.test.mjs
```

Expected: PASS.

### Task 7: Verify, Commit, Review, and Merge PR 1

**Files:**
- All files listed in Tasks 4-6 only.

**Interfaces:**
- Consumes: green focused behavior.
- Produces: local commit and, only after user review, pushed PR 1.

- [ ] **Step 1: Run the full local gate**

Run:

```powershell
npm.cmd test
npm.cmd run build
$env:KINDLE_LLM_NEXT_INTEGRATION_MODE = 'start'
try {
    node --test --test-name-pattern="dashboard route consumes two-window provider cards" tests/dashboardRoute.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Built Next integration smoke failed' }
} finally {
    Remove-Item Env:KINDLE_LLM_NEXT_INTEGRATION_MODE -ErrorAction SilentlyContinue
}
node --test --experimental-test-coverage
git diff --check
git status --short
git diff -- app/api/dashboard/requestAuth.mjs app/api/dashboard/dashboardHandler.mjs app/api/device-config/deviceConfigHandler.mjs tests/requestAuth.test.mjs tests/dashboardRoute.test.mjs tests/deviceConfigRoute.test.mjs tests/openSourceRelease.test.mjs docs/audits/hardening-coverage-baseline.json .env.example README.md docs/VERCEL-SETUP.md docs/SECURITY.md PROJECT_STATUS.md
```

Expected: test count is at least the fresh baseline; build passes; no secret, real authenticated URL, `.recovery/`, or unrelated file appears.

- [ ] **Step 2: Commit only the PR 1 allowlist**

Run:

```powershell
git add app/api/dashboard/requestAuth.mjs app/api/dashboard/dashboardHandler.mjs app/api/device-config/deviceConfigHandler.mjs tests/requestAuth.test.mjs tests/dashboardRoute.test.mjs tests/deviceConfigRoute.test.mjs tests/openSourceRelease.test.mjs docs/audits/hardening-coverage-baseline.json .env.example README.md docs/VERCEL-SETUP.md docs/SECURITY.md PROJECT_STATUS.md
git diff --cached --check
git commit -m "Harden private dashboard view access"
```

Expected: one scoped commit; `.recovery/`, the private device file, and backups remain unstaged.

- [ ] **Step 3: Stop for user review before push**

Provide commit SHA, diffstat, focused/full tests, build, coverage, secret scan, and rollback commit.

Expected: explicit user authorization to push and open the PR.

- [ ] **Step 4: Push and open the PR using the GitHub publication workflow**

Run only after authorization:

```powershell
git push -u origin codex/hardening-view-protection
$body = @'
## Summary
- make Vercel read endpoints fail closed when view protection is unconfigured
- isolate the explicit local unmanaged fixture from Blob, config, and live quota state
- update public setup and security documentation

## Verification
- focused authorization and route tests
- full Node test suite
- production build and coverage report
'@
gh pr create --base main --head codex/hardening-view-protection --title "Harden private dashboard view access" --body $body
```

Expected: PR exists; body contains no secret or authenticated URL. If a body file is used, create it with `apply_patch`, not shell redirection.

- [ ] **Step 5: Require all checks and review threads to pass**

Run:

```powershell
gh pr checks --watch
```

Expected: Windows, macOS, Kindle shell, and Vercel preview checks pass; no unresolved P1/P2 review thread remains.

- [ ] **Step 6: Merge only after final user authorization**

Use the approved GitHub merge method, then record the merge SHA. Do not deploy a feature-branch SHA as production.

### Task 8: Verify the Merged Production Contract

**Files:**
- No repository edits unless newly collected evidence is added in the later verification/documentation PR.

**Interfaces:**
- Consumes: canonical production origin, PR 1 merge SHA, and Vercel auto-deployment.
- Produces: alias-bound, double-read-stable, SHA-aligned production fail-closed evidence.

- [ ] **Step 1: Bind the canonical production alias to the exact PR 1 deployment**

Run:

```powershell
$fetchRaw = @(& git fetch origin main 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Unable to refresh Git context' }
$localHeadContext = (& git rev-parse HEAD).Trim().ToLowerInvariant()
$originMainContext = (& git rev-parse origin/main).Trim().ToLowerInvariant()

$prNumber = (Read-Host 'Merged PR 1 number').Trim()
if ($prNumber -notmatch '^\d+$') { throw 'PR number is invalid' }
function Invoke-BoundedJsonNative {
    param(
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [string[]]$Arguments,
        [Parameter(Mandatory)] [int]$MaximumLength,
        [Parameter(Mandatory)] [string]$FailureMessage,
        [AllowNull()] [string]$InputText
    )

    $savedPreference = $ErrorActionPreference
    $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    if ($nativePreference) { $savedNativePreference = $PSNativeCommandUseErrorActionPreference }
    $hadLastExitCode = Test-Path Variable:global:LASTEXITCODE
    if ($hadLastExitCode) { $savedLastExitCode = $global:LASTEXITCODE }
    try {
        $ErrorActionPreference = 'Continue'
        if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $false }
        $global:LASTEXITCODE = $null
        if ($PSBoundParameters.ContainsKey('InputText')) {
            $raw = @($InputText | & $Executable @Arguments 2>$null)
        } else {
            $raw = @(& $Executable @Arguments 2>$null)
        }
        $invocationSucceeded = $?
        $exitCode = $global:LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedPreference
        if ($nativePreference) { $PSNativeCommandUseErrorActionPreference = $savedNativePreference }
        if ($hadLastExitCode) { $global:LASTEXITCODE = $savedLastExitCode }
        else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
    }
    if (-not $invocationSucceeded -or $null -eq $exitCode -or $exitCode -ne 0) {
        throw $FailureMessage
    }
    $text = $raw -join "`n"
    if ($text.Length -lt 2 -or $text.Length -gt $MaximumLength) {
        throw "$FailureMessage (response length invalid)"
    }
    if (-not $text.TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
        throw "$FailureMessage (JSON root is not one object)"
    }
    try { $document = $text | ConvertFrom-Json -NoEnumerate }
    catch { throw "$FailureMessage (invalid JSON)" }
    if ($document -isnot [Management.Automation.PSCustomObject] -or $document -is [Array]) {
        throw "$FailureMessage (JSON root is not one object)"
    }
    return $document
}

function Get-ExactScalarStringProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string]$Name
    )
    if ($Object -isnot [Management.Automation.PSCustomObject] -or $Object -is [Array]) {
        throw 'Expected one JSON object'
    }
    $properties = @($Object.PSObject.Properties | Where-Object Name -CEQ $Name)
    if ($properties.Count -ne 1 -or $properties[0].Value -isnot [string]) {
        throw 'Expected one case-exact scalar string property'
    }
    return $properties[0].Value
}

function Get-ExactJsonObjectProperty {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string]$Name
    )
    if ($Object -isnot [Management.Automation.PSCustomObject] -or $Object -is [Array]) {
        throw 'Expected one JSON object'
    }
    $properties = @($Object.PSObject.Properties | Where-Object Name -CEQ $Name)
    if (
        $properties.Count -ne 1 -or
        $properties[0].Value -isnot [Management.Automation.PSCustomObject] -or
        $properties[0].Value -is [Array]
    ) { throw 'Expected one case-exact JSON object property' }
    return $properties[0].Value
}

$pr = Invoke-BoundedJsonNative `
    -Executable 'gh' `
    -Arguments @('pr', 'view', $prNumber, '--json', 'mergeCommit,state') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to read PR 1 metadata'
$prState = Get-ExactScalarStringProperty $pr 'state'
$mergeCommit = Get-ExactJsonObjectProperty $pr 'mergeCommit'
$mergeSha = (Get-ExactScalarStringProperty $mergeCommit 'oid').ToLowerInvariant()
if ($prState -cne 'MERGED' -or $mergeSha -notmatch '^[0-9a-f]{40}$') {
    throw 'PR 1 is not merged with one exact merge SHA'
}

$originInput = (Read-Host 'Canonical production origin (exact lowercase HTTPS origin)').Trim()
try { $originUri = [Uri]::new($originInput) }
catch { throw 'Canonical production origin is invalid' }
$productionHost = $originUri.DnsSafeHost.ToLowerInvariant()
$ProductionOrigin = "https://$productionHost"
if (
    $originUri.Scheme -ne 'https' -or -not $originUri.IsDefaultPort -or
    $originUri.UserInfo -or $originUri.AbsolutePath -ne '/' -or
    $originUri.Query -or $originUri.Fragment -or
    $productionHost -notmatch '^[a-z0-9.-]+$' -or
    $originInput -cne $ProductionOrigin
) { throw 'Canonical production origin must be one exact lowercase HTTPS origin' }

$linkRaw = Get-Content -LiteralPath '.vercel\project.json' -Raw
if (-not $linkRaw.TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
    throw 'Linked project metadata root is not one JSON object'
}
try { $link = $linkRaw | ConvertFrom-Json -NoEnumerate }
catch { throw 'Linked project metadata is invalid' }
$linkedProjectName = Get-ExactScalarStringProperty $link 'projectName'
$linkedProjectId = Get-ExactScalarStringProperty $link 'projectId'
if ($linkedProjectName -cne 'kindle-llm-dash-1' -or $linkedProjectId -cnotmatch '^prj_[A-Za-z0-9]+$') {
    throw 'Linked project identity is invalid'
}

function Invoke-BoundedVercelApi([string]$Path) {
    Invoke-BoundedJsonNative `
        -Executable 'vercel' `
        -Arguments @('api', $Path, '--raw') `
        -MaximumLength 1048576 `
        -FailureMessage 'Vercel identity API call failed'
}

function Normalize-DeploymentHost([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -cne $Value.Trim()) {
        throw 'Deployment URL metadata contains surrounding whitespace'
    }
    $candidate = $Value
    if ($candidate -cnotmatch '^(?:https://)?(?<host>[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.vercel\.app)/?$') {
        throw 'Deployment URL metadata violates the exact raw origin grammar'
    }
    $rawHost = $Matches.host
    if ($candidate -cnotmatch '^https://') {
        if ($candidate -cmatch '://') { throw 'Deployment URL scheme is invalid' }
        $candidate = "https://$candidate"
    }
    try { $uri = [Uri]::new($candidate) }
    catch { throw 'Deployment URL metadata is invalid' }
    if (
        -not $uri.IsAbsoluteUri -or $uri.Scheme -cne 'https' -or
        -not $uri.IsDefaultPort -or $uri.UserInfo -or
        $uri.AbsolutePath -cne '/' -or $uri.Query -or $uri.Fragment -or
        $uri.DnsSafeHost -cne $rawHost
    ) { throw 'Deployment URL is not one exact HTTPS Vercel origin' }
    return $rawHost
}

function ConvertTo-ExactCanonicalAliasProjection {
    param(
        [Parameter(Mandatory)] $AliasRecord,
        [Parameter(Mandatory)] [string]$ExpectedAlias,
        [Parameter(Mandatory)] [string]$ExpectedProjectId
    )

    $alias = Get-ExactScalarStringProperty $AliasRecord 'alias'
    $aliasProjectId = Get-ExactScalarStringProperty $AliasRecord 'projectId'
    $deploymentId = Get-ExactScalarStringProperty $AliasRecord 'deploymentId'
    $nestedDeployment = Get-ExactJsonObjectProperty $AliasRecord 'deployment'
    $nestedDeploymentId = Get-ExactScalarStringProperty $nestedDeployment 'id'
    $nestedDeploymentUrl = Get-ExactScalarStringProperty $nestedDeployment 'url'
    $redirectProperties = @($AliasRecord.PSObject.Properties | Where-Object Name -CEQ 'redirect')
    if ($redirectProperties.Count -ne 1 -or $null -ne $redirectProperties[0].Value) {
        throw 'Canonical alias must contain one case-exact explicit-null redirect'
    }
    $nestedDeploymentHost = Normalize-DeploymentHost $nestedDeploymentUrl
    if (
        $alias -cne $ExpectedAlias -or
        $aliasProjectId -cne $ExpectedProjectId -or
        $deploymentId -cnotmatch '^dpl_[A-Za-z0-9]+$' -or
        $nestedDeploymentId -cne $deploymentId
    ) { throw 'Canonical alias is not one exact direct linked deployment binding' }

    $binding = [ordered]@{
        Alias = $alias
        ProjectId = $aliasProjectId
        DeploymentId = $deploymentId
        NestedDeploymentId = $nestedDeploymentId
        NestedDeploymentHost = $nestedDeploymentHost
        Redirect = $null
    }
    [pscustomobject]@{
        Alias = $alias
        ProjectId = $aliasProjectId
        DeploymentId = $deploymentId
        NestedDeploymentId = $nestedDeploymentId
        Host = $nestedDeploymentHost
        BindingBytes = [Text.Encoding]::UTF8.GetBytes(($binding | ConvertTo-Json -Compress))
    }
}

function ConvertTo-ExactMergedProductionDeploymentProjection {
    param(
        [Parameter(Mandatory)] $Deployment,
        [Parameter(Mandatory)] [string]$ExpectedDeploymentId,
        [Parameter(Mandatory)] [string]$ExpectedProjectId,
        [Parameter(Mandatory)] [string]$ExpectedSha
    )

    $deploymentId = Get-ExactScalarStringProperty $Deployment 'id'
    $deploymentProjectId = Get-ExactScalarStringProperty $Deployment 'projectId'
    $readyState = Get-ExactScalarStringProperty $Deployment 'readyState'
    $target = Get-ExactScalarStringProperty $Deployment 'target'
    $deploymentUrl = Get-ExactScalarStringProperty $Deployment 'url'
    $meta = Get-ExactJsonObjectProperty $Deployment 'meta'
    $deploymentSha = (Get-ExactScalarStringProperty $meta 'githubCommitSha').ToLowerInvariant()
    $deploymentHost = Normalize-DeploymentHost $deploymentUrl
    if (
        $deploymentId -cne $ExpectedDeploymentId -or
        $deploymentProjectId -cne $ExpectedProjectId -or
        $readyState -cne 'READY' -or
        $target -cne 'production' -or
        $deploymentSha -notmatch '^[0-9a-f]{40}$' -or
        $deploymentSha -cne $ExpectedSha
    ) { throw 'Deployment is not the exact merged READY Production authority' }

    [pscustomobject]@{
        DeploymentId = $deploymentId
        ProjectId = $deploymentProjectId
        ReadyState = $readyState
        Target = $target
        Host = $deploymentHost
        SourceSha = $deploymentSha
    }
}

$escapedHost = [Uri]::EscapeDataString($productionHost)
$aliasFirst = Invoke-BoundedVercelApi "/v4/aliases/$escapedHost"
$aliasFirstProjection = ConvertTo-ExactCanonicalAliasProjection `
    -AliasRecord $aliasFirst `
    -ExpectedAlias $productionHost `
    -ExpectedProjectId $linkedProjectId
$deploymentId = $aliasFirstProjection.DeploymentId
$deployment = Invoke-BoundedVercelApi "/v13/deployments/$deploymentId"
$aliasSecond = Invoke-BoundedVercelApi "/v4/aliases/$escapedHost"
$aliasSecondProjection = ConvertTo-ExactCanonicalAliasProjection `
    -AliasRecord $aliasSecond `
    -ExpectedAlias $productionHost `
    -ExpectedProjectId $linkedProjectId
$deploymentProjection = ConvertTo-ExactMergedProductionDeploymentProjection `
    -Deployment $deployment `
    -ExpectedDeploymentId $deploymentId `
    -ExpectedProjectId $linkedProjectId `
    -ExpectedSha $mergeSha

$firstBinding = $aliasFirstProjection.BindingBytes
$secondBinding = $aliasSecondProjection.BindingBytes
try {
    $aliasBindingStable = [Collections.StructuralComparisons]::StructuralEqualityComparer.Equals(
        $firstBinding,
        $secondBinding
    )
} finally {
    [Array]::Clear($firstBinding, 0, $firstBinding.Length)
    [Array]::Clear($secondBinding, 0, $secondBinding.Length)
}

$aliasFirstHost = $aliasFirstProjection.Host
$aliasSecondHost = $aliasSecondProjection.Host
$deploymentHost = $deploymentProjection.Host
$identityValid =
    $aliasFirstProjection.DeploymentId -ceq $deploymentId -and
    $aliasFirstProjection.NestedDeploymentId -ceq $deploymentId -and
    $aliasSecondProjection.DeploymentId -ceq $deploymentId -and
    $aliasSecondProjection.NestedDeploymentId -ceq $deploymentId -and
    $deploymentProjection.DeploymentId -ceq $deploymentId -and
    $aliasFirstHost -ceq $deploymentHost -and
    $aliasSecondHost -ceq $deploymentHost -and
    $deploymentProjection.SourceSha -ceq $mergeSha -and
    $aliasBindingStable
if (-not $identityValid) { throw 'Canonical alias/deployment/merge identity gate failed' }

[pscustomobject]@{
    PullRequestState = $prState
    MergeSha = $mergeSha
    DeploymentId = $deploymentId
    DeploymentState = $deploymentProjection.ReadyState
    ProductionTarget = $true
    DeploymentSha = $deploymentProjection.SourceSha
    LinkedProjectMatches = $true
    AliasUrlIdAgreement = $true
    AliasBindingStable = $aliasBindingStable
    ShaMatches = $true
    LocalHeadContext = $localHeadContext
    OriginMainContext = $originMainContext
}
```

Expected: do not select the latest deployment-list row. Parse the canonical
production origin to one host, perform exactly alias GET -> deployment GET ->
the same alias GET, and require linked project, alias/nested/deployment URL and
ID agreement, direct/non-redirect aliasing, `READY`, target `production`, exact
`meta.githubCommitSha == PR 1 merge SHA`, and byte-stable selected alias binding
across both reads. All API/CLI bodies and URLs stay in memory; output is limited
to booleans, IDs, state, target, and SHAs. Local `HEAD` and `origin/main` are
moving context only, never production identity gates. This is the same identity
contract later centralized by Phase 4 Task 6.

- [ ] **Step 2: Run the secret-safe production state table**

Load the authorized operator holder without output and clear all byte arrays in `finally`:

```powershell
$operatorSecretPath = Join-Path (Join-Path $env:LOCALAPPDATA 'KindleLLMDashboardOperator') 'view-token.dpapi'
if (-not (Test-Path -LiteralPath $operatorSecretPath -PathType Leaf)) { throw 'Authorized operator holder is missing' }
$entropy = [Text.Encoding]::UTF8.GetBytes('kindle-llm-dash/view-token/v1')
Add-Type -AssemblyName System.Security
$protectedBytes = [IO.File]::ReadAllBytes($operatorSecretPath)
$plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
)
try {
    $viewToken = [Text.Encoding]::UTF8.GetString($plainBytes)
    # Build requests in memory and report only statuses/no-store booleans.
} finally {
    [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
    [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    $viewToken = $null
    Remove-Variable viewToken -ErrorAction SilentlyContinue
}
```

Never place the token in argv. Verify:

```text
missing/wrong key with configured token -> 401
exact key -> 200
Dashboard and device-config Cache-Control -> no-store
temporary missing-token behavior in an isolated preview/unit environment -> 503
```

Do not unset the production token to test 503.

- [ ] **Step 3: Record the rollback point**

The code rollback is the last verified production deployment before PR 1, but
Standard Protection and environment secrets stay configured. If the merged
handler fails, redeploy the previous source SHA with the same view token; never
disable Standard Protection, switch to All Deployments without a reviewed Kindle
bypass, remove the view token, or reopen public reads.

- [ ] **Step 4: Report Phase 0/PR 1 evidence and stop for user approval**

Re-read the Step 0a project setting/bypass audit without PATCH and re-run Step 0b
as a read-only gate, then report only: accepted Standard
Protection enum/category, the three bypass/exception booleans, generated
Production/Preview presence/count/auth-category booleans, Production-only and
final exact scope/type gate booleans, `PrivacyClosureAchieved=True`,
credential-provenance and `RotationRequired` booleans, PR 1 merge SHA,
alias-resolved deployment ID/state/target/SHA and double-read result, production
state-table statuses/no-store booleans, Kindle refresh result, and rollback
deployment/SHA. Never include an origin, generated URL, `Location`, body, token,
cookie, header, or private device path/content.

Expected: stop here. The user explicitly accepts or rejects the Phase 0/PR 1
evidence and any unresolved provenance blocker. A successful merge/deployment
does not authorize Phase 1. If the Production write/redeploy/alias/smoke chain
is not fully proven, record `PrivacyClosureAchieved=False`, do not describe
production as protected, and do not request this approval. If
`RotationRequired=True` or Blob
provenance/server-only placement is unresolved, the immediate privacy closure
may be reported as achieved but Phase 0 remains incomplete and Phase 1 cannot
start until the separately reviewed rotation/evidence task closes the blocker.
