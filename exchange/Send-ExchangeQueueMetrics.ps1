<#
.SYNOPSIS
    Run Get-ExchangeQueues.ps1 and send its results to the local OneAgent as MINT metric lines.

.DESCRIPTION
    Intended to run from a Windows Scheduled Task on an Exchange server that has a OneAgent.
    Calls the collector next to this script, converts the JSON to Dynatrace metric ingestion
    protocol (MINT) lines and POSTs them to the OneAgent local metric API
    (http://127.0.0.1:14499/metrics/ingest by default). The OneAgent adds the host dimensions.

    Metrics (all gauges; keys and dimensions mirror ExtensionYAML/extension.yaml):
      custom.exchange.queue.message_count / .deferred_count / .locked_count / .incoming_rate / .outgoing_rate / .velocity
      custom.exchange.queue.total_messages / .count                  (per server)
      custom.exchange.queue.poison.length, .submission.length, .submission.deferred, .active.mailbox.length,
        .external.active.length, .external.total.length, .internal.active.length, .internal.total.length,
        .retry.mailbox.length                                        (per server)
      custom.exchange.database.copy_queue_length / .replay_queue_length / .mounted
      custom.exchange.submission.successful.persec / .temp_failures.persec / .hub_servers_in_retry / .failed.persec
      custom.exchange.is.messages_queued_for_submission
      custom.exchange.service.running / .present
      custom.exchange.cluster.network.up
      custom.exchange.collector.success / .duration_ms

.PARAMETER Endpoint
    OneAgent metric ingest URL.
.PARAMETER Prefix
    Metric key prefix. Default "custom.exchange".
.PARAMETER DryRun
    Print the MINT lines to stdout and do not send them.
.PARAMETER ExcludeEmpty
.PARAMETER MinMessageCount
.PARAMETER DeliveryTypes
.PARAMETER IncludeDigest
.PARAMETER Credential
    Passed through to Get-ExchangeQueues.ps1.
#>
[CmdletBinding()]
param(
    [string]$Endpoint = "http://127.0.0.1:14499/metrics/ingest",
    [string]$Prefix = "custom.exchange",
    [switch]$DryRun,
    [switch]$ExcludeEmpty,
    [int]$MinMessageCount = 0,
    [string]$DeliveryTypes = "",
    [switch]$IncludeDigest,
    [System.Management.Automation.PSCredential]$Credential
)

$ErrorActionPreference = "Stop"
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$collector = Join-Path $PSScriptRoot "Get-ExchangeQueues.ps1"
$lines = New-Object System.Collections.Generic.List[string]

# Metric keys mirror ExtensionYAML/extension.yaml (the same keys the Python extension reports).
$namedKeys = @{
    poisonLength                 = "queue.poison.length"
    submissionLength             = "queue.submission.length"
    submissionDeferred           = "queue.submission.deferred"
    activeMailboxDelivery        = "queue.active.mailbox.length"
    externalActiveRemoteDelivery = "queue.external.active.length"
    externalRemoteDeliveryTotal  = "queue.external.total.length"
    internalActiveRemoteDelivery = "queue.internal.active.length"
    internalRemoteDeliveryTotal  = "queue.internal.total.length"
    mailboxRetryDelivery         = "queue.retry.mailbox.length"
}
$counterKeys = @{
    successfulSubmissionsPerSec       = "submission.successful.persec"
    temporarySubmissionFailuresPerSec = "submission.temp_failures.persec"
    failedSubmissionsPerSec           = "submission.failed.persec"      # not in the YAML
    hubServersInRetry                 = "submission.hub_servers_in_retry"
    messagesQueuedForSubmission       = "is.messages_queued_for_submission"
}

function ConvertTo-DimValue {
    param($Value)
    $s = [string]$Value
    if ($s.Length -gt 250) { $s = $s.Substring(0, 250) }
    '"' + ($s -replace '\\', '\\' -replace '"', '\"' -replace '[\r\n]+', ' ') + '"'
}

function Add-Metric {
    param([string]$Key, $Value, [hashtable]$Dims = @{})
    if ($null -eq $Value) { return }
    try { $num = [double]$Value } catch { return }
    if ([double]::IsNaN($num) -or [double]::IsInfinity($num)) { return }
    $dimText = ($Dims.GetEnumerator() | Where-Object { "$($_.Value)" -ne "" } | Sort-Object Name |
        ForEach-Object { "{0}={1}" -f $_.Name, (ConvertTo-DimValue $_.Value) }) -join ","
    $head = if ($dimText) { "$Prefix.$Key,$dimText" } else { "$Prefix.$Key" }
    $lines.Add(("{0} gauge,{1}" -f $head, $num.ToString("R", $inv)))
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$server = $env:COMPUTERNAME
try {
    $collectorArgs = @{ MinMessageCount = $MinMessageCount; DeliveryTypes = $DeliveryTypes }
    if ($ExcludeEmpty)  { $collectorArgs.ExcludeEmpty = $true }
    if ($IncludeDigest) { $collectorArgs.IncludeDigest = $true }
    if ($Credential)    { $collectorArgs.Credential = $Credential }

    $json = & $collector @collectorArgs | Out-String
    $data = $json | ConvertFrom-Json
    if ($data.server) { $server = [string]$data.server }
    $srv = @{ "exchange.server" = $server }

    foreach ($q in @($data.queues)) {
        $d = @{
            "exchange.server"   = $server
            "queue.identity"    = $q.Identity
            delivery_type       = $q.DeliveryType
            status              = $q.Status
            next_hop_domain     = $q.NextHopDomain
            next_hop_category   = $q.NextHopCategory
        }
        Add-Metric "queue.message_count"  $q.MessageCount $d
        Add-Metric "queue.deferred_count" $q.DeferredMessageCount $d
        Add-Metric "queue.locked_count"   $q.LockedMessageCount $d
        Add-Metric "queue.incoming_rate" $q.IncomingRate $d
        Add-Metric "queue.outgoing_rate" $q.OutgoingRate $d
        Add-Metric "queue.velocity"      $q.Velocity $d
    }
    Add-Metric "queue.count"          $data.meta.queueCount $srv
    Add-Metric "queue.total_messages" $data.meta.totalMessageCount $srv

    foreach ($p in $data.namedQueues.PSObject.Properties) {
        if ($namedKeys.ContainsKey($p.Name)) { Add-Metric $namedKeys[$p.Name] $p.Value $srv }
    }

    foreach ($r in @($data.digest)) {
        Add-Metric "queue.digest.message_count" $r.MessageCount @{
            "exchange.server" = $server; delivery_type = $r.DeliveryType; status = $r.Status }
    }

    foreach ($db in @($data.databases)) {
        $d = @{ "exchange.server" = $server; "database.copy" = $db.name; "database.name" = $db.databaseName
                "database.status" = $db.status }
        Add-Metric "database.copy_queue_length"   $db.copyQueueLength $d
        Add-Metric "database.replay_queue_length" $db.replayQueueLength $d
        Add-Metric "database.mounted"       $db.mounted $d
    }

    if ($data.counters) {
        foreach ($p in $data.counters.PSObject.Properties) {
            if ($counterKeys.ContainsKey($p.Name)) { Add-Metric $counterKeys[$p.Name] $p.Value $srv }
        }
    }

    foreach ($s in @($data.services)) {
        $d = @{ "exchange.server" = $server; service = $s.name; label = $s.label }
        Add-Metric "service.running" $s.running $d
        Add-Metric "service.present" $s.present $d
    }
    foreach ($n in @($data.clusterNetworks)) {
        Add-Metric "cluster.network.up" $n.up @{ "exchange.server" = $server; network = $n.name }
    }
    foreach ($w in @($data.meta.packWarnings)) {
        Write-Host "collector warning: $w"
    }
    Add-Metric "collector.success" 1 $srv
}
catch {
    Write-Host "Collection failed: $($_.Exception.Message)"
    Add-Metric "collector.success" 0 @{ "exchange.server" = $server }
    $failed = $true
}
Add-Metric "collector.duration_ms" $sw.ElapsedMilliseconds @{ "exchange.server" = $server }

if ($DryRun) {
    $lines
}
else {
    # OneAgent accepts up to 50,000 lines per request.
    for ($i = 0; $i -lt $lines.Count; $i += 50000) {
        $chunk = $lines.GetRange($i, [Math]::Min(50000, $lines.Count - $i))
        $body = [System.Text.Encoding]::UTF8.GetBytes(($chunk -join "`n"))
        $resp = Invoke-WebRequest -Uri $Endpoint -Method Post -Body $body -UseBasicParsing `
            -ContentType "text/plain; charset=utf-8" -TimeoutSec 30
        Write-Host "Sent $($chunk.Count) lines to $Endpoint -> HTTP $($resp.StatusCode) $($resp.Content)"
    }
}

if ($failed) { exit 1 }
