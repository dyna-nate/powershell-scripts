<#
.SYNOPSIS
    Install the Exchange queue metrics collector on this Exchange server and schedule it.

.DESCRIPTION
    Run once, elevated, on the Exchange server. Steps (stops at the first failure, nothing is
    scheduled unless every check passes):
      1. Download Get-ExchangeQueues.ps1 and Send-ExchangeQueueMetrics.ps1 from GitHub.
      2. Check the Dynatrace OneAgent service is running and the MINT endpoint is listening
         and accepts a metric line.
      3. Run the collector once as -Credential through a temporary Scheduled Task (the same
         batch logon the real task uses) and check it returns data.
      4. Register the recurring Scheduled Task and start it once.

.PARAMETER Credential
    Account the task runs as. Needs Exchange permission for Get-Queue and the
    "Log on as a batch job" right.
.PARAMETER GitHubToken
    Token with read access to the repo (it is private). Defaults to $env:GITHUB_TOKEN.
.PARAMETER Repo
    owner/name of the GitHub repo.
.PARAMETER Branch
    Branch, tag or commit to download.
.PARAMETER InstallPath
    Where the scripts and the last-run log are placed.
.PARAMETER IntervalMinutes
    How often the task runs.
.PARAMETER ExcludeEmpty
    Pass -ExcludeEmpty to the collector (recommended, fewer queue series).
.PARAMETER SkipDownload
    Use the scripts already in InstallPath.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][System.Management.Automation.PSCredential]$Credential,
    [System.Security.SecureString]$GitHubToken,
    [string]$Repo = "dyna-nate/powershell-scripts",
    [string]$Branch = "main",
    [string]$InstallPath = "C:\ProgramData\Dynatrace\ExchangeQueueMetrics",
    [string]$TaskName = "Dynatrace-ExchangeQueueMetrics",
    [int]$IntervalMinutes = 1,
    [string]$Endpoint = "http://127.0.0.1:14499/metrics/ingest",
    [switch]$ExcludeEmpty,
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$files = @("exchange/Get-ExchangeQueues.ps1", "exchange/Send-ExchangeQueueMetrics.ps1")
$sendScript = Join-Path $InstallPath "Send-ExchangeQueueMetrics.ps1"
$ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

function Step { param([string]$m) Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok   { param([string]$m) Write-Host "   OK  $m" -ForegroundColor Green }
function Fail { param([string]$m) throw $m }

# --- 0. Preconditions --------------------------------------------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail "Run this script from an elevated (Administrator) PowerShell."
}
if ($IntervalMinutes -lt 1) { Fail "IntervalMinutes must be at least 1." }

# --- 1. Download -------------------------------------------------------------------------------
Step "Downloading scripts from github.com/$Repo@$Branch"
New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
if ($SkipDownload) {
    Ok "skipped, using $InstallPath"
}
else {
    $token = $null
    if ($GitHubToken) {
        $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($GitHubToken))
    }
    elseif ($env:GITHUB_TOKEN) { $token = $env:GITHUB_TOKEN }
    $headers = @{ Accept = "application/vnd.github.raw"; "User-Agent" = "ExchangeQueueMetrics-Installer" }
    if ($token) { $headers.Authorization = "Bearer $token" }

    foreach ($f in $files) {
        $name = Split-Path $f -Leaf
        $tmp = Join-Path $InstallPath "$name.download"
        $uri = "https://api.github.com/repos/$Repo/contents/${f}?ref=$Branch"
        try {
            Invoke-WebRequest -Uri $uri -Headers $headers -OutFile $tmp -UseBasicParsing -TimeoutSec 60
        }
        catch {
            $hint = if (-not $token) { " (no token supplied; a private repo returns 404 without one)" } else { "" }
            Fail "Download of $f failed: $($_.Exception.Message)$hint"
        }
        $text = Get-Content -LiteralPath $tmp -Raw
        if ([string]::IsNullOrWhiteSpace($text)) { Fail "$name downloaded empty." }
        $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$parseErrors)
        if ($parseErrors.Count -gt 0) { Fail "$name does not parse as PowerShell: $($parseErrors[0].Message)" }
        Move-Item -LiteralPath $tmp -Destination (Join-Path $InstallPath $name) -Force
        Unblock-File -LiteralPath (Join-Path $InstallPath $name)
        Ok "$name"
    }
}
foreach ($f in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallPath (Split-Path $f -Leaf)))) { Fail "Missing $f in $InstallPath." }
}

