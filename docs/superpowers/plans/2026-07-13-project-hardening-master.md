# Project Hardening Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate the 2026-07-13 user-approved privacy, Kindle, macOS Beta, server, collector, installer, verification, and Ponytail design through isolated pull requests and explicit user checkpoints, after the commit-level safety amendments receive publication re-review.

**Architecture:** This is the orchestration plan for six independently testable subsystem plans. Each subsystem owns its files, regression tests, commit boundary, and rollback; no implementation task may skip ahead across a phase gate.

**Tech Stack:** Git worktrees, Node.js 20.9+, Next.js 16, Node test runner, POSIX shell/BusyBox-compatible Kindle scripts, PowerShell 7, macOS LaunchAgent/Keychain, GitHub Actions, Vercel CLI.

## Global Constraints

- The original design and construction plan was approved on 2026-07-13. The
  commit-level safety amendments in this publication require user re-review
  before the amended plan set becomes the controlling contract. Approval of
  either document does not itself authorize a phase, push, PR, merge,
  environment/deployment mutation, or device/USB mutation.
- The design is `docs/superpowers/specs/2026-07-13-project-hardening-remediation-design.md`.
- Production Dashboard and device-config reads are private and fail closed.
- Project-level Vercel Authentication Standard Protection covers Preview and
  generated Production URLs before any view-token environment write or
  redeployment. The canonical production domain remains on application
  view-token authentication for the Kindle. Never change to All Deployments
  without a separately approved and real-device-validated Kindle bypass design,
  and never create or use a Shareable Link, automation bypass, or Deployment
  Protection Exception.
- View, ingest, and admin tokens are independently generated from at least 32 cryptographically random bytes and never reused; the Blob token is Vercel-issued and server-only.
- Never print, log, commit, place in argv, or include in documentation a token,
  cookie, complete Authorization header, or private Kindle `env.sh`. An
  authenticated URL is never printed, logged, committed, or included in
  documentation, and is also prohibited in argv except for the fixed bounded
  Kindle BusyBox `wget`/device-validated `xh`/`ht` URL operand documented in the
  Kindle plan. That exception requires private `env.sh`, xtrace-off source/use,
  generic logs, a 20-second watchdog boundary, cleanup, and no `/proc` evidence
  capture; it never applies to operator, CI, server, collector, macOS, or Windows
  commands.
- Ingest/admin trusted creation records must prove a CSPRNG, at least 32 random
  bytes, and independent generation. A missing record sets
  `RotationRequired=True` and blocks final completion, although Phase 0 may
  still close immediate public exposure. Blob evidence records only
  Vercel-issued provenance and server-only placement.
- Node.js installers reject versions below 20.9.0.
- macOS remains Beta until a real Mac completes the acceptance sequence.
- `.recovery/`, device backups, private environment files, and unrelated user changes are outside every diff.
- No `git reset --hard`, force push, destructive overwrite, or rollback that reopens public viewing.
- Every behavior change begins with a failing regression test, then the minimal fix and focused verification in a dedicated commit. The complete fixed gate is PR-level: it must pass after all PR commits and before publication/review/merge; no focused-only commit is described as release-ready.
- A feature-branch push is not a production deployment; record local, PR, CI, merge, and Vercel deployment SHAs separately.
- Stop after every phase and obtain user approval before continuing.

## Fixed Gate for Every Pull Request

PR 1 first adds a test-only switch to the existing real Next integration test:

```js
const nextCommand = process.env.KINDLE_LLM_NEXT_INTEGRATION_MODE === 'start' ? 'start' : 'dev';
const nextArguments = [nextBin, nextCommand, '--hostname', '127.0.0.1', '--port', String(port)];
```

