<#
.SYNOPSIS
    Run Get-ExchangeQueues.ps1 and send its results to the local OneAgent as MINT metric lines.

.DESCRIPTION
    Intended to run from a Windows Scheduled Task on an Exchange server that has a OneAgent.
    Calls the collector next to this script, converts the JSON to Dynatrace metric ingestion
    protocol (MINT) lines and POSTs them to the OneAgent local metric API
    (http://127.0.0.1:14499/metrics/ingest by default). The OneAgent adds the host dimensions.

    Metrics (all gauges):
      custom.exchange.queue.messages / .deferred / .locked / .incoming_rate / .outgoing_rate / .velocity
      custom.exchange.queue.total_messages / .count                  (per server)
      custom.exchange.queue.named.<aggregate>                        (poison, submission, ... per server)
      custom.exchange.db.copy_queue_length / .replay_queue_length / .mounted
      custom.exchange.submission.<counter>                           (perf counters, per server)
      custom.exchange.service.running / .present
      custom.exchange.cluster.network_up
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
    $srv = @{ server = $server }

    foreach ($q in @($data.queues)) {
        $d = @{
            server        = $server
            queue         = $q.Identity
            delivery_type = $q.DeliveryType
            status        = $q.Status
            next_hop      = $q.NextHopDomain
            next_hop_category = $q.NextHopCategory
        }
        Add-Metric "queue.messages"      $q.MessageCount $d
        Add-Metric "queue.deferred"      $q.DeferredMessageCount $d
        Add-Metric "queue.locked"        $q.LockedMessageCount $d
        Add-Metric "queue.incoming_rate" $q.IncomingRate $d
        Add-Metric "queue.outgoing_rate" $q.OutgoingRate $d
        Add-Metric "queue.velocity"      $q.Velocity $d
    }
    Add-Metric "queue.count"          $data.meta.queueCount $srv
    Add-Metric "queue.total_messages" $data.meta.totalMessageCount $srv

    foreach ($p in $data.namedQueues.PSObject.Properties) {
        Add-Metric ("queue.named." + ($p.Name -creplace '([A-Z])', '_$1').ToLower()) $p.Value $srv
    }

    foreach ($r in @($data.digest)) {
        Add-Metric "queue.digest.messages" $r.MessageCount @{
            server = $server; delivery_type = $r.DeliveryType; status = $r.Status }
    }

    foreach ($db in @($data.databases)) {
        $d = @{ server = $server; database = $db.DatabaseName; copy_status = $db.status }
        Add-Metric "db.copy_queue_length"   $db.copyQueueLength $d
        Add-Metric "db.replay_queue_length" $db.replayQueueLength $d
        Add-Metric "db.mounted"             $db.mounted $d
    }

    if ($data.counters) {
        foreach ($p in $data.counters.PSObject.Properties) {
            Add-Metric ("submission." + ($p.Name -creplace '([A-Z])', '_$1').ToLower()) $p.Value $srv
        }
    }

    foreach ($s in @($data.services)) {
        $d = @{ server = $server; service = $s.name; label = $s.label }
        Add-Metric "service.running" $s.running $d
        Add-Metric "service.present" $s.present $d
    }
    foreach ($n in @($data.clusterNetworks)) {
        Add-Metric "cluster.network_up" $n.up @{ server = $server; network = $n.name }
    }
    foreach ($w in @($data.meta.packWarnings)) {
        Write-Host "collector warning: $w"
    }
    Add-Metric "collector.success" 1 $srv
}
catch {
    Write-Host "Collection failed: $($_.Exception.Message)"
    Add-Metric "collector.success" 0 @{ server = $server }
    $failed = $true
}
Add-Metric "collector.duration_ms" $sw.ElapsedMilliseconds @{ server = $server }

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
