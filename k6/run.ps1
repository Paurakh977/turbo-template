<#
.SYNOPSIS
    Cross-platform runner for the k6 load testing suite.
.DESCRIPTION
    Detects if native k6 CLI is available on the machine. If present, runs
    natively; otherwise falls back to the official grafana/k6 Docker container.

    P1-5 hardening:
    - No string-evaluated command execution: native and Docker invocations
      are executed from argument arrays (& operator), so secrets containing
      spaces, `!`, `&` or quotes survive verbatim.
    - No `--network host`: host mode is Linux-only and needs an opt-in on
      Docker Desktop 4.34+ (see Docker docs "host network driver"). The Docker
      fallback instead adds `--add-host host.docker.internal:host-gateway`
      (auto-provided on Mac/Windows, resolves to the bridge host IP on Linux)
      and maps localhost/127.0.0.1 in -BaseUrl to host.docker.internal, so the
      default `https://localhost` target is reachable from the container on
      every platform.
    - SUMMARY_PATH is always a forward-slash path under k6/results
      (k6/helpers/summary.js writes whatever path it receives verbatim, and
      scripts/benchmark-report.mjs only reads k6/results).
.PARAMETER Suite
    Name of the suite to run: smoke (default), load, stress, spike, soak, edge, edge-cases, capacity
.PARAMETER BaseUrl
    Base URL of the target environment. Default: https://localhost
.EXAMPLE
    .\k6\run.ps1 smoke
    .\k6\run.ps1 load -BaseUrl https://localhost
.EXAMPLE
    .\k6\run.ps1 capacity -BaseUrl https://localhost
    # Capacity matrix: API_WORKERS=1/2/4/8, one capacity run each, then pnpm k6:benchmark
#>

param(
    [string]$Suite = "smoke",
    [string]$BaseUrl = "https://localhost",
    [string]$ResultsDir = "results",
    [string]$ExtraArgs = ""
)

$ErrorActionPreference = "Stop"

# Map friendly name to file path (edge-cases has an explicit case: the
# previous switch only handled "edge" and relied on the default branch).
$suiteFile = $Suite
if (-not ($Suite.EndsWith(".js"))) {
    switch ($Suite.ToLower()) {
        "smoke"      { $suiteFile = "suites/smoke.js" }
        "load"       { $suiteFile = "suites/load.js" }
        "stress"     { $suiteFile = "suites/stress.js" }
        "spike"      { $suiteFile = "suites/spike.js" }
        "soak"       { $suiteFile = "suites/soak.js" }
        "edge"       { $suiteFile = "suites/edge-cases.js" }
        "edge-cases" { $suiteFile = "suites/edge-cases.js" }
        "capacity"   { $suiteFile = "suites/capacity.js" }
        default      { $suiteFile = "suites/$Suite.js" }
    }
}

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$localScriptPath = "$PSScriptRoot\$suiteFile"
$dockerScriptPath = "/scripts/$suiteFile"
$resultsPath = Join-Path $PSScriptRoot $ResultsDir
New-Item -ItemType Directory -Force -Path $resultsPath | Out-Null
$summaryName = ($suiteFile -replace '^suites/', '' -replace '.js$', '') + ".summary.json"
$summaryLocal = Join-Path $resultsPath $summaryName
# k6 writes SUMMARY_PATH verbatim: normalize to forward slashes so the file
# always lands in k6/results regardless of host path separators.
$summaryLocalForward = ($summaryLocal -replace '\\', '/')

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Turbo Observability k6 Runner" -ForegroundColor Cyan
Write-Host "  Target Suite : $suiteFile" -ForegroundColor Yellow
Write-Host "  Base URL     : $BaseUrl" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# Check if native k6 is in PATH
$hasNativeK6 = $null -ne (Get-Command "k6" -ErrorAction SilentlyContinue)
# Pinned runner: :latest is not reproducible. k6 v0.57+ required for
# `dropped_iterations` + `http_reqs{status}` threshold tags used by suites.
$K6_IMAGE = "grafana/k6:0.57.0"

function Get-EnvPassthroughArgs {
    # Returns a string[] of "-e", "NAME=value" pairs. Each value stays a
    # single argv element, so spaces/`!`/`&` in secrets are preserved and
    # never re-parsed by a shell.
    $names = @('SEED_ADMIN_EMAIL','SEED_ADMIN_PASSWORD','USER_EMAIL','USER_PASSWORD','LOAD_QUICK','SOAK_DURATION')
    $pairs = @()
    foreach ($n in $names) {
        $v = [Environment]::GetEnvironmentVariable($n)
        if ($null -ne $v -and $v -ne '') { $pairs += @('-e', "$n=$v") }
    }
    return $pairs
}

$envArgs = Get-EnvPassthroughArgs

if ($hasNativeK6) {
    Write-Host "[Runner] Using native k6 CLI from PATH..." -ForegroundColor Green
    $k6Args = @('run', '-e', "BASE_URL=$BaseUrl", '-e', "SUMMARY_PATH=$summaryLocalForward", '--insecure-skip-tls-verify') + $envArgs + @($localScriptPath)
    if ($ExtraArgs -ne '') { $k6Args += @($ExtraArgs) }
    & k6 @k6Args
} else {
    Write-Host "[Runner] Native k6 not detected. Using Docker ($K6_IMAGE)..." -ForegroundColor Green

    # Mount k6 directory into /scripts in the container
    $k6Mount = "$repoRoot/k6"

    # Inside the container, `localhost` is the container itself. Map the
    # loopback host to host.docker.internal (works on Docker Desktop
    # Mac/Windows out of the box; on Linux resolves via host-gateway).
    $dockerBaseUrl = $BaseUrl -replace 'localhost|127\.0\.0\.1', 'host.docker.internal'
    if ($dockerBaseUrl -ne $BaseUrl) {
        Write-Host "[Runner] Docker mode: mapped Base URL to $dockerBaseUrl" -ForegroundColor Yellow
    }

    $dockerArgs = @('run', '--rm', '-i',
        '-v', "${k6Mount}:/scripts",
        '-v', "${resultsPath}:/results",
        '--add-host', 'host.docker.internal:host-gateway',
        '-e', "SUMMARY_PATH=/results/$summaryName",
        $K6_IMAGE, 'run',
        '-e', "BASE_URL=$dockerBaseUrl",
        '--insecure-skip-tls-verify') + $envArgs + @($dockerScriptPath)
    if ($ExtraArgs -ne '') { $dockerArgs += @($ExtraArgs) }
    & docker @dockerArgs
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[Runner] [PASS] Suite '$Suite' completed successfully!" -ForegroundColor Green
} else {
    Write-Host "`n[Runner] [FAIL] Suite '$Suite' failed with exit code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}
