<#
.SYNOPSIS
    Collect Exchange health signals for Dynatrace custom:exchange-queue.

.DESCRIPTION
    Emits a single JSON object with:
      - queues / digest / named queue aggregates (from Get-Queue - operator-aligned)
      - database copy status (Get-MailboxDatabaseCopyStatus)
      - mail submission / IS performance counters (Get-Counter)
      - critical Exchange / WWW Publishing / Cluster Windows service states

.PARAMETER ExcludeEmpty
.PARAMETER MinMessageCount
.PARAMETER DeliveryTypes
.PARAMETER IncludeDigest
.PARAMETER IncludeDatabase
.PARAMETER IncludeCounters
.PARAMETER IncludeServices
.PARAMETER ComputerName
    Remote Exchange host for WinRM (REMOTE ActiveGate mode).
.PARAMETER Credential
    PSCredential for REMOTE WinRM, or LOCAL run-as on this host.
    LOCAL prefers Scheduled Task run-as, then Start-Process -Credential (WinRM loopback breaks EMS/AD).
#>
[CmdletBinding()]
param(
    [switch]$ExcludeEmpty,
    [int]$MinMessageCount = 0,
    [string]$DeliveryTypes = "",
    [switch]$IncludeDigest,
    [switch]$IncludeDatabase,
    [switch]$IncludeCounters,
    [switch]$IncludeServices,
    [string]$ComputerName = "",
    [System.Management.Automation.PSCredential]$Credential
)

$ErrorActionPreference = "Stop"
$script:ExqStart = Get-Date

# Diagnostic trace: timestamped lines to stderr (captured by the Python runner, shown on
# timeout/failure) and, when $script:ExqTraceFile is set, appended to that file so the
# Scheduled Task / Start-Process child can be inspected after the parent is killed.
# Never writes to stdout - stdout is parsed as JSON.
function Write-Trace {
    param([string]$Message)
    $line = "{0} [pid {1}] {2}" -f (Get-Date).ToString("HH:mm:ss.fff"), $PID, $Message
    try { [Console]::Error.WriteLine($line) } catch { }
    if ($script:ExqTraceFile) {
        try { [System.IO.File]::AppendAllText($script:ExqTraceFile, $line + "`r`n") } catch { }
    }
}

# Safety net for Scheduled Tasks left behind when an earlier run was killed before it could clean
# up (the extension stops this script at its timeout, so its own finally block never ran).
# - Lists task definition files from disk instead of asking the Task Scheduler (enumerating
#   thousands of tasks through the service is what becomes slow or hangs).
# - Only touches Dynatrace-ExchangeQueue-* tasks older than $MinAgeMinutes, so a collection that
#   is genuinely still running (limited to 10 minutes) is never removed.
# - Bounded in count and time so it cannot eat the extension's timeout; a large backlog drains
#   over several runs.
function Remove-StaleExchangeQueueTasks {
    param(
        [int]$MinAgeMinutes = 15,
        [int]$MaxTasks = 50,
        [int]$MaxSeconds = 5,
        [string]$KeepName = ''
    )
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $tasksDir = Join-Path $env:windir 'System32\Tasks'
        if (-not [Environment]::Is64BitProcess -and [Environment]::Is64BitOperatingSystem) {
            $tasksDir = Join-Path $env:windir 'Sysnative\Tasks'
        }
        $cutoff = (Get-Date).AddMinutes(-$MinAgeMinutes)
        $stale = @(Get-ChildItem -LiteralPath $tasksDir -File -Filter 'Dynatrace-ExchangeQueue-*' -ErrorAction Stop |
            Where-Object { $_.CreationTime -lt $cutoff -and $_.Name -ne $KeepName } |
            Sort-Object CreationTime)
        if ($stale.Count -eq 0) { return }
        Write-Trace "Task cleanup: $($stale.Count) stale Dynatrace-ExchangeQueue-* tasks (older than $MinAgeMinutes min); removing up to $MaxTasks"
        $svc = New-Object -ComObject 'Schedule.Service'
        $svc.Connect()
        $folder = $svc.GetFolder('\')
        $removed = 0
        $failed = 0
        foreach ($f in $stale) {
            if (($removed + $failed) -ge $MaxTasks -or $sw.Elapsed.TotalSeconds -ge $MaxSeconds) { break }
            try { $folder.DeleteTask($f.Name, 0); $removed++ } catch { $failed++ }
        }
        Write-Trace "Task cleanup: removed $removed, failed $failed, about $($stale.Count - $removed) still left (took $($sw.ElapsedMilliseconds) ms)"
    }
    catch {
        Write-Trace "Task cleanup skipped: $($_.Exception.Message)"
    }
}

