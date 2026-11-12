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
    Optional. Not needed while the repo is public. Defaults to $env:GITHUB_TOKEN.
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
.PARAMETER HybridHopDomains
    CSV of Exchange Online hop suffixes for the mail_path dimension. Empty uses the wrapper default.
.PARAMETER IncludeMailboxStats
    Also install a second, slower task (Send-ExchangeMailboxMetrics.ps1) that reports mailbox size and
    activity (Get-MailboxStatistics) for the largest mailboxes. Mailbox display names are sent to Dynatrace.
    The account needs a role that can read mailbox statistics, for example View-Only Recipients.
.PARAMETER TopMailboxes
    How many of the largest mailboxes get their own series (default 50).
.PARAMETER MailboxIntervalMinutes
    How often the mailbox task runs (default 30).
.PARAMETER SkipDownload
    Do not download. Copy the scripts that sit next to this installer into InstallPath (or use the ones
    already in InstallPath when the installer is run from there). For servers that cannot reach GitHub.
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
    [string]$HybridHopDomains = "",
    [switch]$IncludeMailboxStats,
    [int]$TopMailboxes = 50,
    [int]$MailboxIntervalMinutes = 30,
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$files = @("exchange/Get-ExchangeQueues.ps1", "exchange/Send-ExchangeQueueMetrics.ps1")
if ($IncludeMailboxStats) { $files += "exchange/Send-ExchangeMailboxMetrics.ps1" }
$sendScript = Join-Path $InstallPath "Send-ExchangeQueueMetrics.ps1"
$mailboxScript = Join-Path $InstallPath "Send-ExchangeMailboxMetrics.ps1"
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
    $here = $PSScriptRoot
    foreach ($f in $files) {
        $name = Split-Path $f -Leaf
        $src = if ($here) { Join-Path $here $name } else { $null }
        $dst = Join-Path $InstallPath $name
        if ($src -and (Test-Path -LiteralPath $src) -and ((Resolve-Path -LiteralPath $src).Path -ne (Join-Path (Resolve-Path -LiteralPath $InstallPath).Path $name))) {
            Copy-Item -LiteralPath $src -Destination $dst -Force
            Unblock-File -LiteralPath $dst
            Ok "$name copied from $here"
        }
        else { Ok "$name already in $InstallPath" }
    }
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
            $hint = if (-not $token) { " (no token supplied; if the repo is private again, pass -GitHubToken)" } else { "" }
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

$probe = 'custom.exchange.installer.check,server="{0}" gauge,1' -f $env:COMPUTERNAME
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
if ($HybridHopDomains) {
    if ($HybridHopDomains -notmatch '^[A-Za-z0-9.,\- ]+$') { Fail "HybridHopDomains may only contain letters, digits, dots, dashes and commas." }
    $extra += " -HybridHopDomains '$HybridHopDomains'"
}
$logFile = Join-Path $InstallPath "last-run.log"

# Tasks are handled through the Task Scheduler COM API (Schedule.Service), not the *-ScheduledTask
# cmdlets: those go through a CIM provider that can fail on its own ("The request was aborted",
# "Element not found") while the scheduler itself is healthy.
$scheduler = New-Object -ComObject "Schedule.Service"
$scheduler.Connect()
$taskRoot = $scheduler.GetFolder("\")

function Register-MetricsTask {
    param([string]$Name, [string]$Arguments, [int]$RepeatMinutes = 0)
    $def = $scheduler.NewTask(0)
    $def.RegistrationInfo.Description = "Sends Exchange queue metrics to the local Dynatrace OneAgent (MINT)."
    $def.Principal.RunLevel = 1                      # TASK_RUNLEVEL_HIGHEST
    $def.Settings.Enabled = $true
    $def.Settings.ExecutionTimeLimit = "PT10M"
    $def.Settings.MultipleInstances = 2              # TASK_INSTANCES_IGNORE_NEW
    $def.Settings.StartWhenAvailable = $true
    $def.Settings.DisallowStartIfOnBatteries = $false
    $def.Settings.StopIfGoingOnBatteries = $false
    $action = $def.Actions.Create(0)                 # TASK_ACTION_EXEC
    $action.Path = $ps
    $action.Arguments = $Arguments
    $action.WorkingDirectory = $InstallPath
    if ($RepeatMinutes -gt 0) {
        $trigger = $def.Triggers.Create(1)           # TASK_TRIGGER_TIME
        $trigger.StartBoundary = (Get-Date).AddMinutes(1).ToString("yyyy-MM-ddTHH:mm:ss")
        $trigger.Repetition.Interval = "PT${RepeatMinutes}M"
        # An explicit duration is required: with the interval alone the scheduler logs event 113
        # (0x80070057, "not all specified triggers will start the task") and the task never fires.
        $trigger.Repetition.Duration = "P3650D"
        $trigger.Enabled = $true
    }
    try {
        # 6 = TASK_CREATE_OR_UPDATE, 1 = TASK_LOGON_PASSWORD
        [void]$taskRoot.RegisterTaskDefinition($Name, $def, 6, $Credential.UserName, $plain, 1, $null)
    }
    catch { Fail "Could not register task '$Name' as $($Credential.UserName): $($_.Exception.Message)" }
}

function Assert-TriggerAccepted {
    # The scheduler accepts a task whose trigger it cannot schedule and only logs event 113
    # ("not all specified triggers will start the task"). The task then never runs. Catch that here
    # instead of waiting for a run that cannot happen. Silent if the log is unavailable.
    param([string]$Name, [datetime]$Since)
    Start-Sleep -Seconds 2
    $ev = Get-WinEvent -FilterHashtable @{ LogName = "Microsoft-Windows-TaskScheduler/Operational"; Id = 113; StartTime = $Since } -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -like "*\$Name*" } | Select-Object -First 1
    if ($ev) {
        $detail = $ev.Message -replace '\s+', ' '
        Fail "Task Scheduler registered '$Name' but rejected its trigger, so it will never run (event 113: $detail). This is a Windows Task Scheduler problem on this server. Restart the server and run the installer again."
    }
}

