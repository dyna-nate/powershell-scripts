<#
.SYNOPSIS
    Collect mailbox size and activity (Get-MailboxStatistics) and send it to the local OneAgent as MINT metric lines.

.DESCRIPTION
    Intended to run from its own Scheduled Task, much less often than the queue collector (default every
    30 minutes), because Get-MailboxStatistics is slow on large servers. Run it as an account that can read
    mailbox statistics (for example the View-Only Recipients role).

    Reads every mailbox on this server, then reports:
      - the top N mailboxes by TotalItemSize (default 50), one series per mailbox and metric
      - a total per database, over all mailboxes

    Metrics (all gauges, prefix custom.exchange). Per mailbox, dimensions exchange.server, exchange.environment,
    mailbox.name (display name) and database.name:
      mailbox.total_item_size_bytes / .total_deleted_item_size_bytes / .item_count
      mailbox.last_logon_age_seconds   (left out when the mailbox has never been logged on to)
      mailbox.over_limit               (0 or 1, extra dimension storage_limit_status)
    Per database, dimensions exchange.server, exchange.environment, database.name:
      database.mailbox_count / .mailbox_total_size_bytes / .mailbox_total_item_count
    Health, dimensions exchange.server, exchange.environment:
      mailbox.collector.success / .duration_ms / .mailboxes_scanned

    Mailbox display names become dimension values, so they are stored in Dynatrace.

.PARAMETER TopMailboxes
    How many of the largest mailboxes get their own series. Default 50.
.PARAMETER Endpoint
    OneAgent metric ingest URL.
.PARAMETER Prefix
    Metric key prefix. Default "custom.exchange".
.PARAMETER Environment
    Value of the exchange.environment dimension. Default "onprem".
.PARAMETER DryRun
    Print the MINT lines to stdout and do not send them.
#>
[CmdletBinding()]
param(
    [int]$TopMailboxes = 50,
    [string]$Endpoint = "http://127.0.0.1:14499/metrics/ingest",
    [string]$Prefix = "custom.exchange",
    [string]$Environment = "onprem",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$lines = New-Object System.Collections.Generic.List[string]
$server = $env:COMPUTERNAME

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
    $Dims = $Dims.Clone()
    $Dims["exchange.server"] = $server
    $Dims["exchange.environment"] = $Environment
    $dimText = ($Dims.GetEnumerator() | Where-Object { "$($_.Value)" -ne "" } | Sort-Object Name |
        ForEach-Object { "{0}={1}" -f $_.Name, (ConvertTo-DimValue $_.Value) }) -join ","
    $lines.Add(("{0}.{1},{2} gauge,{3}" -f $Prefix, $Key, $dimText, $num.ToString("R", $inv)))
}

function Initialize-ExchangeShell {
    if (Get-Command Get-MailboxStatistics -ErrorAction SilentlyContinue) { return }
    foreach ($name in "Microsoft.Exchange.Management.PowerShell.SnapIn", "Microsoft.Exchange.Management.PowerShell.E2010") {
        if (Get-PSSnapin -Name $name -Registered -ErrorAction SilentlyContinue) {
            Add-PSSnapin $name -ErrorAction SilentlyContinue
        }
    }
    if (Get-Command Get-MailboxStatistics -ErrorAction SilentlyContinue) { return }
    foreach ($path in "$env:ExchangeInstallPath\bin\RemoteExchange.ps1", "C:\Program Files\Microsoft\Exchange Server\V15\bin\RemoteExchange.ps1") {
        if ($path -and (Test-Path $path)) {
            . $path
            Connect-ExchangeServer -auto -ClientApplication:ManagementShell | Out-Null
            if (Get-Command Get-MailboxStatistics -ErrorAction SilentlyContinue) { return }
        }
    }
    throw "Exchange Management Shell is not available on this host (no snap-in, no RemoteExchange.ps1)."
}

# TotalItemSize is a ByteQuantifiedSize in a local session and a string such as
# "1.5 GB (1,610,612,736 bytes)" when the session is remote.
function ConvertTo-Bytes {
    param($Size)
    if ($null -eq $Size) { return $null }
    try { return [double]$Size.Value.ToBytes() } catch { }
    if ([string]$Size -match '\(([\d,\.]+)\s*bytes\)') { return [double](($Matches[1] -replace '[,\.]', '')) }
    return $null
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$scanned = 0
$failed = $false
try {
    Initialize-ExchangeShell

    $now = Get-Date
    $all = foreach ($m in @(Get-MailboxStatistics -Server $server -ErrorAction Stop)) {
        if ($m.DisconnectDate) { continue }
        [PSCustomObject]@{
            Name       = [string]$m.DisplayName
            Database   = [string]$m.DatabaseName
            Size       = ConvertTo-Bytes $m.TotalItemSize
            Deleted    = ConvertTo-Bytes $m.TotalDeletedItemSize
            Items      = if ($null -ne $m.ItemCount) { [double]$m.ItemCount } else { $null }
            LastLogon  = if ($m.LastLogonTime) { [datetime]$m.LastLogonTime } else { $null }
            LimitState = [string]$m.StorageLimitStatus
        }
    }
    $all = @($all)
    $scanned = $all.Count

    foreach ($g in ($all | Group-Object Database)) {
        $d = @{ "database.name" = $g.Name }
        Add-Metric "database.mailbox_count" $g.Count $d
        Add-Metric "database.mailbox_total_size_bytes" (($g.Group | Measure-Object Size -Sum).Sum) $d
        Add-Metric "database.mailbox_total_item_count" (($g.Group | Measure-Object Items -Sum).Sum) $d
    }

    foreach ($m in ($all | Sort-Object Size -Descending | Select-Object -First $TopMailboxes)) {
        $d = @{ "mailbox.name" = $m.Name; "database.name" = $m.Database }
        Add-Metric "mailbox.total_item_size_bytes" $m.Size $d
        Add-Metric "mailbox.total_deleted_item_size_bytes" $m.Deleted $d
        Add-Metric "mailbox.item_count" $m.Items $d
        if ($m.LastLogon) { Add-Metric "mailbox.last_logon_age_seconds" ([Math]::Max(0, ($now - $m.LastLogon).TotalSeconds)) $d }
        if ($m.LimitState) {
            $over = if ($m.LimitState -in "BelowLimit", "NoChecking") { 0 } else { 1 }
            Add-Metric "mailbox.over_limit" $over ($d + @{ storage_limit_status = $m.LimitState })
        }
    }
    Add-Metric "mailbox.collector.success" 1
}
catch {
    Write-Host "Collection failed: $($_.Exception.Message)"
    Add-Metric "mailbox.collector.success" 0
    $failed = $true
}
Add-Metric "mailbox.collector.mailboxes_scanned" $scanned
Add-Metric "mailbox.collector.duration_ms" $sw.ElapsedMilliseconds

if ($DryRun) {
    $lines
}
else {
    for ($i = 0; $i -lt $lines.Count; $i += 50000) {
        $chunk = $lines.GetRange($i, [Math]::Min(50000, $lines.Count - $i))
        $body = [System.Text.Encoding]::UTF8.GetBytes(($chunk -join "`n"))
        $resp = Invoke-WebRequest -Uri $Endpoint -Method Post -Body $body -UseBasicParsing `
            -ContentType "text/plain; charset=utf-8" -TimeoutSec 30
        Write-Host "Sent $($chunk.Count) lines to $Endpoint -> HTTP $($resp.StatusCode) $($resp.Content)"
    }
}

if ($failed) { exit 1 }