function Initialize-ExchangeShell {
    param(
        [System.Management.Automation.PSCredential]$Credential
    )

    if (Get-Command Get-Queue -ErrorAction SilentlyContinue) {
        Write-Trace "Initialize-ExchangeShell: Get-Queue already available"
        return
    }

    $swInit = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Trace "Initialize-ExchangeShell: start (user=$env:USERDOMAIN\$env:USERNAME)"

    # Prefer in-process EMS (no WinRM). LOCAL run-as runs a child PowerShell as the vault
    # user; if we then Connect-ExchangeServer -auto without -Credential, Kerberos
    # double-hop fails with WinRM 0x8009030e ("A specified logon session does not exist").
    $snapins = @(
        "Microsoft.Exchange.Management.PowerShell.SnapIn",
        "Microsoft.Exchange.Management.PowerShell.E2010"
    )
    foreach ($name in $snapins) {
        $registered = [bool](Get-PSSnapin -Name $name -Registered -ErrorAction SilentlyContinue)
        Write-Trace "Initialize-ExchangeShell: snap-in $name registered=$registered"
        if ($registered) {
            $swSnap = [System.Diagnostics.Stopwatch]::StartNew()
            Add-PSSnapin $name -ErrorAction SilentlyContinue
            Write-Trace "Initialize-ExchangeShell: Add-PSSnapin $name took $($swSnap.ElapsedMilliseconds) ms"
        }
    }
    if (Get-Command Get-Queue -ErrorAction SilentlyContinue) {
        Write-Trace "Initialize-ExchangeShell: ready via snap-in in $($swInit.ElapsedMilliseconds) ms"
        return
    }

    $candidates = @(
        "$env:ExchangeInstallPath\bin\RemoteExchange.ps1",
        "C:\Program Files\Microsoft\Exchange Server\V15\bin\RemoteExchange.ps1"
    )
    foreach ($path in $candidates) {
        $exists = [bool]($path -and (Test-Path $path))
        Write-Trace "Initialize-ExchangeShell: RemoteExchange.ps1 candidate '$path' exists=$exists"
        if ($exists) {
            $swConn = [System.Diagnostics.Stopwatch]::StartNew()
            . $path
            Write-Trace "Initialize-ExchangeShell: dot-sourced RemoteExchange.ps1 in $($swConn.ElapsedMilliseconds) ms"
            if ($Credential) {
                # Explicit credential = fresh auth (avoids double-hop from Start-Job identity)
                Connect-ExchangeServer -auto -AllowClobber -Credential $Credential | Out-Null
            }
            else {
                Connect-ExchangeServer -auto -AllowClobber | Out-Null
            }
            Write-Trace "Initialize-ExchangeShell: Connect-ExchangeServer done in $($swConn.ElapsedMilliseconds) ms (total $($swInit.ElapsedMilliseconds) ms)"
            return
        }
    }

    if (-not (Get-Command Get-Queue -ErrorAction SilentlyContinue)) {
        throw "Get-Queue cmdlet not available. Run on an Exchange Mailbox/Edge server with EMS."
    }
}

function Get-QueueLeafIdentity {
    param([string]$Identity)
    if ($Identity -match '\\([^\\]+)$') { return $Matches[1] }
    return $Identity
}

function Test-IsMailboxDelivery {
    param([string]$DeliveryType)
    return $DeliveryType -match 'SmtpDeliveryToMailbox|Mailbox|MapiDelivery'
}

function Test-IsRemoteDelivery {
    param([string]$DeliveryType)
    return $DeliveryType -match 'DnsConnectorDelivery|SmartHostConnectorDelivery|SmtpRelay|SmtpDeliveryToSmtp'
}

function Build-NamedQueueAggregates {
    param([object[]]$Queues)

    $agg = [ordered]@{
        poisonLength                    = 0
        submissionLength                = 0
        submissionDeferred              = 0
        activeMailboxDelivery           = 0
        externalActiveRemoteDelivery    = 0
        externalRemoteDeliveryTotal     = 0
        internalActiveRemoteDelivery    = 0
        internalRemoteDeliveryTotal     = 0
        mailboxRetryDelivery            = 0
    }

    foreach ($q in $Queues) {
        $leaf = Get-QueueLeafIdentity -Identity ([string]$q.Identity)
        $count = [int]$q.MessageCount
        $status = [string]$q.Status
        $cat = [string]$q.NextHopCategory
        $dtype = [string]$q.DeliveryType
        $isActive = $status -match '^(Active|Ready)$'

        if ($leaf -eq 'Poison') {
            $agg.poisonLength += $count
        }
        if ($leaf -eq 'Submission') {
            $agg.submissionLength += $count
            $agg.submissionDeferred += [int]$q.DeferredMessageCount
        }

        if (Test-IsMailboxDelivery -DeliveryType $dtype) {
            if ($isActive) { $agg.activeMailboxDelivery += $count }
            if ($status -eq 'Retry') { $agg.mailboxRetryDelivery += $count }
        }

        if ($cat -eq 'External' -or (Test-IsRemoteDelivery -DeliveryType $dtype -and $cat -ne 'Internal')) {
            $agg.externalRemoteDeliveryTotal += $count
            if ($isActive) { $agg.externalActiveRemoteDelivery += $count }
        }

        if ($cat -eq 'Internal' -and $leaf -notin @('Submission', 'Poison', 'Unreachable') -and (Test-IsRemoteDelivery -DeliveryType $dtype -or $dtype -match 'Smtp|Remote')) {
            $agg.internalRemoteDeliveryTotal += $count
            if ($isActive) { $agg.internalActiveRemoteDelivery += $count }
        }
        elseif ($cat -eq 'Internal' -and $leaf -notin @('Submission', 'Poison', 'Unreachable') -and -not (Test-IsMailboxDelivery -DeliveryType $dtype)) {
            # Other internal delivery queues (site/DAG next hops)
            $agg.internalRemoteDeliveryTotal += $count
            if ($isActive) { $agg.internalActiveRemoteDelivery += $count }
        }
    }

    return [PSCustomObject]$agg
}

function Get-DatabaseCopySnapshot {
    if (-not (Get-Command Get-MailboxDatabaseCopyStatus -ErrorAction SilentlyContinue)) {
        return @()
    }
    try {
        return @(Get-MailboxDatabaseCopyStatus -Local -ErrorAction Stop | ForEach-Object {
            $mounted = 0
            $status = [string]$_.Status
            if ($status -eq 'Mounted') { $mounted = 1 }
            [PSCustomObject]@{
                name             = [string]$_.Name
                databaseName     = [string]$_.DatabaseName
                mailboxServer    = [string]$_.MailboxServer
                status           = $status
                copyQueueLength  = [int]($_.CopyQueueLength)
                replayQueueLength= [int]($_.ReplayQueueLength)
                contentIndexState= [string]$_.ContentIndexState
                mounted          = $mounted
            }
        })
    }
    catch {
        return @()
    }
}

