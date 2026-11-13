<#
.SYNOPSIS
  Deploy the prebuilt Exchange Ops app (no Node/npm required).

.DESCRIPTION
  Uploads out\my.exchange.ops-*.zip to the Dynatrace App Registry API.

  From 04-app-exchange-ops:
    $env:DT_APP_ENVIRONMENT_URL = "https://YOUR_ENV.apps.dynatrace.com"
    $env:DT_APP_PLATFORM_TOKEN  = "dt0s16...."
    .\scripts\deploy-exchange-ops.ps1

  Optional:
    $env:EXCHANGE_OPS_ZIP = "C:\path\to\my.exchange.ops-x.y.z.zip"
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $env:DT_APP_ENVIRONMENT_URL) {
    throw "Set DT_APP_ENVIRONMENT_URL (apps host), e.g. https://xxxx.apps.dynatrace.com"
}
if (-not $env:DT_APP_PLATFORM_TOKEN) {
    throw "Set DT_APP_PLATFORM_TOKEN to a Platform token (dt0s16...)"
}

$env:DT_APP_ENVIRONMENT_URL = $env:DT_APP_ENVIRONMENT_URL.TrimEnd("/")

if ($env:EXCHANGE_OPS_ZIP) {
    $Zip = $env:EXCHANGE_OPS_ZIP
}
else {
    $Zip = Get-ChildItem -Path (Join-Path $Root "out\my.exchange.ops-*.zip") -ErrorAction SilentlyContinue |
        Sort-Object Name |
        Select-Object -Last 1 |
        ForEach-Object { $_.FullName }
}
if (-not $Zip -or -not (Test-Path -LiteralPath $Zip)) {
    throw "No prebuilt zip found under out\my.exchange.ops-*.zip. Regenerate the handoff package."
}

Write-Host "Environment : $($env:DT_APP_ENVIRONMENT_URL)"
Write-Host "Artifact    : $Zip"

Write-Host "Auth probe..."
try {
    Invoke-WebRequest -Uri "$($env:DT_APP_ENVIRONMENT_URL)/platform/metadata/v1/user" `
        -Headers @{ Authorization = "Bearer $($env:DT_APP_PLATFORM_TOKEN)" } `
        -UseBasicParsing | Out-Null
    Write-Host "Auth OK."
}
catch {
    throw "Platform token auth failed. $($_.Exception.Message)"
}

$installUrl = "$($env:DT_APP_ENVIRONMENT_URL)/platform/app-engine/registry/v1/apps"
Write-Host "Uploading app to registry..."

# Prefer curl.exe when present (binary body is reliable on Windows PowerShell 5.1)
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
$tmpOut = Join-Path $env:TEMP "dt-install.json"
if ($curl) {
    $code = & curl.exe -sS -o $tmpOut -w "%{http_code}" `
        -X POST `
        -H "Authorization: Bearer $($env:DT_APP_PLATFORM_TOKEN)" `
        -H "Content-Type: application/zip" `
        --data-binary "@$Zip" `
        $installUrl
    $body = if (Test-Path $tmpOut) { Get-Content $tmpOut -Raw } else { "" }
}
else {
    $bytes = [System.IO.File]::ReadAllBytes($Zip)
    try {
        $resp = Invoke-WebRequest -Uri $installUrl -Method Post `
            -Headers @{ Authorization = "Bearer $($env:DT_APP_PLATFORM_TOKEN)" } `
            -ContentType "application/zip" `
            -Body $bytes `
            -UseBasicParsing
        $code = [int]$resp.StatusCode
        $body = $resp.Content
    }
    catch {
        $resp = $_.Exception.Response
        if ($resp) {
            $code = [int]$resp.StatusCode
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $reader.ReadToEnd()
        }
        else {
            throw
        }
    }
}

Write-Host "Registry HTTP $code"
if ($body) { Write-Host ($body.Substring(0, [Math]::Min(800, $body.Length))) }

if ($code -notin 200, 201, 202) {
    throw @"
Deploy failed (HTTP $code).
If the API says the same version is already installed with a different checksum,
bump app.version and regenerate the handoff zip.
"@
}

Write-Host ""
Write-Host "Deploy accepted."
Write-Host "Open: $($env:DT_APP_ENVIRONMENT_URL)/ui/apps/my.exchange.ops"