function Remove-MetricsTask {
    param([string]$Name)
    try { $taskRoot.DeleteTask($Name, 0) } catch { }
}

function Wait-TaskRun {
    # The task is started by its own trigger, not by Run(): on-demand Run (COM and schtasks /run)
    # fails with 0x80070490 on some servers while triggers fire normally. One-time triggers did not fire
    # on such a server either, so the test task uses the same repeating trigger as the real task; it is
    # deleted as soon as its first run ends.
    param([string]$Name, [int]$TimeoutSec = 300)
    $started = Get-Date
    # Wait for the run to begin (Queued/Running, or a last-run time after our start), then to end.
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $begun = $false
    while ($true) {
        $t = $taskRoot.GetTask($Name)
        $busy = $t.State -in 2, 4                    # Queued, Running
        if ($busy -or $t.LastRunTime -ge $started.AddSeconds(-2)) { $begun = $true }
        if ($begun -and -not $busy) { break }
        if ((Get-Date) -gt $deadline) {
            try { $t.Stop(0) } catch { }
            Fail "Task '$Name' $(if ($begun) { 'did not finish' } else { 'did not start' }) within $TimeoutSec s."
        }
        Start-Sleep -Seconds 2
    }
    return $taskRoot.GetTask($Name).LastTaskResult
}

$testTask = "$TaskName-InstallTest"
$testLog = Join-Path $InstallPath "install-test.log"
Step "Testing the collector as $($Credential.UserName)"
try {
    Remove-Item -LiteralPath $testLog -Force -ErrorAction SilentlyContinue
    $cmd = "& { & '$sendScript'$extra -DryRun } *> '$testLog'"
    $regAt = (Get-Date).AddSeconds(-2)
    Register-MetricsTask -Name $testTask -Arguments "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"$cmd`"" -RepeatMinutes 1
    Assert-TriggerAccepted -Name $testTask -Since $regAt
    Write-Host "   test task starts on its own trigger in about a minute..."
    $code = Wait-TaskRun -Name $testTask
    $out = if (Test-Path -LiteralPath $testLog) { Get-Content -LiteralPath $testLog -Raw } else { "" }
    if ($code -ne 0 -or $out -notmatch 'collector\.success,[^\r\n]* gauge,1\b') {
        $tail = ($out -split "`r?`n" | Select-Object -Last 15) -join "`n"
        Fail ("Collector test failed as $($Credential.UserName) (task result 0x{0:X}). Check the password, 'Log on as a batch job', and Exchange role membership.`n{1}" -f $code, $tail)
    }
    $metricLines = @($out -split "`r?`n" | Where-Object { $_ -match '^custom\.exchange\.' })
    Ok "collector ran and produced $($metricLines.Count) metric lines"
    # Queues are the core signal, so they are required. The other sections can legitimately be
    # empty (no databases on an Edge/transport-only server), so a gap is a warning.
    foreach ($m in "queue.count", "queue.total_messages") {
        if (-not ($metricLines | Where-Object { $_ -like "custom.exchange.$m,*" })) { Fail "Collector output has no custom.exchange.$m." }
    }
    Ok "queue metrics present"
    foreach ($m in @(@("queue.poison.", "named queue aggregates"), @("database.", "database copies"),
                     @("submission.", "performance counters"), @("service.running", "service states"))) {
        if ($metricLines | Where-Object { $_ -like "custom.exchange.$($m[0])*" }) { Ok $m[1] }
        else { Write-Host "   WARN no $($m[1]) in the output" -ForegroundColor Yellow }
    }
    foreach ($w in ($out -split "`r?`n" | Where-Object { $_ -like "collector warning:*" })) {
        Write-Host "   WARN $w" -ForegroundColor Yellow
    }
}
finally {
    Remove-MetricsTask -Name $testTask
}

