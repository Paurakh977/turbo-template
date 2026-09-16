<#
.SYNOPSIS
    Smart cross-platform runner for the k6 load testing suite.
.DESCRIPTION
    Detects if native k6 CLI is available on the machine. If present, runs
    natively; otherwise seamlessly falls back to the official grafana/k6 Docker container.
.PARAMETER Suite
    Name of the suite to run: smoke (default), load, stress, spike, soak, edge-cases
.PARAMETER BaseUrl
    Base URL of the target environment. Default: https://localhost
.EXAMPLE
    .\k6\run.ps1 smoke
    .\k6\run.ps1 load -BaseUrl https://localhost
#>

param(
    [string]$Suite = "smoke",
    [string]$BaseUrl = "https://localhost",
    [string]$ExtraArgs = ""
)

$ErrorActionPreference = "Stop"

# Map friendly name to file path
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
        default      { $suiteFile = "suites/$Suite.js" }
    }
}

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$localScriptPath = "$PSScriptRoot\$suiteFile"
$dockerScriptPath = "/scripts/$suiteFile"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Turbo Observability k6 Runner" -ForegroundColor Cyan
Write-Host "  Target Suite : $suiteFile" -ForegroundColor Yellow
Write-Host "  Base URL     : $BaseUrl" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# Check if native k6 is in PATH
$hasNativeK6 = $null -ne (Get-Command "k6" -ErrorAction SilentlyContinue)

if ($hasNativeK6) {
    Write-Host "[Runner] Using native k6 CLI from PATH..." -ForegroundColor Green
    $k6Cmd = "k6 run -e BASE_URL=$BaseUrl --insecure-skip-tls-verify `"$localScriptPath`" $ExtraArgs"
    Invoke-Expression $k6Cmd
} else {
    Write-Host "[Runner] Native k6 not detected. Using Docker (grafana/k6:latest)..." -ForegroundColor Green
    
    # Mount k6 directory into /scripts in the container
    $k6Mount = "$repoRoot/k6"
    
    # Run container using host networking to reach https://localhost on the host
    $dockerCmd = "docker run --rm -i -v `"${k6Mount}:/scripts`" --network host grafana/k6:latest run -e BASE_URL=$BaseUrl --insecure-skip-tls-verify $dockerScriptPath $ExtraArgs"
    Invoke-Expression $dockerCmd
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[Runner] [PASS] Suite '$Suite' completed successfully!" -ForegroundColor Green
} else {
    Write-Host "`n[Runner] [FAIL] Suite '$Suite' failed with exit code $LASTEXITCODE." -ForegroundColor Red
    exit $LASTEXITCODE
}