# --- 2. OneAgent and MINT ----------------------------------------------------------------------
Step "Checking OneAgent and the MINT endpoint"
$svc = Get-Service -Name "Dynatrace OneAgent" -ErrorAction SilentlyContinue
if (-not $svc) { Fail "Dynatrace OneAgent service is not installed on this host." }
if ($svc.Status -ne "Running") { Fail "Dynatrace OneAgent service is $($svc.Status), expected Running." }
Ok "OneAgent service is running"

$uriObj = [Uri]$Endpoint
$tcp = New-Object Net.Sockets.TcpClient
try {
    $async = $tcp.BeginConnect($uriObj.Host, $uriObj.Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(5000) -or -not $tcp.Connected) {
        Fail "Nothing is listening on $($uriObj.Host):$($uriObj.Port). Enable the OneAgent local metric API (Settings > Monitored technologies / OneAgent features > 'OneAgent metric API') and check the port."
    }
}
finally { $tcp.Close() }
Ok "port $($uriObj.Port) is listening"

$probe = 'exchange.installer.check,server="{0}" gauge,1' -f $env:COMPUTERNAME
try {
    $resp = Invoke-WebRequest -Uri $Endpoint -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($probe)) `
        -ContentType "text/plain; charset=utf-8" -UseBasicParsing -TimeoutSec 15
}
catch { Fail "MINT endpoint rejected the test metric: $($_.Exception.Message)" }
if ($resp.StatusCode -ne 202 -or $resp.Content -notmatch '"linesOk"\s*:\s*1') {
    Fail "Unexpected MINT response: HTTP $($resp.StatusCode) $($resp.Content)"
}
Ok "test metric accepted (HTTP $($resp.StatusCode))"

# --- 3 / 4. Scheduled tasks --------------------------------------------------------------------
$plain = $Credential.GetNetworkCredential().Password
$extra = if ($ExcludeEmpty) { " -ExcludeEmpty" } else { "" }
$logFile = Join-Path $InstallPath "last-run.log"

function Register-MetricsTask {
    param([string]$Name, [string]$Arguments, $Trigger)
    $action = New-ScheduledTaskAction -Execute $ps -Argument $Arguments -WorkingDirectory $InstallPath
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $reg = @{ TaskName = $Name; Action = $action; Settings = $settings; User = $Credential.UserName
               Password = $plain; RunLevel = "Highest"; Force = $true }
    if ($Trigger) { $reg.Trigger = $Trigger }
    try { [void](Register-ScheduledTask @reg) }
    catch { Fail "Could not register task '$Name' as $($Credential.UserName): $($_.Exception.Message)" }
    # Registration can return before the Task Scheduler lists the task; wait until it is visible.
    for ($i = 0; $i -lt 15 -and -not (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue); $i++) {
        Start-Sleep -Seconds 1
    }
    if (-not (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue)) {
        $known = (Get-ScheduledTask -TaskName "Dynatrace-*" -ErrorAction SilentlyContinue | ForEach-Object { $_.TaskPath + $_.TaskName }) -join ", "
        Fail "Task '$Name' was registered without error but the Task Scheduler cannot find it. Dynatrace-* tasks present: $known"
    }
}

function Wait-TaskRun {
    param([string]$Name, [int]$TimeoutSec = 300)
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    try { Start-ScheduledTask -InputObject $task }
    catch {
        Start-Sleep -Seconds 3    # one retry, the scheduler can be briefly busy right after a registration
        Start-ScheduledTask -InputObject (Get-ScheduledTask -TaskName $Name -ErrorAction Stop)
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    Start-Sleep -Seconds 2
    while ((Get-ScheduledTask -TaskName $Name).State -eq "Running") {
        if ((Get-Date) -gt $deadline) { Stop-ScheduledTask -TaskName $Name; Fail "Task '$Name' did not finish within $TimeoutSec s." }
        Start-Sleep -Seconds 2
    }
    return (Get-ScheduledTaskInfo -TaskName $Name).LastTaskResult
}

$testTask = "$TaskName-InstallTest"
$testLog = Join-Path $InstallPath "install-test.log"
Step "Testing the collector as $($Credential.UserName)"
try {
    Remove-Item -LiteralPath $testLog -Force -ErrorAction SilentlyContinue
    $cmd = "& { & '$sendScript'$extra -DryRun } *> '$testLog'"
    Register-MetricsTask -Name $testTask -Arguments "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"$cmd`""
    $code = Wait-TaskRun -Name $testTask
    $out = if (Test-Path -LiteralPath $testLog) { Get-Content -LiteralPath $testLog -Raw } else { "" }
    if ($code -ne 0 -or $out -notmatch 'collector\.success,[^\r\n]* gauge,1\b') {
        $tail = ($out -split "`r?`n" | Select-Object -Last 15) -join "`n"
        Fail ("Collector test failed as $($Credential.UserName) (task result 0x{0:X}). Check the password, 'Log on as a batch job', and Exchange role membership.`n{1}" -f $code, $tail)
    }
    $metricLines = @($out -split "`r?`n" | Where-Object { $_ -match '^exchange\.' })
    Ok "collector ran and produced $($metricLines.Count) metric lines"
    # Queues are the core signal, so they are required. The other sections can legitimately be
    # empty (no databases on an Edge/transport-only server), so a gap is a warning.
    foreach ($m in "queue.count", "queue.total_messages") {
        if (-not ($metricLines | Where-Object { $_ -like "exchange.$m,*" })) { Fail "Collector output has no exchange.$m." }
    }
    Ok "queue metrics present"
    foreach ($m in @(@("queue.named.", "named queue aggregates"), @("db.", "database copies"),
                     @("submission.", "performance counters"), @("service.running", "service states"))) {
        if ($metricLines | Where-Object { $_ -like "exchange.$($m[0])*" }) { Ok $m[1] }
        else { Write-Host "   WARN no $($m[1]) in the output" -ForegroundColor Yellow }
    }
    foreach ($w in ($out -split "`r?`n" | Where-Object { $_ -like "collector warning:*" })) {
        Write-Host "   WARN $w" -ForegroundColor Yellow
    }
}
finally {
    Unregister-ScheduledTask -TaskName $testTask -Confirm:$false -ErrorAction SilentlyContinue
}