Step "Registering scheduled task '$TaskName' every $IntervalMinutes min"
$cmd = "& { & '$sendScript'$extra } *> '$logFile'"
Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
$registeredAt = Get-Date
Register-MetricsTask -Name $TaskName -Arguments "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"$cmd`"" -RepeatMinutes $IntervalMinutes
Assert-TriggerAccepted -Name $TaskName -Since $registeredAt.AddSeconds(-2)
Ok "registered"

# The task fires about a minute after registration. Confirm that from the log it writes: on some
# servers the Task Scheduler does not report Status / Last Run Time reliably, and a manual start
# of a task with a repeating trigger can be rejected.
Write-Host "   waiting for the first scheduled run (about a minute)..."
$deadline = (Get-Date).AddSeconds(240)
while ($true) {
    if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).LastWriteTime -ge $registeredAt.AddSeconds(-2)) {
        $txt = Get-Content -LiteralPath $logFile -Raw
        if ($txt -match '"linesInvalid"\s*:\s*\d+' -or $txt -match 'Collection failed') { break }   # reply fully written
    }
    if ((Get-Date) -gt $deadline) {
        Fail "The task did not run within 4 minutes. Check it with: schtasks /query /tn `"$TaskName`" /v /fo list, and $logFile."
    }
    Start-Sleep -Seconds 3
}
$runLog = if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Raw } else { "" }
if ($runLog -match 'Collection failed') { Fail "First scheduled run failed to collect:`n$runLog" }
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

if ($IncludeMailboxStats) {
    $mailboxTask = "$TaskName-Mailbox"
    $mailboxLog = Join-Path $InstallPath "last-mailbox-run.log"
    Step "Registering scheduled task '$mailboxTask' every $MailboxIntervalMinutes min (top $TopMailboxes mailboxes)"
    $cmd = "& { & '$mailboxScript' -TopMailboxes $TopMailboxes } *> '$mailboxLog'"
    Remove-Item -LiteralPath $mailboxLog -Force -ErrorAction SilentlyContinue
    $mailboxRegisteredAt = Get-Date
    Register-MetricsTask -Name $mailboxTask -Arguments "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"$cmd`"" -RepeatMinutes $MailboxIntervalMinutes
    Assert-TriggerAccepted -Name $mailboxTask -Since $mailboxRegisteredAt.AddSeconds(-2)
    Ok "registered"
    # Reading every mailbox can take minutes on a large server, so a slow first run is a warning.
    Write-Host "   waiting for the first mailbox run (up to 10 minutes)..."
    $deadline = (Get-Date).AddMinutes(10)
    $mailboxTxt = ""
    while ((Get-Date) -lt $deadline) {
        if ((Test-Path -LiteralPath $mailboxLog) -and (Get-Item -LiteralPath $mailboxLog).LastWriteTime -ge $mailboxRegisteredAt.AddSeconds(-2)) {
            $mailboxTxt = Get-Content -LiteralPath $mailboxLog -Raw
            if ($mailboxTxt -match '"linesInvalid"\s*:\s*\d+' -or $mailboxTxt -match 'Collection failed') { break }
        }
        Start-Sleep -Seconds 5
    }
    if ($mailboxTxt -match 'Collection failed') {
        Write-Host "   WARN the mailbox run failed (the queue metrics are fine):`n$mailboxTxt" -ForegroundColor Yellow
    }
    elseif ($mailboxTxt -match 'HTTP 202' -and $mailboxTxt -match '"linesInvalid"\s*:\s*0\b') {
        Ok "mailbox run succeeded: $(([regex]::Match($mailboxTxt, 'Sent (\d+) lines')).Groups[1].Value) lines accepted"
    }
    else {
        Write-Host "   WARN no finished mailbox run yet. Check $mailboxLog later." -ForegroundColor Yellow
    }
}
$plain = $null

Write-Host "`nDone. Metrics are under 'custom.exchange.*' (e.g. custom.exchange.queue.message_count, custom.exchange.collector.success)." -ForegroundColor Green