The default full suite remains `next dev`. After `npm run build`, every PR from 1 through 9b additionally runs the same test against the built application:

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
$coverageLines = @(& node --test --experimental-test-coverage 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Coverage test run failed' }
$coverageText = $coverageLines -join "`n"
$testsMatch = [regex]::Match($coverageText, '(?m)^.*tests\s+(\d+)\s*$')
$coverageMatch = [regex]::Match($coverageText, '(?m)^.*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|')
if (-not $testsMatch.Success -or -not $coverageMatch.Success) { throw 'Unable to parse Node coverage summary' }
$baseline = Get-Content -LiteralPath docs/audits/hardening-coverage-baseline.json -Raw | ConvertFrom-Json
$current = [pscustomobject]@{
    tests = [int]$testsMatch.Groups[1].Value
    lines = [double]$coverageMatch.Groups[1].Value
    branches = [double]$coverageMatch.Groups[2].Value
    functions = [double]$coverageMatch.Groups[3].Value
}
if (
    $current.tests -lt [Math]::Max(226, [int]$baseline.tests) -or
    $current.lines -lt [double]$baseline.lines -or
    $current.branches -lt [double]$baseline.branches -or
    $current.functions -lt [double]$baseline.functions
) { throw 'Test count or coverage regressed below the approved baseline' }
[pscustomobject]@{ Tests = $current.tests; Lines = $current.lines; Branches = $current.branches; Functions = $current.functions }
git diff --check
```

Record the fresh test count and require at least the 226-test baseline. Run all shell/PowerShell syntax and focused fault-injection gates named by the subsystem plan. Before commit, scan the staged diff for credentials, authenticated URLs, owner-specific production hosts, `.recovery/`, Kindle private state, and device backups without printing any matched secret value. After publication, require independent review, every GitHub CI job, the Vercel preview check when present, and the user's phase approval. PR 10 replaces the test-only built-start command with `npm run smoke:built`; it does not defer built-start coverage until PR 10.

## Plan Set and Ownership

| Plan | Scope | Planned PRs |
| --- | --- | --- |
| `2026-07-13-production-view-protection.md` | Phase 0 operational protection and fail-closed read authorization | 1 |
| `2026-07-13-kindle-runtime-hardening.md` | Bounded PNG download, Wi-Fi ordering, xtrace safety, config version | 2, 4, 9b |
| `2026-07-13-macos-beta-hardening.md` | Absolute executables, Keychain adapter, manifest transaction, Beta docs | 3 |
| `2026-07-13-server-contract-hardening.md` | Prototype names, single-admin config contract, sensitive names | 5, 9a |
| `2026-07-13-collector-installer-hardening.md` | Stale lock, upload acknowledgement, Node gates, Windows rollback | 6, 7, 8 |
| `2026-07-13-verification-release-and-ponytail.md` | Built-app smoke, docs, deployment/device gates, then audit-only Ponytail | 10; Phase 5 report has no PR |

## Per-PR Branch and Worktree Lifecycle

Never continue a merged PR branch. Use this exact mapping:

| PR | Branch | Worktree directory |
| --- | --- | --- |
| 1 | `codex/hardening-view-protection` | `..\kindle-hardening-pr1` |
| 2 | `codex/kindle-download-hardening` | `..\kindle-hardening-pr2` |
| 3 | `codex/macos-beta-hardening` | `..\kindle-hardening-pr3` |
| 4 | `codex/kindle-runtime-correctness` | `..\kindle-hardening-pr4` |
| 5 | `codex/server-profile-config-contracts` | `..\kindle-hardening-pr5` |
| 6 | `codex/collector-stale-lock-hardening` | `..\kindle-hardening-pr6` |
| 7 | `codex/collector-upload-ack-contract` | `..\kindle-hardening-pr7` |
| 8 | `codex/installer-prerequisites-rollback` | `..\kindle-hardening-pr8` |
| 9a | `codex/schema-sensitive-fields` | `..\kindle-hardening-pr9a` |
| 9b | `codex/kindle-device-config-v1` | `..\kindle-hardening-pr9b` |
| 10 | `codex/verification-documentation` | `..\kindle-hardening-pr10` |

Phase 5's first Ponytail deliverable is deliberately absent from this table: it is one untracked report in a clean detached audit worktree at the approved PR 10 SHA, with no branch, commit, push, or PR. Only a later user-selected simplification receives its own newly planned branch/PR.

Before each PR, first verify the preceding PR is merged and every required check is green. Then run from the canonical repository, substituting only the approved table row:

```powershell
git fetch origin main
$canonicalStatus = @(git status --porcelain)
$unexpectedCanonical = @($canonicalStatus | Where-Object { $_ -ne '?? .recovery/' })
if ($unexpectedCanonical.Count -ne 0) { throw 'Canonical worktree differs from the approved .recovery-only baseline' }
$originMain = git rev-parse origin/main
if (Test-Path -LiteralPath $worktreePath) { throw 'Planned worktree path already exists' }
git show-ref --verify --quiet "refs/heads/$branchName"
$branchCheck = $LASTEXITCODE
if ($branchCheck -eq 0) { throw 'Planned branch already exists' }
if ($branchCheck -ne 1) { throw 'Unable to inspect planned branch state' }
git worktree add -b $branchName $worktreePath origin/main
if ($LASTEXITCODE -ne 0) { throw 'Unable to create isolated PR worktree' }
Push-Location $worktreePath
if ((git rev-parse HEAD) -ne $originMain) { throw 'PR did not start at latest origin/main' }
if ((git status --porcelain).Count -ne 0) { throw 'New PR worktree is dirty' }
Pop-Location
```

At the next phase checkpoint, report the branch, base SHA, allowlist, PR head, merge SHA, and worktree status separately. Remove an old worktree only after merge and only when `git -C $worktreePath status --porcelain` is empty; never use `--force`. Existing `.recovery/` in the canonical worktree is the only recorded pre-existing exclusion after the approved plans are committed, so the initial canonical cleanliness check compares against that exact baseline rather than deleting it.

---

### Task 0: Publish the User-Approved Plan Set Before Implementation

**Files:**
- Add only the approved design and seven `2026-07-13-*` plan files under `docs/superpowers/`.
- Exclude `.recovery/` and every product/test/environment/device file.

**Interfaces:**
- Consumes: explicit user approval of this complete plan set.
- Produces: a docs-only merged planning commit so every later worktree contains the controlling contract.

- [ ] **Step 1: Verify the review worktree has only the known untracked plan set**

Require `git status --short` to contain exactly `.recovery/`, the approved spec, and the seven plan files. Compare each plan path to the list in this master; any product/test or extra path stops publication.

- [ ] **Step 2: Create a docs-only branch and commit only the allowlist**

```powershell
git switch -c codex/hardening-plan-publication origin/main
git add docs/superpowers/specs/2026-07-13-project-hardening-remediation-design.md docs/superpowers/plans/2026-07-13-project-hardening-master.md docs/superpowers/plans/2026-07-13-production-view-protection.md docs/superpowers/plans/2026-07-13-kindle-runtime-hardening.md docs/superpowers/plans/2026-07-13-macos-beta-hardening.md docs/superpowers/plans/2026-07-13-server-contract-hardening.md docs/superpowers/plans/2026-07-13-collector-installer-hardening.md docs/superpowers/plans/2026-07-13-verification-release-and-ponytail.md
git diff --cached --check
git diff --cached --name-only
git commit -m "Document project hardening execution plan"
```

Expected: the cached path list is exactly eight documents; `.recovery/` remains untracked and unstaged.

- [ ] **Step 3: Stop for publication authorization**

Report the docs-only commit SHA/diffstat. Push, open the docs-only PR, and merge only after explicit authorization. Then update canonical `main` to the merge SHA without force/reset. This governance PR is not implementation PR 1 and performs no environment, Kindle, product, test, or deployment mutation.

---

### Task 1: Freeze Execution Authority and Baseline

**Files:**
- Read: `AGENTS.md`
- Read: `PROJECT_STATUS.md`
- Read: `README.md`
- Read: `package.json`
- Read: `docs/superpowers/specs/2026-07-13-project-hardening-remediation-design.md`
- Read: all six plans listed above

**Interfaces:**
- Consumes: the user-approved design and the latest canonical repository/deployment state.
- Produces: a secret-free baseline record containing repository, branch, HEAD, origin/main, dirty paths, linked Vercel project, production deployment ID/state/SHA when available, and current test/build results.

- [ ] **Step 1: Re-read project authority files**

Run:

```powershell
Get-Content -LiteralPath AGENTS.md -ErrorAction SilentlyContinue
Get-Content -LiteralPath PROJECT_STATUS.md
Get-Content -LiteralPath README.md
Get-Content -LiteralPath package.json
Get-Content -LiteralPath docs/superpowers/specs/2026-07-13-project-hardening-remediation-design.md
```

Expected: no project rule contradicts the approved design; if one does, stop and ask the user to resolve the authority conflict.

- [ ] **Step 2: Re-resolve canonical Git state**

Run:

```powershell
$fetchOutput = @(& git fetch origin main 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Unable to refresh canonical Git state' }

$remoteOutput = @(& git remote get-url origin 2>&1)
if ($LASTEXITCODE -ne 0 -or $remoteOutput.Count -ne 1) { throw 'Unable to resolve one origin remote' }
try { $remoteUri = [Uri]::new(([string]$remoteOutput[0]).Trim()) }
catch { throw 'Origin remote is not a valid URI' }
$remotePath = $remoteUri.AbsolutePath.TrimEnd('/')
$canonicalRemote = $remoteUri.IsAbsoluteUri -and
    $remoteUri.Scheme -eq 'https' -and
    $remoteUri.IsDefaultPort -and
    -not $remoteUri.UserInfo -and
    -not $remoteUri.Query -and
    -not $remoteUri.Fragment -and
    $remoteUri.DnsSafeHost -eq 'github.com' -and
    $remotePath -in @(
        '/pcedison/kindle-LLM-token-display',
        '/pcedison/kindle-LLM-token-display.git'
    )
if (-not $canonicalRemote) { throw 'Origin does not match the canonical repository contract' }

$branch = (& git branch --show-current).Trim()
$head = (& git rev-parse HEAD).Trim().ToLowerInvariant()
$originMain = (& git rev-parse origin/main).Trim().ToLowerInvariant()
$status = @(& git status --porcelain=v1)
$recoveryOnly = $status.Count -eq 1 -and $status[0] -eq '?? .recovery/'
if (-not $recoveryOnly) {
    throw 'Canonical worktree differs from the approved .recovery-only baseline'
}

[pscustomobject]@{
    CanonicalRemoteMatches = $canonicalRemote
    Branch = $branch
    Head = $head
    OriginMain = $originMain
    DirtyLineCount = $status.Count
    RecoveryOnly = $recoveryOnly
}
```

Expected: only the fixed boolean, branch, SHAs, and count are printed. The raw
remote URL and fetch/status output stay in memory, the remote is rejected if it
contains userinfo/query/fragment or differs from the canonical repository, and
the existing `.recovery/` directory is not touched. Record current SHAs rather
than assuming `61632d4`.

- [ ] **Step 3: Re-resolve Vercel linkage and production state without values**

Run:

```powershell
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Baseline collection requires PowerShell 7 or later'
}
$linkRaw = Get-Content -LiteralPath .vercel/project.json -Raw
if (-not $linkRaw.TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
    throw 'Linked Vercel project metadata root is not one JSON object'
}
try { $link = $linkRaw | ConvertFrom-Json -NoEnumerate }
catch { throw 'Linked Vercel project metadata is invalid' }
if ($link -isnot [Management.Automation.PSCustomObject] -or $link -is [Array]) {
    throw 'Linked Vercel project metadata is not one JSON object'
}
$linkNameProperties = @($link.PSObject.Properties | Where-Object Name -CEQ 'projectName')
$linkIdProperties = @($link.PSObject.Properties | Where-Object Name -CEQ 'projectId')
if (
    $linkNameProperties.Count -ne 1 -or $linkNameProperties[0].Value -isnot [string] -or
    $linkIdProperties.Count -ne 1 -or $linkIdProperties[0].Value -isnot [string]
) { throw 'Linked Vercel project metadata requires case-exact scalar string identity fields' }
$linkedProjectName = $linkNameProperties[0].Value
$linkedProjectId = $linkIdProperties[0].Value
if (
    $linkedProjectName -cne 'kindle-llm-dash-1' -or
    $linkedProjectId -cnotmatch '^prj_[A-Za-z0-9]+$'
) {
    throw 'Linked Vercel project does not match the canonical project contract'
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
    return Write-Output -NoEnumerate $document
}

function Get-StrictEnvironmentMetadataProjection {
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

    $requiredNames = @('createdAt', 'key', 'target', 'type', 'updatedAt')
    $allowedNames = @(
        'configurationId', 'createdAt', 'gitBranch', 'key',
        'target', 'type', 'updatedAt', 'value'
    )
    $knownTypes = @('plain', 'encrypted', 'sensitive', 'system')
    foreach ($row in $envsProperties[0].Value) {
        if ($row -isnot [Management.Automation.PSCustomObject] -or $row -is [Array]) {
            throw 'Environment metadata row is not one JSON object'
        }
        $rowNames = @($row.PSObject.Properties | ForEach-Object Name)
        if (@($rowNames | Where-Object { $_ -cnotin $allowedNames }).Count -ne 0) {
            throw 'Environment metadata row contains an unknown property'
        }
        foreach ($requiredName in $requiredNames) {
            if (@($row.PSObject.Properties | Where-Object Name -CEQ $requiredName).Count -ne 1) {
                throw 'Environment metadata row is missing a required case-exact property'
            }
        }

        $key = @($row.PSObject.Properties | Where-Object Name -CEQ 'key')[0].Value
        $type = @($row.PSObject.Properties | Where-Object Name -CEQ 'type')[0].Value
        $targetValue = @($row.PSObject.Properties | Where-Object Name -CEQ 'target')[0].Value
        $created = @($row.PSObject.Properties | Where-Object Name -CEQ 'createdAt')[0].Value
        $updated = @($row.PSObject.Properties | Where-Object Name -CEQ 'updatedAt')[0].Value
        $valueProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'value')
        $branchProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'gitBranch')
        $configurationProperties = @($row.PSObject.Properties | Where-Object Name -CEQ 'configurationId')
        if (
            $key -isnot [string] -or [string]::IsNullOrWhiteSpace($key) -or $key -cne $key.Trim() -or
            $type -isnot [string] -or $type -cnotin $knownTypes -or
            $targetValue -isnot [Array] -or $targetValue.Count -eq 0 -or
            $created -isnot [Int64] -or $updated -isnot [Int64] -or
            $valueProperties.Count -gt 1 -or
            $branchProperties.Count -gt 1 -or
            $configurationProperties.Count -gt 1
        ) { throw 'Environment metadata row contains a malformed scalar or array field' }
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

        $targets = @($targetValue)
        $seenTargets = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($target in $targets) {
            if (
                $target -isnot [string] -or [string]::IsNullOrWhiteSpace($target) -or
                $target -cne $target.Trim() -or -not $seenTargets.Add($target)
            ) { throw 'Environment metadata target array is malformed or duplicated' }
        }
        [pscustomobject]@{
            Name = $key
            Scopes = (@($targets | Sort-Object -CaseSensitive) -join ',')
            ScopeCount = $targets.Count
            Type = $type
            GitBranchBound = $branchProperties.Count -eq 1
            ConfigurationBound =
                $configurationProperties.Count -eq 1 -and
                $null -ne $configurationProperties[0].Value
        }
    }
}