function Get-CounterValue {
    param([string]$Path)
    try {
        $samples = Get-Counter -Counter $Path -ErrorAction Stop
        $vals = @($samples.CounterSamples | ForEach-Object { [double]$_.CookedValue })
        if ($vals.Count -eq 0) { return $null }
        # Prefer _Total instance when present; otherwise sum
        $total = $samples.CounterSamples | Where-Object { $_.InstanceName -eq '_Total' } | Select-Object -First 1
        if ($total) { return [double]$total.CookedValue }
        return ($vals | Measure-Object -Sum).Sum
    }
    catch {
        return $null
    }
}

function Get-FirstCounterValue {
    param([string[]]$Paths)
    # First path that exists and returns a value wins; counter names differ between Exchange versions.
    foreach ($path in $Paths) {
        $v = Get-CounterValue $path
        if ($null -ne $v) { return $v }
    }
    return $null
}

function Get-PerfCounterSnapshot {
    # Exchange 2016/2019 counters first, then the older names as fallback.
    [PSCustomObject][ordered]@{
        successfulSubmissionsPerSec       = Get-FirstCounterValue @(
            '\MSExchange Submission\Successful Submissions Per Second',
            '\MSExchange Mail Submission(*)\Successful Submissions/sec')
        temporarySubmissionFailuresPerSec = Get-FirstCounterValue @(
            '\MSExchange Submission\Temporary Submission Failures/sec',
            '\MSExchange Mail Submission(*)\Temporary Submission Failures/sec')
        failedSubmissionsPerSec           = Get-FirstCounterValue @(
            '\MSExchange Submission\Failed Submissions Per Second')
        hubServersInRetry                 = Get-FirstCounterValue @(
            '\MSExchange Mail Submission(*)\Hub Servers In Retry')
        messagesQueuedForSubmission       = Get-FirstCounterValue @(
            '\MSExchange Submission\Pending Submissions',
            '\MSExchangeIS Store(*)\Messages Queued For Submission',
            '\MSExchangeIS Mailbox(*)\Messages Queued For Submission')
    }
}

function Get-ServiceSnapshot {
    # Maps customer-facing labels to Windows service names
    $map = @(
        @{ label = 'MSExchangeTransport'; name = 'MSExchangeTransport' },
        @{ label = 'MSExchangeIS'; name = 'MSExchangeIS' },
        @{ label = 'MSExchangeFrontEndTransport'; name = 'MSExchangeFrontendTransport' },
        @{ label = 'MSExchangeMailboxAssistants'; name = 'MSExchangeMailboxAssistants' },
        @{ label = 'MSExchangeReplicationService'; name = 'MSExchangeRepl' },
        @{ label = 'Microsoft Exchange Mailbox Replication Service'; name = 'MSExchangeMailboxReplication' },
        @{ label = 'Microsoft Exchange Mailbox Transport Submission'; name = 'MSExchangeSubmission' },
        @{ label = 'Microsoft Exchange Mailbox Transport Delivery'; name = 'MSExchangeDelivery' },
        @{ label = 'World Wide Web Publishing Service (W3SVC)'; name = 'W3SVC' },
        @{ label = 'Microsoft Exchange RPC Client Access'; name = 'MSExchangeRPC' },
        @{ label = 'Microsoft Exchange Search Host Controller'; name = 'HostControllerService' },
        @{ label = 'Microsoft Exchange Search'; name = 'MSExchangeFastSearch' },
        @{ label = 'Microsoft Exchange Service Host'; name = 'MSExchangeServiceHost' },
        @{ label = 'Microsoft Exchange Throttling'; name = 'MSExchangeThrottling' },
        @{ label = 'Microsoft Exchange Transport Log Search'; name = 'MSExchangeTransportLogSearch' },
        @{ label = 'Microsoft Exchange Compliance Audit'; name = 'MSComplianceAudit' },
        @{ label = 'Microsoft Exchange Active Directory Topology'; name = 'MSExchangeADTopology' },
        @{ label = 'Microsoft Exchange Anti-spam Update'; name = 'MSExchangeAntispamUpdate' },
        @{ label = 'Microsoft Exchange Compliance Service'; name = 'MSExchangeCompliance' },
        @{ label = 'Microsoft Exchange DAG Management'; name = 'MSExchangeDagMgmt' },
        @{ label = 'Microsoft Exchange Diagnostics'; name = 'MSExchangeDiagnostics' },
        @{ label = 'Microsoft Exchange EdgeSync'; name = 'MSExchangeEdgeSync' },
        @{ label = 'Microsoft Exchange Flighting Service'; name = 'MSExchangeFlighting' },
        @{ label = 'Microsoft Exchange Health Manager'; name = 'MSExchangeHM' },
        @{ label = 'Microsoft Exchange Health Manager Recovery'; name = 'MSExchangeHMRecovery' },
        @{ label = 'Microsoft Exchange IMAP4'; name = 'MSExchangeImap4' },
        @{ label = 'Microsoft Exchange IMAP4 Backend'; name = 'MSExchangeIMAP4BE' },
        @{ label = 'Microsoft Exchange Emergency Mitigation Service'; name = 'MSExchangeMitigation' },
        @{ label = 'Microsoft Exchange POP3'; name = 'MSExchangePop3' },
        @{ label = 'Microsoft Exchange POP3 Backend'; name = 'MSExchangePOP3BE' },
        @{ label = 'Tracing Service for Search in Exchange'; name = 'SearchExchangeTracing' },
        @{ label = 'Microsoft Exchange Server Extension for Windows Server Backup'; name = 'wsbexchange' },
        @{ label = 'IIS Admin Service'; name = 'IISADMIN' },
        @{ label = 'ClusterService'; name = 'ClusSvc' }
    )

    # One enumeration of all services, then lookups. Calling Get-Service -Name per entry raises an
    # error record for every service that is not installed, which dominated this stage.
    $swSvc = [System.Diagnostics.Stopwatch]::StartNew()
    $installed = @{}
    foreach ($s in @(Get-Service -ErrorAction SilentlyContinue)) {
        $installed[$s.Name] = $s
    }
    Write-Trace "Get-ServiceSnapshot: enumerated $($installed.Count) services in $($swSvc.ElapsedMilliseconds) ms"

    $services = @()
    foreach ($item in $map) {
        $svc = $installed[$item.name]
        if ($null -eq $svc) {
            $services += [PSCustomObject]@{
                label  = $item.label
                name   = $item.name
                status = 'NotInstalled'
                running = 0
                present = 0
            }
            continue
        }
        $running = if ($svc.Status -eq 'Running') { 1 } else { 0 }
        $services += [PSCustomObject]@{
            label   = $item.label
            name    = $item.name
            status  = [string]$svc.Status
            running = $running
            present = 1
        }
    }

    # Cluster network (optional FailoverClusters module). Only look when the cluster service is
    # installed: Get-Command may auto-load the module, and without a cluster the result is empty anyway.
    $swCluster = [System.Diagnostics.Stopwatch]::StartNew()
    $clusterNetworks = @()
    $clusterNodes = @()
    $clusterInstalled = [bool]($services | Where-Object { $_.name -eq 'ClusSvc' -and $_.present -eq 1 })
    if ($clusterInstalled -and (Get-Command Get-ClusterNetwork -ErrorAction SilentlyContinue)) {
        try {
            $clusterNetworks = @(Get-ClusterNetwork -ErrorAction Stop | ForEach-Object {
                $up = if ([string]$_.State -eq 'Up') { 1 } else { 0 }
                [PSCustomObject]@{
                    name  = [string]$_.Name
                    state = [string]$_.State
                    up    = $up
                }
            })
        }
        catch {
            $clusterNetworks = @()
        }
    }
    if ($clusterInstalled -and (Get-Command Get-ClusterNode -ErrorAction SilentlyContinue)) {
        try {
            $clusterNodes = @(Get-ClusterNode -ErrorAction Stop | ForEach-Object {
                [PSCustomObject]@{
                    name  = [string]$_.Name
                    state = [string]$_.State
                    up    = $(if ([string]$_.State -eq 'Up') { 1 } else { 0 })
                }
            })
        }
        catch {
            $clusterNodes = @()
        }
    }
    Write-Trace "Get-ServiceSnapshot: cluster networks (clusterInstalled=$clusterInstalled) took $($swCluster.ElapsedMilliseconds) ms"

    return [PSCustomObject]@{
        services         = $services
        clusterNetworks  = $clusterNetworks
        clusterNodes     = $clusterNodes
    }
}