Step "Registering scheduled task '$TaskName' every $IntervalMinutes min"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$cmd = "& { & '$sendScript'$extra } *> '$logFile'"
Register-MetricsTask -Name $TaskName -Arguments "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"$cmd`"" -Trigger $trigger
Ok "registered"

$code = Wait-TaskRun -Name $TaskName
if ($code -ne 0) {
    Fail ("Task registered but its first run returned 0x{0:X}. See $logFile." -f $code)
}
$runLog = if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Raw } else { "" }
# The OneAgent reply is pretty-printed JSON with the fields in any order, so match each field on its own.
$mSent = [regex]::Match($runLog, 'Sent (\d+) lines')
$mOk   = [regex]::Match($runLog, '"linesOk"\s*:\s*(\d+)')
$mBad  = [regex]::Match($runLog, '"linesInvalid"\s*:\s*(\d+)')
if (-not ($mSent.Success -and $mOk.Success -and $mBad.Success -and $runLog -match 'HTTP 202')) {
    Fail "First run finished but $logFile has no accepted-by-OneAgent line:`n$runLog"
}
$sent = [int]$mSent.Groups[1].Value; $linesOk = [int]$mOk.Groups[1].Value; $linesBad = [int]$mBad.Groups[1].Value
if ($linesOk -ne $sent -or $linesBad -ne 0) {
    Fail "OneAgent accepted $linesOk of $sent lines ($linesBad invalid). See $logFile."
}
Ok "first run succeeded, OneAgent accepted all $linesOk lines"
$plain = $null

Write-Host "`nDone. Metrics are under 'exchange.*' (e.g. exchange.queue.messages, exchange.collector.success)." -ForegroundColor Green