$validEnvProbeJson = @(
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","type":"sensitive","target":["production"],"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"PUBLIC_LABEL","value":"synthetic","type":"plain","target":["custom-environment"],"gitBranch":"feature/probe","createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"SYSTEM_PROBE","type":"system","target":["custom-environment"],"configurationId":"env_probe","createdAt":1700000000000,"updatedAt":1700000000001}]}'
)
$validEnvProbes = @($validEnvProbeJson | ForEach-Object {
    Get-StrictEnvironmentMetadataProjection ($_ | ConvertFrom-Json -NoEnumerate)
})
if (
    $validEnvProbes.Count -ne $validEnvProbeJson.Count -or
    @($validEnvProbes | Where-Object {
        @($_.PSObject.Properties | Where-Object Name -CEQ 'Value').Count -ne 0
    }).Count -ne 0
) { throw 'Strict environment valid probes failed or projected a plain value' }
$malformedEnvProbeJson = @(
    '{"envs":{"key":"DASHBOARD_VIEW_TOKEN"}}',
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","type":["sensitive"],"target":["production"],"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","type":"sensitive","target":"production","createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"DASHBOARD_VIEW_TOKEN","value":"synthetic","type":"sensitive","target":["production"],"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"PUBLIC_LABEL","type":"plain","target":["custom-environment"],"createdAt":1700000000000,"updatedAt":1700000000001}]}',
    '{"envs":[{"key":"UNKNOWN_PROBE","type":"encrypted","target":["preview"],"unknown":true,"createdAt":1700000000000,"updatedAt":1700000000001}]}'
)
$malformedEnvProbesRejected = 0
foreach ($probeJson in $malformedEnvProbeJson) {
    try {
        Get-StrictEnvironmentMetadataProjection `
            ($probeJson | ConvertFrom-Json -NoEnumerate) | Out-Null
    } catch { $malformedEnvProbesRejected++ }
}
if ($malformedEnvProbesRejected -ne $malformedEnvProbeJson.Count) {
    throw 'Strict environment malformed-shape probes did not all fail closed'
}

$envDocument = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('env', 'list', '--format=json') `
    -MaximumLength 4194304 `
    -FailureMessage 'Unable to read Vercel environment metadata'
$envProjection = @(Get-StrictEnvironmentMetadataProjection $envDocument)

$projectDocument = Invoke-BoundedJsonNative `
    -Executable 'vercel' `
    -Arguments @('api', "/v9/projects/$linkedProjectId", '--raw') `
    -MaximumLength 1048576 `
    -FailureMessage 'Unable to read exact Vercel project target metadata'
function Get-StrictProductionTargetProjection {
    param(
        [Parameter(Mandatory)] $ProjectDocument,
        [Parameter(Mandatory)] [string]$ExpectedProjectId
    )

    if ($ProjectDocument -isnot [Management.Automation.PSCustomObject] -or $ProjectDocument -is [Array]) {
        throw 'Vercel project metadata is not one JSON object'
    }
    $projectIdProperties = @($ProjectDocument.PSObject.Properties | Where-Object Name -CEQ 'id')
    if (
        $projectIdProperties.Count -ne 1 -or
        $projectIdProperties[0].Value -isnot [string] -or
        $projectIdProperties[0].Value -cne $ExpectedProjectId
    ) { throw 'Vercel project API identity mismatch' }

    $targetsProperties = @($ProjectDocument.PSObject.Properties | Where-Object Name -CEQ 'targets')
    if (
        $targetsProperties.Count -ne 1 -or
        $targetsProperties[0].Value -isnot [Management.Automation.PSCustomObject] -or
        $targetsProperties[0].Value -is [Array]
    ) { throw 'Project metadata does not contain one targets object' }
    $targetsObject = $targetsProperties[0].Value

    $productionProperties = @($targetsObject.PSObject.Properties | Where-Object Name -CEQ 'production')
    if (
        $productionProperties.Count -ne 1 -or
        $productionProperties[0].Value -isnot [Management.Automation.PSCustomObject] -or
        $productionProperties[0].Value -is [Array]
    ) { throw 'Project metadata does not contain one production target' }
    $productionTarget = $productionProperties[0].Value

    $metaProperties = @($productionTarget.PSObject.Properties | Where-Object Name -CEQ 'meta')
    if (
        $metaProperties.Count -ne 1 -or
        $metaProperties[0].Value -isnot [Management.Automation.PSCustomObject] -or
        $metaProperties[0].Value -is [Array]
    ) { throw 'Production target metadata does not contain one meta object' }
    $metaObject = $metaProperties[0].Value

    $productionIdProperties = @($productionTarget.PSObject.Properties | Where-Object Name -CEQ 'id')
    $productionStateProperties = @($productionTarget.PSObject.Properties | Where-Object Name -CEQ 'readyState')
    $productionTargetNameProperties = @($productionTarget.PSObject.Properties | Where-Object Name -CEQ 'target')
    $productionShaProperties = @($metaObject.PSObject.Properties | Where-Object Name -CEQ 'githubCommitSha')
    foreach ($requiredProperty in @(
        @{ Name = 'id'; Properties = $productionIdProperties },
        @{ Name = 'readyState'; Properties = $productionStateProperties },
        @{ Name = 'target'; Properties = $productionTargetNameProperties },
        @{ Name = 'githubCommitSha'; Properties = $productionShaProperties }
    )) {
        $propertySet = @($requiredProperty.Properties)
        if ($propertySet.Count -ne 1 -or $propertySet[0].Value -isnot [string]) {
            throw 'Production target metadata requires case-exact scalar string fields'
        }
    }

    $productionId = $productionIdProperties[0].Value
    $productionState = $productionStateProperties[0].Value
    $productionTargetName = $productionTargetNameProperties[0].Value
    $productionSha = $productionShaProperties[0].Value.ToLowerInvariant()
    if (
        $productionId -cnotmatch '^dpl_[A-Za-z0-9]+$' -or
        $productionState -cne 'READY' -or
        $productionTargetName -cne 'production' -or
        $productionSha -notmatch '^[0-9a-f]{40}$'
    ) { throw 'Exact Vercel production target metadata is incomplete or invalid' }

    [pscustomobject]@{
        ProjectMatches = $true
        DeploymentId = $productionId
        State = $productionState
        Target = $productionTargetName
        GitHubCommitSha = $productionSha
    }
}

$validProbeJson = '{"id":"prj_probe","targets":{"production":{"id":"dpl_probe","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}'
$validProbe = Get-StrictProductionTargetProjection `
    -ProjectDocument ($validProbeJson | ConvertFrom-Json -NoEnumerate) `
    -ExpectedProjectId 'prj_probe'
if (-not $validProbe.ProjectMatches) { throw 'Strict production-target valid probe failed' }
$malformedProbeJson = @(
    '[{"id":"prj_probe","targets":{"production":{"id":"dpl_probe","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}]',
    '{"id":"prj_probe","targets":[{"production":{"id":"dpl_probe","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}]}',
    '{"id":"prj_probe","targets":{"production":[{"id":"dpl_probe","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}]}}',
    '{"id":"prj_probe","targets":{"production":{"id":"dpl_probe","readyState":"READY","target":"production","meta":[{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}}}',
    '{"id":"prj_probe","targets":{"production":{"id":["dpl_probe"],"readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}',
    '{"id":"prj_probe","targets":{"production":{"id":"dpl_probe","readyState":["READY"],"target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}',
    '{"id":"prj_probe","targets":{"production":{"id":"dpl_probe","readyState":"READY","target":["production"],"meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}',
    '{"id":"prj_probe","targets":{"production":{"id":"dpl_probe","readyState":"READY","target":"production","meta":{"githubCommitSha":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}}}}',
    '{"id":"prj_probe","targets":{"Production":{"id":"dpl_probe","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}',
    '{"id":"prj_probe","targets":{"production":{"id":"dpl_probe/extra","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}',
    '{"id":"prj_probe","targets":{"production":{"id":"dpl_probe?x=1","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}',
    '{"id":"prj_probe","targets":{"production":{"id":"dpl_probe space","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}',
    '{"id":"prj_probe","targets":{"production":{"id":"DPL_probe","readyState":"READY","target":"production","meta":{"githubCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}'
)
$malformedRejected = 0
foreach ($probeJson in $malformedProbeJson) {
    try {
        Get-StrictProductionTargetProjection `
            -ProjectDocument ($probeJson | ConvertFrom-Json -NoEnumerate) `
            -ExpectedProjectId 'prj_probe' | Out-Null
    } catch { $malformedRejected++ }
}
if ($malformedRejected -ne $malformedProbeJson.Count) {
    throw 'Strict production-target malformed-shape probes did not all fail closed'
}
$productionProjection = Get-StrictProductionTargetProjection `
    -ProjectDocument $projectDocument `
    -ExpectedProjectId $linkedProjectId
$autoAssignProperties = @($projectDocument.PSObject.Properties | Where-Object Name -CEQ 'autoAssignCustomDomains')
if ($autoAssignProperties.Count -ne 1 -or $autoAssignProperties[0].Value -isnot [bool]) {
    throw 'Project auto-assignment baseline is not one exact Boolean'
}
$rollbackProperties = @($projectDocument.PSObject.Properties | Where-Object Name -CEQ 'lastRollbackTarget')
if ($rollbackProperties.Count -ne 1) { throw 'Project rollback-marker baseline is missing' }
$rollbackValue = $rollbackProperties[0].Value
if (
    $null -ne $rollbackValue -and
    ($rollbackValue -isnot [Management.Automation.PSCustomObject] -or $rollbackValue -is [Array])
) { throw 'Project rollback-marker baseline has an invalid shape' }
$promotionControlProjection = [pscustomobject]@{
    AutoAssignCustomDomains = $autoAssignProperties[0].Value
    RollbackMarkerPresent = $null -ne $rollbackValue
}

[pscustomobject]@{
    LinkedProjectMatches = $true
    LinkedProjectId = $linkedProjectId
}
$envProjection
$productionProjection
$promotionControlProjection
[pscustomobject]@{
    ValidEnvironmentProbesAccepted = $validEnvProbes.Count
    MalformedEnvironmentProbesRejected = $malformedEnvProbesRejected
    ValidProductionTargetProbeAccepted = $true
    MalformedProductionTargetProbesRejected = $malformedRejected
}
```

Expected: raw linkage, environment, and project API JSON is captured before
parsing and never printed. Environment metadata must follow the official
required/optional property allowlist with exact object/scalar/array types;
`plain`/`system`, branch/configuration bindings, and custom targets are accepted
only in their documented shapes. Plain values may be present in CLI JSON but are
never projected or printed, and no decrypt/readback is requested. The valid and
malformed environment probes must pass their exact categories. Production
authority comes only from the exact linked
project's `targets.production`, hard-requiring one strictly shaped linked-project
object, a full-match bounded project ID, matching project identity, one
full-match bounded `dpl_` deployment ID, `READY`, target `production`, and one
scalar 40-character SHA.
`targets`, `production`, and `meta` must each be one non-array object; every
case-exact ID/state/target/SHA field must be a scalar string. The valid synthetic
probe must pass and all malformed object/array/case probes must fail. Baseline
also records the exact Boolean `autoAssignCustomDomains` and only the presence
category of a null-or-object `lastRollbackTarget`; it does not infer that a false
Boolean was necessarily caused by rollback. No list row, alias, URL, or raw body
is authority or output. Output is limited to
fixed booleans/IDs, environment names/scopes/types, and production
ID/state/target/SHA. Parse or shape failure stops generically.
If baseline reports `AutoAssignCustomDomains=False` or
`RollbackMarkerPresent=True`, record the state without diagnosing its cause.
Phase 0 may proceed only when the maintenance approval explicitly accepts the
conditional exact-candidate promotion and its lasting restoration of automatic
production-domain assignment.

- [ ] **Step 4: Create an isolated execution worktree**

Use the `using-git-worktrees` skill at execution time. Create the first branch from the freshly fetched `origin/main`:

```powershell
git worktree add ..\kindle-hardening-pr1 -b codex/hardening-view-protection origin/main
```

Expected: the new worktree is clean and does not contain `.recovery/`. If the branch already exists, stop and inspect it; do not delete or overwrite it.

- [ ] **Step 5: Establish a fresh verification baseline**

Run in the worktree:

```powershell
npm.cmd ci
npm.cmd run build
$coverageLines = @(& node --test --experimental-test-coverage 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Baseline test/coverage run failed' }
$coverageText = $coverageLines -join "`n"
$testsMatch = [regex]::Match($coverageText, '(?m)^.*tests\s+(\d+)\s*$')
$coverageMatch = [regex]::Match($coverageText, '(?m)^.*all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|')
if (-not $testsMatch.Success -or -not $coverageMatch.Success) { throw 'Unable to parse baseline coverage summary' }
[pscustomobject]@{
    tests = [int]$testsMatch.Groups[1].Value
    lines = [double]$coverageMatch.Groups[1].Value
    branches = [double]$coverageMatch.Groups[2].Value
    functions = [double]$coverageMatch.Groups[3].Value
}
git diff --check
```

Expected: tests and build pass; capture the exact four numeric values. After the user approves this checkpoint, PR 1 uses `apply_patch` to create `docs/audits/hardening-coverage-baseline.json` with exactly the keys `head`, `node`, `tests`, `lines`, `branches`, and `functions`, populated from this run. Every PR reads that committed file and fails on any lower test count or metric. If the historical 226-test baseline is not green, stop and diagnose before any remediation.

- [ ] **Step 6: Record the no-write checkpoint**

Report:

```text
Baseline only; no product changes, environment writes, Kindle writes, commit, push, PR, or deployment performed.
```

Expected: user confirms the baseline before Phase 0 begins.

### Task 2: Execute Phase 0 and PR 1

**Files:**
- Follow: `docs/superpowers/plans/2026-07-13-production-view-protection.md`

**Interfaces:**
- Consumes: the approved baseline and a user-authorized production/USB maintenance window.
- Produces: a new or prepared-resume Production-only token write, exact
  canonical pre-redeploy authority, an exact READY/SHA candidate when needed,
  conditional promotion with strict post-state proof, and canonical `401/200`
  proof, then protected non-production scopes, authenticated Kindle URLs, and
  merged PR 1 with missing-token fail-closed behavior.

- [ ] **Step 1: Execute only the Phase 0 operational tasks**

Follow Tasks 1-3 of `2026-07-13-production-view-protection.md` exactly.

Expected: Standard Protection's strict object shape and current-write or
compatibility-read enum are re-verified before any view-token environment write;
compatibility is acceptable only after every discoverable generated
Production/Preview URL is found by bounded full pagination through an explicit
null terminal cursor and passes the exact redirects-disabled Authentication
gate. Fresh strict project reads must bracket that enumeration with the same
case-exact accepted protection category/enum; a disabled/malformed post-read or
drift fails closed. Malformed/repeated cursors or URLs and a reached safety cap fail closed.
No bypass/exception exists. Only Production is written first. Before redeploy,
canonical alias GET → deployment API GET → alias GET freezes the exact stable
READY Production ID/host/SHA authority; no recent-list row is authority or a
required cross-check. A read-only preflight reuses only an already-private,
auto-assignment-restored, unpinned canonical state. Legacy-public or
private-but-pinned state creates one distinct candidate and verifies it through
the exact deployment API. A stable alias already on that candidate with closed
project state skips promotion; a stable alias still on the frozen prior ID runs
`vercel promote` for the exact candidate; any third ID or unstable binding
stops. `--target production` is not promotion. The authorized maintenance
contract explicitly accepts that promote restores lasting production-domain
auto-assignment. Fresh post-state must prove the candidate via alias/API/alias,
`autoAssignCustomDomains=True`, null rollback marker, and exact
`targets.production` candidate ID/SHA; CLI output/exit is not authority.
Anonymous canonical Dashboard/device-config requests return 401 and exact-token requests return 200;
and only after `PrivacyClosureAchieved=True` are Preview and Development written
and exact scope/type coverage proved. A failed Production write, redeploy, alias,
or smoke gate records `PrivacyClosureAchieved=False`, cannot be called protected,
and cannot reach this approval or the PR 1 authorization checkpoint. The Kindle
uses its cached PNG until USB migration completes. The USB transaction captures
the Kindle volume identity, rejects reparse roots, inventories every
historical/current `env.sh.new.*`/`env.sh.failed.*`/`env.sh.rollback.*`, removes
only current-run credential copies, and re-proves the mounted identity plus zero
global residue on every exit. Disconnect or inventory error is not absence.
In-memory token material is cleared in `finally`, and no transaction copy is
preserved as diagnostic evidence. An unproved identity/residue state sets
`UsbCredentialResidueDetected=True`, requires view-token rotation, records
`Phase0Complete=False`, and stops before acceptance. Environment metadata is
first projected through the official exact required/optional field schema;
plain values are never projected or printed, and view-token rows reject
branch/custom bindings, coercion, nonstandard targets, wrong types, and duplicate
scopes. Zero
scopes plus no holder is
new provisioning; zero scopes plus a confirmed same-run holder is
`ResumePrepared`, which loads rather than regenerates and writes Production
once. Other fresh resumes accept only exact Production, Production+Preview, or
all-three typed metadata with that holder. Every resume re-runs canonical
pre-authority and post-state/`401/200` proof before closure. A completed
interrupted promotion is detected read-only and does not redeploy; unresolved
public/pinned state follows the same distinct-candidate path. No local
deployment checkpoint is trusted. Only the missing non-production suffix is
written after closure.

- [ ] **Step 2: Stop for Phase 0 operational approval**

Provide the accepted Standard Protection write/compatibility category,
bypass/exception booleans, generated-URL presence/count/result categories,
run-mode and exact pre-/final-scope gates, `PrivacyClosureAchieved=True`,
credential-provenance/rotation booleans, pre-canonical authority and post-alias deployment ID/identity
booleans, pre/post auto-assignment and rollback-marker categories, candidate
action, promotion attempted/skipped and CLI-exit category, canonical smoke
statuses, private-backup location category, and Kindle
refresh result, `UsbCredentialResidueDetected`,
`KindleVolumeIdentityAndResidueProof`,
`InMemoryCredentialMaterialCleared`, and any resulting rotation blocker without
any secret, URL, `Location`, body, authenticated request, or credential-bearing
file content. If closure is false, the final scope gate is incomplete, USB
residue absence is unproved, or in-memory cleanup is false, report the bounded
resume/rotation state and stop before requesting approval.

Expected: user explicitly authorizes repository PR 1 only after the operational
report proves `PrivacyClosureAchieved=True`, final scope/type coverage, and a
successful Kindle migration. Standard Protection is retained; this plan never
automatically enables All Deployments.

- [ ] **Step 3: Execute and merge PR 1**

Follow the remaining tasks in `2026-07-13-production-view-protection.md`.

Expected: fail-closed authorization and explicit local fixture isolation are merged, CI is green, production deployment SHA equals the merge SHA, and production remains private.

- [ ] **Step 4: Stop for the PR 1 production checkpoint**

Report the exact PR 1 merge SHA, alias-resolved deployment ID/state/target/SHA
proof, project-level Standard Protection and generated-URL gates, exact
view-token scope/type gates, `PrivacyClosureAchieved=True`, production state-table
results, rollback point, Kindle result, and any `RotationRequired=True`
provenance blocker. Then stop.

Expected: the user explicitly accepts or rejects the Phase 0/PR 1 production
evidence. Phase 1 is not authorized by a merge or successful deployment and may
not begin without this separate approval. `PrivacyClosureAchieved` may be true
only after the Production write/redeploy/alias/canonical-smoke chain. If that
chain fails, record `PrivacyClosureAchieved=False`, do not describe production as
protected, and do not request this approval. If credential evidence still
reports `RotationRequired=True` or a Blob provenance/placement blocker after
privacy closure, record `PrivacyClosureAchieved=True` but `Phase0Complete=False`;
the separately reviewed rotation/evidence task must close that blocker before
Phase 1. The same stop applies when USB credential-residue cleanup cannot be
proved; a `.failed` credential copy is never an allowed diagnostic artifact.

### Task 3: Execute Phase 1 P1 Pull Requests

**Files:**
- Follow: `docs/superpowers/plans/2026-07-13-kindle-runtime-hardening.md`
- Follow: `docs/superpowers/plans/2026-07-13-macos-beta-hardening.md`

**Interfaces:**
- Consumes: merged PR 1 and protected production.
- Produces: PR 2 bounded Kindle download and PR 3 macOS Beta hardening, each independently merged and revertible.

- [ ] **Step 1: Execute only the PR 2 section of the Kindle plan**

Expected: timeout, oversize, invalid PNG, wrong dimensions, move failure, and absent-cache cases pass; old cache remains byte-identical on every failure.

- [ ] **Step 2: Stop for PR 2 review and merge authorization**

Expected: user receives the focused/full test evidence, CI, diff scope, and rollback commit before merge.

- [ ] **Step 3: Execute the macOS Beta plan as PR 3**

Expected: absolute paths, controlled PATH, no-argv Keychain transaction, terminal restoration, strict ownership, and Beta documentation pass automated review; no production-ready claim is made.

- [ ] **Step 4: Stop for Phase 1 approval**

Expected: user confirms both merged PRs and the remaining real-Mac Beta limitation before Phase 2.

### Task 4: Execute Phase 2 Correctness Pull Requests

**Files:**
- Follow PR 4 section: `docs/superpowers/plans/2026-07-13-kindle-runtime-hardening.md`
- Follow PR 5 section: `docs/superpowers/plans/2026-07-13-server-contract-hardening.md`
- Follow PR 6-7 sections: `docs/superpowers/plans/2026-07-13-collector-installer-hardening.md`

**Interfaces:**
- Consumes: Phase 1 merge SHAs.
- Produces: Wi-Fi/config ordering, private-env safety, prototype safety, explicit config concurrency behavior, atomic stale-lock reclaim, and exact upload acknowledgement.

- [ ] **Step 1: Execute PR 4 and stop for its review**

Expected: executable call-order tests prove Wi-Fi readiness precedes config and PNG without duplicate waits; inherited xtrace cannot print private URLs.

- [ ] **Step 2: Execute PR 5 and stop for its review**

Expected: prototype-chain names never return 500 or reach unsafe storage; single-admin last-successful-write-wins behavior is tested and documented.

- [ ] **Step 3: Execute PR 6 and stop for its review**

Expected: deterministic interleaving proves a live/heartbeating unique claim is never reclaimed, only an exact stale claim whose process is proven absent is removed, and at most one collector action runs.

- [ ] **Step 4: Execute PR 7 and stop for its review**

Expected: only exact HTTP 200 JSON `{ok:true,collectedAt}` acknowledgement updates success state; all malformed responses retain state and enter backoff.

- [ ] **Step 5: Stop for Phase 2 approval**

Expected: all four merge SHAs, CI results, rollback points, and unresolved risks are reviewed together.

### Task 5: Execute Phase 3 Contract and Verification Pull Requests

**Files:**
- Follow PR 8 section: `docs/superpowers/plans/2026-07-13-collector-installer-hardening.md`
- Follow PR 9a section: `docs/superpowers/plans/2026-07-13-server-contract-hardening.md`
- Follow PR 9b section: `docs/superpowers/plans/2026-07-13-kindle-runtime-hardening.md`
- Follow PR 10 section: `docs/superpowers/plans/2026-07-13-verification-release-and-ponytail.md`

**Interfaces:**
- Consumes: Phase 2 merge SHAs.
- Produces: Node gates, Windows rollback, sensitive-field coverage, exact device config versioning, built-app smoke, dependency evidence, and current documentation.

- [ ] **Step 1: Execute and review PR 8**

Expected: Windows/macOS installers reject Node below 20.9.0; Windows fresh-install failure restores exact prior absence.

- [ ] **Step 2: Execute and review PR 9a**

Expected: recursive credential-name rejection includes exact `auth` and the approved token/secret/password/credential/cookie/authorization/oauth/bearer/key families.

- [ ] **Step 3: Execute and review PR 9b**

Expected: Kindle accepts exactly ordered version 1 config and retains the old interval for unknown, reordered, duplicate, or additional data.

- [ ] **Step 4: Execute and review PR 10**

Expected: build-produced `next start` smoke, CI audit gate, current runbooks/status, and secret-safe release tooling are green.

- [ ] **Step 5: Stop for Phase 3 approval**

Expected: no phase proceeds to live release acceptance until the user approves the aggregate evidence.

### Task 6: Execute Phase 4 Release Acceptance

**Files:**
- Follow release tasks: `docs/superpowers/plans/2026-07-13-verification-release-and-ponytail.md`

**Interfaces:**
- Consumes: all Phase 0-3 merge SHAs and green CI.
- Produces: a Vercel production deployment tied to the approved merge, authenticated smoke, Kindle/Windows acceptance, and a truthfully scoped macOS Beta result.

- [ ] **Step 1: Verify merge-to-deployment identity**

Expected: the single canonical production origin resolves to one exact Vercel deployment ID whose linked project, `READY` state, production target, and `githubCommitSha` equal the approved PR 10 release contract. A separate clean detached acceptance worktree has `HEAD` exactly at that SHA. Local main and `origin/main` are recorded only as moving context, never equality gates.

- [ ] **Step 2: Run secret-safe production smoke**

Expected: authorization, two-line config, all profile PNG metadata, wrong admin/ingest authorization, and no-store checks pass without printing credentials.

- [ ] **Step 3: Perform the final Kindle USB update and acceptance**

Expected: hardened scripts are installed while private `env.sh` is preserved; two remote-setting cycles and the 60-minute/5-interval sustained observation pass; cached failure and chrome restoration pass.

- [ ] **Step 4: Perform Windows real-scheduler acceptance**

Expected: install, login/12-minute execution, no-wake/no-overlap, upload acknowledgement, diagnose, reinstall/rollback, and uninstall ownership pass.

- [ ] **Step 5: Record macOS Beta status**

Expected: a PR 3 real-Mac run is preliminary evidence only because PR 8 later changes the macOS installer. If no real Mac is available after PR 10, record `not run - macOS remains Beta`. If one is available, use a clean checkout, require `HEAD` to equal the user-approved final PR 10 merge SHA, and rerun the entire real-Mac sequence; only that fresh result may be recorded for Phase 4, without expanding support beyond the recorded OS/version/architecture.

- [ ] **Step 6: Stop for release approval**

Expected: user accepts or rejects the production/Kindle/Windows evidence and the observed device battery/thermal record.

### Task 7: Execute Phase 5 Ponytail Audit Only

**Files:**
- Follow audit tasks: `docs/superpowers/plans/2026-07-13-verification-release-and-ponytail.md`

**Interfaces:**
- Consumes: the user-approved Phase 4 release state.
- Produces: a ranked, evidence-backed Ponytail audit with no code changes.

- [ ] **Step 1: Create the clean detached audit worktree**

From the canonical repository, use the explicitly approved final PR 10 merge SHA to create `..\kindle-hardening-ponytail-audit` with `git worktree add --detach`. Require exact `HEAD` equality and empty `git status --porcelain=v1 -uall`; never use the moving current worktree, a branch, or an existing dirty path.

Expected: a clean detached worktree at the approved released source. The audit report itself has no PR/commit/push publication authority.

- [ ] **Step 2: Invoke `ponytail-audit` in report-only mode**

Expected: a ranked list of deletions/simplifications with affected behavior, proof burden, estimated line/dependency impact, and excluded safety mechanisms.

- [ ] **Step 3: Confirm zero code diff**

Run:

```powershell
git status --short --branch
git diff --check
```

Expected: only explicitly approved documentation/audit output differs; no runtime or test file changed.

- [ ] **Step 4: Stop for candidate selection**

Expected: the user chooses individual candidates. Each selected candidate requires a new dedicated plan/PR and cannot be inferred from audit approval.

## Final Handoff Record

The final handoff must state, separately and without secrets:

```text
Local branch/commit:
PR head and merge SHA:
GitHub CI jobs:
Vercel deployment ID/state/githubCommitSha:
Vercel Standard Protection/bypass/generated-URL gate:
Credential provenance/rotation blockers:
Production auth/config/PNG smoke:
Kindle real-device result:
Windows real-scheduler result:
macOS Beta real-device status:
Unresolved P1/P2/P3:
Rollback SHA/deployment:
Ponytail audit-only status:
```

Do not mark the remediation complete unless every Definition of Done item in the approved design is evidenced or explicitly left as a truthfully labeled Beta limitation.