function Get-ExchangeHealthSnapshot {
    param(
        [switch]$ExcludeEmpty,
        [int]$MinMessageCount,
        [string[]]$DeliveryTypeFilter,
        [switch]$IncludeDigest,
        [switch]$IncludeDatabase,
        [switch]$IncludeCounters,
        [switch]$IncludeServices,
        [System.Management.Automation.PSCredential]$Credential
    )

    $swTotal = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Trace "Get-ExchangeHealthSnapshot: start (db=$IncludeDatabase counters=$IncludeCounters services=$IncludeServices digest=$IncludeDigest)"

    Initialize-ExchangeShell -Credential $Credential

    # Single Get-Queue pass. Named aggregates need the unfiltered view for operator parity, and the
    # reported queue list is the same set with empty queues dropped client-side. (This used to be two
    # Get-Queue calls: one with -Exclude Empty, one unfiltered.)
    $swStage = [System.Diagnostics.Stopwatch]::StartNew()
    $allQueues = @(Get-Queue | ForEach-Object {
        [PSCustomObject]@{
            Identity             = [string]$_.Identity
            DeliveryType         = [string]$_.DeliveryType
            Status               = [string]$_.Status
            MessageCount         = [int]($_.MessageCount)
            NextHopDomain        = [string]$_.NextHopDomain
            NextHopCategory      = [string]$_.NextHopCategory
            NextHopConnector     = [string]$_.NextHopConnector
            Velocity             = if ($null -ne $_.Velocity) { [double]$_.Velocity } else { $null }
            RiskLevel            = [string]$_.RiskLevel
            LastError            = [string]$_.LastError
            LastRetryTime        = if ($_.LastRetryTime) { $_.LastRetryTime.ToString("o") } else { $null }
            NextRetryTime        = if ($_.NextRetryTime) { $_.NextRetryTime.ToString("o") } else { $null }
            DeferredMessageCount = if ($null -ne $_.DeferredMessageCount) { [int]$_.DeferredMessageCount } else { 0 }
            LockedMessageCount   = if ($null -ne $_.LockedMessageCount) { [int]$_.LockedMessageCount } else { 0 }
            IncomingRate         = if ($null -ne $_.IncomingRate) { [double]$_.IncomingRate } else { $null }
            OutgoingRate         = if ($null -ne $_.OutgoingRate) { [double]$_.OutgoingRate } else { $null }
        }
    })
    Write-Trace "Get-Queue: $($allQueues.Count) queues in $($swStage.ElapsedMilliseconds) ms"

    $queues = $allQueues
    if ($ExcludeEmpty) {
        $queues = @($queues | Where-Object { $_.MessageCount -gt 0 })
    }

    if ($MinMessageCount -gt 0) {
        $queues = @($queues | Where-Object { $_.MessageCount -ge $MinMessageCount })
    }

    if ($DeliveryTypeFilter -and $DeliveryTypeFilter.Count -gt 0) {
        $set = [System.Collections.Generic.HashSet[string]]::new([string[]]$DeliveryTypeFilter, [StringComparer]::OrdinalIgnoreCase)
        $queues = @($queues | Where-Object { $set.Contains([string]$_.DeliveryType) })
    }

    $serverName = $env:COMPUTERNAME
    if ($queues.Count -gt 0 -and $queues[0].Identity -match '^([^\\]+)\\') {
        $serverName = $Matches[1]
    }

    $digest = @()
    if ($IncludeDigest -and (Get-Command Get-QueueDigest -ErrorAction SilentlyContinue)) {
        $swStage.Restart()
        try {
            $digest = @(Get-QueueDigest -Servers $serverName -ErrorAction Stop | ForEach-Object {
                [PSCustomObject]@{
                    Server       = [string]($_.Server)
                    MessageCount = [int]($_.MessageCount)
                    QueueCount   = if ($null -ne $_.QueueCount) { [int]$_.QueueCount } else { $null }
                    DeliveryType = [string]$_.DeliveryType
                    Status       = [string]$_.Status
                }
            })
        }
        catch {
            Write-Trace "Get-QueueDigest failed: $($_.Exception.Message)"
            $digest = @()
        }
        Write-Trace "Get-QueueDigest: $($digest.Count) rows in $($swStage.ElapsedMilliseconds) ms"
    }

    # Named aggregates always computed from the unfiltered EMS view for operator parity on those KPIs
    $named = Build-NamedQueueAggregates -Queues $allQueues

    $packWarnings = New-Object System.Collections.Generic.List[string]

    $databases = @()
    if ($IncludeDatabase) {
        $swStage.Restart()
        try {
            $databases = @(Get-DatabaseCopySnapshot)
        }
        catch {
            Write-Trace "database copy status failed: $($_.Exception.Message)"
            $packWarnings.Add("database: $($_.Exception.Message)")
            $databases = @()
        }
        Write-Trace "Get-MailboxDatabaseCopyStatus: $($databases.Count) copies in $($swStage.ElapsedMilliseconds) ms"
    }

    $counters = $null
    if ($IncludeCounters) {
        $swStage.Restart()
        try {
            $counters = Get-PerfCounterSnapshot
        }
        catch {
            Write-Trace "perf counters failed: $($_.Exception.Message)"
            $packWarnings.Add("counters: $($_.Exception.Message)")
            $counters = $null
        }
        Write-Trace "Get-Counter snapshot finished in $($swStage.ElapsedMilliseconds) ms"
    }

    $serviceBlock = $null
    if ($IncludeServices) {
        $swStage.Restart()
        try {
            $serviceBlock = Get-ServiceSnapshot
        }
        catch {
            Write-Trace "service snapshot failed: $($_.Exception.Message)"
            $packWarnings.Add("services: $($_.Exception.Message)")
            $serviceBlock = $null
        }
        Write-Trace "Service snapshot finished in $($swStage.ElapsedMilliseconds) ms"
    }

    Write-Trace "Get-ExchangeHealthSnapshot: done in $($swTotal.ElapsedMilliseconds) ms"

    [PSCustomObject]@{
        collectedAt = (Get-Date).ToUniversalTime().ToString("o")
        server      = $serverName
        queues      = $queues
        digest      = $digest
        namedQueues = $named
        databases   = $databases
        counters    = $counters
        services    = if ($serviceBlock) { $serviceBlock.services } else { @() }
        clusterNetworks = if ($serviceBlock) { $serviceBlock.clusterNetworks } else { @() }
        clusterNodes    = if ($serviceBlock) { $serviceBlock.clusterNodes } else { @() }
        meta        = [PSCustomObject]@{
            queueCount        = $queues.Count
            totalMessageCount = [int](($queues | Measure-Object -Property MessageCount -Sum).Sum)
            excludeEmpty      = [bool]$ExcludeEmpty
            minMessageCount   = $MinMessageCount
            source            = "Get-Queue"
            packWarnings      = @($packWarnings)
        }
    }
}

$deliveryFilter = @()
if ($DeliveryTypes -and $DeliveryTypes.Trim().Length -gt 0) {
    $deliveryFilter = @($DeliveryTypes.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

# Default: collect full health pack when switches omitted (LOCAL activation enables via Python)
if (-not $PSBoundParameters.ContainsKey('IncludeDatabase')) { $IncludeDatabase = $true }
if (-not $PSBoundParameters.ContainsKey('IncludeCounters')) { $IncludeCounters = $true }
if (-not $PSBoundParameters.ContainsKey('IncludeServices')) { $IncludeServices = $true }

$scriptBlock = {
    param($ExcludeEmpty, $MinMessageCount, $DeliveryTypeFilter, $IncludeDigest, $IncludeDatabase, $IncludeCounters, $IncludeServices, $FunctionDef, $Credential)
    Invoke-Expression $FunctionDef
    Get-ExchangeHealthSnapshot -ExcludeEmpty:$ExcludeEmpty -MinMessageCount $MinMessageCount `
        -DeliveryTypeFilter $DeliveryTypeFilter -IncludeDigest:$IncludeDigest `
        -IncludeDatabase:$IncludeDatabase -IncludeCounters:$IncludeCounters -IncludeServices:$IncludeServices `
        -Credential $Credential
}

# Embed real function bodies for Invoke-Command / Start-Process child sessions.
# .Definition MUST be inside $() - otherwise @" "@ expands only the CommandInfo name
# and leaves a literal ".Definition", which remote sessions try to execute as a command
# (e.g. "Get-ExchangeHealthSnapshot.Definition is not recognized").
$functionDef = @(
    foreach ($fnName in @(
            "Write-Trace",
            "Initialize-ExchangeShell",
            "Get-QueueLeafIdentity",
            "Test-IsMailboxDelivery",
            "Test-IsRemoteDelivery",
            "Build-NamedQueueAggregates",
            "Get-DatabaseCopySnapshot",
            "Get-CounterValue",
            "Get-FirstCounterValue",
            "Get-PerfCounterSnapshot",
            "Get-ServiceSnapshot",
            "Get-ExchangeHealthSnapshot"
        )) {
        $body = (Get-Command -Name $fnName -CommandType Function -ErrorAction Stop).Definition
        "function $fnName {`n$body`n}"
    }
) -join "`n"

# Keep Get-QueueSnapshot name as alias for older wrappers
function Get-QueueSnapshot {
    param(
        [switch]$ExcludeEmpty,
        [int]$MinMessageCount,
        [string[]]$DeliveryTypeFilter,
        [switch]$IncludeDigest
    )
    Get-ExchangeHealthSnapshot -ExcludeEmpty:$ExcludeEmpty -MinMessageCount $MinMessageCount `
        -DeliveryTypeFilter $DeliveryTypeFilter -IncludeDigest:$IncludeDigest `
        -IncludeDatabase:$IncludeDatabase -IncludeCounters:$IncludeCounters -IncludeServices:$IncludeServices
}

$argList = @(
    [bool]$ExcludeEmpty,
    $MinMessageCount,
    $deliveryFilter,
    [bool]$IncludeDigest,
    [bool]$IncludeDatabase,
    [bool]$IncludeCounters,
    [bool]$IncludeServices,
    $functionDef,
    $Credential
)

if ($ComputerName -and $ComputerName.Trim().Length -gt 0) {
    $icmParams = @{
        ComputerName = $ComputerName
        ScriptBlock  = $scriptBlock
        ArgumentList = $argList
    }
    if ($Credential) {
        $icmParams["Credential"] = $Credential
    }
    $result = Invoke-Command @icmParams
}
elseif ($Credential) {
    # LOCAL run-as under OneAgent (LOCAL SERVICE):
    # - WinRM loopback + EMS snap-in hits ADInvalidCredentialException (network logon / AD hop).
    # - Start-Process -Credential is often Access Denied for LOCAL SERVICE.
    # Prefer Scheduled Task (Task Scheduler logs the vault user on with a batch logon).
    $localRunAsErrors = New-Object System.Collections.Generic.List[string]
    $result = $null

    function Grant-RunAsFolderAccess {
        param([string]$Path, [string]$UserName)
        try {
            $acl = Get-Acl -LiteralPath $Path
            foreach ($id in @($UserName, "Everyone")) {
                $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    $id, "Modify", "ContainerInherit,ObjectInherit", "None", "Allow"
                )
                $acl.AddAccessRule($rule)
            }
            Set-Acl -LiteralPath $Path -AclObject $acl
            return
        }
        catch { }
        $icacls = Join-Path $env:WINDIR "System32\icacls.exe"
        if (-not (Test-Path -LiteralPath $icacls)) { return }
        foreach ($grant in @("${UserName}:(OI)(CI)M", "Everyone:(OI)(CI)M")) {
            try {
                & $icacls $Path /grant $grant /Q 2>$null | Out-Null
            }
            catch { }
        }
    }

    function Remove-RunAsFolder {
        param([string]$Path)
        if ([string]::IsNullOrWhiteSpace($Path)) { return }
        try {
            if (Test-Path -LiteralPath $Path) {
                Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            }
        }
        catch { }
    }

    $token = [guid]::NewGuid().ToString("N")
    $taskName = "Dynatrace-ExchangeQueue-$token"
    # The extension passes the name it will delete if it has to kill this script at its timeout.
    if ($env:EXCHANGE_QUEUE_TASKNAME -like 'Dynatrace-ExchangeQueue-*') {
        $taskName = $env:EXCHANGE_QUEUE_TASKNAME
    }
    $workRoot = $null
    $ownedWorkRoot = $false
    $fnFile = $null
    $wrapper = $null
    $outFile = $null
    $errFile = $null
    $plainPass = $null

    try {
        $preferred = $env:EXCHANGE_QUEUE_WORKDIR
        if (-not [string]::IsNullOrWhiteSpace($preferred) -and (Test-Path -LiteralPath $preferred)) {
            $workRoot = $preferred.TrimEnd('\', '/')
        }
        else {
            $workBases = New-Object System.Collections.Generic.List[string]
            foreach ($base in @(
                    $(if ($env:WINDIR) { Join-Path $env:WINDIR "Temp" } else { $null }),
                    $([System.IO.Path]::GetTempPath()),
                    $env:TEMP,
                    $env:TMP
                )) {
                if (-not [string]::IsNullOrWhiteSpace($base)) {
                    $trimmed = $base.TrimEnd('\', '/')
                    if (-not $workBases.Contains($trimmed)) { [void]$workBases.Add($trimmed) }
                }
            }
            $scriptDir = $PSScriptRoot
            if ([string]::IsNullOrWhiteSpace($scriptDir) -and $MyInvocation.MyCommand.Path) {
                $scriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Path
            }
            if (-not [string]::IsNullOrWhiteSpace($scriptDir)) {
                $assetWork = Join-Path $scriptDir ".runas_work"
                if (-not $workBases.Contains($assetWork)) { [void]$workBases.Add($assetWork) }
            }

            $workErrors = @()
            foreach ($base in $workBases) {
                $candidate = Join-Path $base ("eqrun-" + $token)
                try {
                    New-Item -ItemType Directory -Force -Path $candidate -ErrorAction Stop | Out-Null
                    $probe = Join-Path $candidate ".probe"
                    [System.IO.File]::WriteAllText($probe, "ok")
                    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
                    Grant-RunAsFolderAccess -Path $candidate -UserName $Credential.UserName
                    $workRoot = $candidate
                    $ownedWorkRoot = $true
                    break
                }
                catch {
                    $workErrors += "$candidate => $($_.Exception.Message)"
                    Remove-RunAsFolder -Path $candidate
                }
            }
            if (-not $workRoot) {
                throw "no writable work directory. Tried: $($workErrors -join '; ')"
            }
        }

        Grant-RunAsFolderAccess -Path $workRoot -UserName $Credential.UserName

        $fnFile = Join-Path $workRoot "fn.ps1"
        $wrapper = Join-Path $workRoot "run.ps1"
        $outFile = Join-Path $workRoot "out.json"
        $errFile = Join-Path $workRoot "err.txt"
        $traceFile = Join-Path $workRoot "trace.txt"
        $script:ExqTraceFile = $traceFile
        Write-Trace "LOCAL run-as: start (outer user=$env:USERDOMAIN\$env:USERNAME, runAs=$($Credential.UserName), workRoot=$workRoot, ownedWorkRoot=$ownedWorkRoot)"

        $deliveryLiteral = @(
            foreach ($d in @($deliveryFilter)) {
                "'" + ([string]$d).Replace("'", "''") + "'"
            }
        ) -join ", "

        # Child runs as the vault user (task or Start-Process); use process identity for EMS/AD.
        $wrapperBody = @'
$ErrorActionPreference = "Stop"
try {
    $script:ExqTraceFile = "__TRACE__"
    . "__FN__"
    Write-Trace "child: started as $env:USERDOMAIN\$env:USERNAME (profile=$env:USERPROFILE)"
    $deliveryFilter = @(__DELIVERY__)
    $result = Get-ExchangeHealthSnapshot `
        -ExcludeEmpty:__EXEMPTY__ `
        -MinMessageCount __MINMSG__ `
        -DeliveryTypeFilter $deliveryFilter `
        -IncludeDigest:__DIGEST__ `
        -IncludeDatabase:__DB__ `
        -IncludeCounters:__CTR__ `
        -IncludeServices:__SVC__
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText("__OUT__", ($result | ConvertTo-Json -Depth 8 -Compress), $utf8)
    Write-Trace "child: wrote out.json, exiting 0"
    exit 0
}
catch {
    try { Write-Trace "child: FAILED: $($_.Exception.Message)" } catch { }
    try {
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText("__ERR__", ($_ | Out-String), $utf8)
    }
    catch { }
    exit 1
}
'@
        $wrapperBody = $wrapperBody.
            Replace("__FN__", $fnFile).
            Replace("__DELIVERY__", $deliveryLiteral).
            Replace("__EXEMPTY__", ($(if ($ExcludeEmpty) { '$true' } else { '$false' }))).
            Replace("__MINMSG__", ([string][int]$MinMessageCount)).
            Replace("__DIGEST__", ($(if ($IncludeDigest) { '$true' } else { '$false' }))).
            Replace("__DB__", ($(if ($IncludeDatabase) { '$true' } else { '$false' }))).
            Replace("__CTR__", ($(if ($IncludeCounters) { '$true' } else { '$false' }))).
            Replace("__SVC__", ($(if ($IncludeServices) { '$true' } else { '$false' }))).
            Replace("__OUT__", $outFile).
            Replace("__ERR__", $errFile).
            Replace("__TRACE__", $traceFile)

        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($fnFile, $functionDef, $utf8)
        [System.IO.File]::WriteAllText($wrapper, $wrapperBody, $utf8)

        $psExe = (Get-Command powershell.exe -ErrorAction Stop).Source
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Credential.Password)
        try {
            $plainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        }
        finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }

        # --- 1) Scheduled Task (preferred) ---
        try {
            if (Test-Path -LiteralPath $outFile) { Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue }
            if (Test-Path -LiteralPath $errFile) { Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue }

            $argLine = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$wrapper`""
            $action = New-ScheduledTaskAction -Execute $psExe -Argument $argLine
            $settings = New-ScheduledTaskSettingsSet `
                -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries `
                -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
                -MultipleInstances IgnoreNew
            $swTask = [System.Diagnostics.Stopwatch]::StartNew()
            Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings `
                -User $Credential.UserName -Password $plainPass -Force -ErrorAction Stop | Out-Null
            Write-Trace "ScheduledTask: registered '$taskName' in $($swTask.ElapsedMilliseconds) ms"
            try {
                Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
                Write-Trace "ScheduledTask: started (+$($swTask.ElapsedMilliseconds) ms)"
                $deadline = (Get-Date).AddSeconds(120)
                $lastLoggedState = $null
                $lastHeartbeatMs = 0
                do {
                    Start-Sleep -Milliseconds 400
                    $state = (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State
                    if ($state -ne $lastLoggedState) {
                        Write-Trace "ScheduledTask: state=$state (+$($swTask.ElapsedMilliseconds) ms)"
                        $lastLoggedState = $state
                    }
                    elseif ($swTask.ElapsedMilliseconds - $lastHeartbeatMs -ge 10000) {
                        $lastHeartbeatMs = $swTask.ElapsedMilliseconds
                        Write-Trace "ScheduledTask: still $state (+$($swTask.ElapsedMilliseconds) ms, out.json=$(Test-Path -LiteralPath $outFile))"
                    }
                } while ($state -eq 'Running' -and (Get-Date) -lt $deadline)

                $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
                $last = if ($info) { [int]$info.LastTaskResult } else { -1 }
                Write-Trace "ScheduledTask: wait ended state=$state LastTaskResult=$last out.json=$(Test-Path -LiteralPath $outFile) err.txt=$(Test-Path -LiteralPath $errFile) (+$($swTask.ElapsedMilliseconds) ms)"

                if (Test-Path -LiteralPath $outFile) {
                    $result = Get-Content -LiteralPath $outFile -Raw -Encoding UTF8 | ConvertFrom-Json
                }
                elseif (Test-Path -LiteralPath $errFile) {
                    throw "task child failed (LastTaskResult=$last): $(Get-Content -LiteralPath $errFile -Raw)"
                }
                elseif ($state -eq 'Running') {
                    throw "task still running after timeout (LastTaskResult=$last)"
                }
                else {
                    throw "task finished without out.json (State=$state LastTaskResult=$last). Account needs 'Log on as a batch job' on this host; password must be valid."
                }
            }
            finally {
                try {
                    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
                }
                catch { }
            }
        }
        catch {
            Write-Trace "ScheduledTask: FAILED: $($_.Exception.Message.Trim()) [id=$($_.FullyQualifiedErrorId) cmd=$($_.InvocationInfo.MyCommand) line=$($_.InvocationInfo.ScriptLineNumber)]"
            $localRunAsErrors.Add("ScheduledTask: $($_.Exception.Message)") | Out-Null
            $result = $null
            try {
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
            }
            catch { }
        }

        # --- 2) Start-Process -Credential (often denied for LOCAL SERVICE) ---
        if ($null -eq $result) {
            Write-Trace "Start-Process fallback: starting (Scheduled Task path produced no result)"
            $swProc = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                if (Test-Path -LiteralPath $outFile) { Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue }
                if (Test-Path -LiteralPath $errFile) { Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue }

                try {
                    $proc = Start-Process -FilePath $psExe `
                        -ArgumentList @(
                            "-NoProfile",
                            "-NonInteractive",
                            "-ExecutionPolicy", "Bypass",
                            "-File", $wrapper
                        ) `
                        -Credential $Credential `
                        -WorkingDirectory $workRoot `
                        -Wait -PassThru -WindowStyle Hidden `
                        -ErrorAction Stop
                }
                catch {
                    throw ("AccessDenied/failed: {0}. LOCAL SERVICE often cannot CreateProcessWithLogonW.") -f `
                        $_.Exception.Message
                }

                if ($null -eq $proc) {
                    throw "returned no process"
                }
                Write-Trace "Start-Process fallback: child exited code=$($proc.ExitCode) after $($swProc.ElapsedMilliseconds) ms"
                if ($proc.ExitCode -ne 0) {
                    $errText = if (Test-Path -LiteralPath $errFile) {
                        Get-Content -LiteralPath $errFile -Raw
                    }
                    else {
                        "exit code $($proc.ExitCode) (no err.txt)"
                    }
                    throw "child failed: $errText"
                }
                if (-not (Test-Path -LiteralPath $outFile)) {
                    throw "produced no out.json under $workRoot (ACL?)"
                }
                $result = Get-Content -LiteralPath $outFile -Raw -Encoding UTF8 | ConvertFrom-Json
            }
            catch {
                Write-Trace "Start-Process fallback: FAILED after $($swProc.ElapsedMilliseconds) ms: $($_.Exception.Message)"
                $localRunAsErrors.Add("Start-Process: $($_.Exception.Message)") | Out-Null
                $result = $null
            }
        }
    }
    catch {
        $localRunAsErrors.Add("Setup: $($_.Exception.Message)") | Out-Null
        $result = $null
    }
    finally {
        $plainPass = $null
        # Housekeeping only when this run is not already close to the extension's 55 s limit.
        if (((Get-Date) - $script:ExqStart).TotalSeconds -lt 30) {
            Remove-StaleExchangeQueueTasks -KeepName $taskName
        }
        if ($ownedWorkRoot) {
            Remove-RunAsFolder -Path $workRoot
        }
        else {
            foreach ($f in @($fnFile, $wrapper, $outFile, $errFile)) {
                try {
                    if ($f -and (Test-Path -LiteralPath $f)) {
                        Remove-Item -LiteralPath $f -Force -ErrorAction Stop
                    }
                }
                catch { }
            }
        }
    }

    if ($null -eq $result) {
        throw (
            "LOCAL run-as failed for '$($Credential.UserName)'. " +
            "Tried Scheduled Task then Start-Process. " +
            "Details: $($localRunAsErrors -join ' | '). " +
            "On each Exchange OneAgent host grant this account 'Log on as a batch job' " +
            "(required for Scheduled Task). Confirm the vault password is current. " +
            "Note: WinRM loopback is not used for LOCAL EMS - it yields ADInvalidCredentialException " +
            "(Exchange AD hop from a network logon), which is not the same as a wrong password."
        )
    }
}
else {
    $result = Get-ExchangeHealthSnapshot -ExcludeEmpty:$ExcludeEmpty -MinMessageCount $MinMessageCount `
        -DeliveryTypeFilter $deliveryFilter -IncludeDigest:$IncludeDigest `
        -IncludeDatabase:$IncludeDatabase -IncludeCounters:$IncludeCounters -IncludeServices:$IncludeServices `
        -Credential $Credential
}

$result | ConvertTo-Json -Depth 8 -Compress
