<#
.SYNOPSIS
    Lab load test: fill Exchange transport queues so the metrics and the Exchange Ops app have something to show.

.DESCRIPTION
    Messages are routed to Send connectors whose smart host never answers, so they sit in Retry queues,
    one queue per destination domain. Each domain lands in a different mail_path:
      partner1.example, partner2.example                  -> external_other
      contoso-com.mail.protection.outlook.com             -> hybrid_outbound (matches the collector's hybrid suffixes)

    Run it in an elevated PowerShell on an Exchange server (the Exchange Management Shell, or a plain window:
    it loads the snap-in). The connectors are organization-wide, so create them once. The messages are written
    to the LOCAL Pickup folder, so to load both servers, run Start on each one.

    Actions
      Start    create the LT-* Send connectors if missing, drop -MessageCount messages into the Pickup folder, show queues
      Status   show the queues on every Exchange server
      Cleanup  delete the test messages from every server's queues, then remove the LT-* connectors

    Lab use only. It creates connectors and queues mail that can never be delivered.

.PARAMETER Action
    Start, Status or Cleanup.
.PARAMETER MessageCount
    Messages to create with Start. Default 300 (Pickup handles about 100 per minute by default).
.PARAMETER Sink
    IP address nothing listens on, used as the smart host. Default 10.50.0.250.
.PARAMETER Domains
    Destination domains. One connector and one queue per domain.
.PARAMETER Sender
    From address on the test messages. Default testuser1@lab.local.
.PARAMETER SubjectPrefix
    Subject prefix, used by Cleanup to find the test messages. Default "loadtest".

.EXAMPLE
    .\Invoke-ExchangeLoadTest.ps1 -Action Start -MessageCount 600
.EXAMPLE
    .\Invoke-ExchangeLoadTest.ps1 -Action Cleanup
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet("Start", "Status", "Cleanup")][string]$Action,
    [int]$MessageCount = 300,
    [string]$Sink = "10.50.0.250",
    [string[]]$Domains = @("partner1.example", "partner2.example", "contoso-com.mail.protection.outlook.com"),
    [string]$Sender = "testuser1@lab.local",
    [string]$SubjectPrefix = "loadtest"
)

$ErrorActionPreference = "Stop"
$connectorPrefix = "LT-"

function Initialize-ExchangeShell {
    if (Get-Command Get-SendConnector -ErrorAction SilentlyContinue) { return }
    foreach ($name in "Microsoft.Exchange.Management.PowerShell.SnapIn", "Microsoft.Exchange.Management.PowerShell.E2010") {
        if (Get-PSSnapin -Name $name -Registered -ErrorAction SilentlyContinue) { Add-PSSnapin $name -ErrorAction SilentlyContinue }
    }
    if (-not (Get-Command Get-SendConnector -ErrorAction SilentlyContinue)) {
        throw "Exchange cmdlets are not available. Run this on an Exchange server, in an elevated PowerShell."
    }
}

function Show-Queues {
    Write-Host "`nQueues (all servers):" -ForegroundColor Cyan
    $servers = @(Get-ExchangeServer | Where-Object { $_.IsMailboxServer -or $_.ServerRole -match "Mailbox" } | ForEach-Object { $_.Name })
    foreach ($s in $servers) {
        try {
            Get-Queue -Server $s | Sort-Object NextHopDomain |
                Format-Table @{n = "Server"; e = { $s } }, DeliveryType, Status, MessageCount, NextHopDomain, LastError -AutoSize
        }
        catch { Write-Warning "Get-Queue on $s failed: $($_.Exception.Message)" }
    }
}

Initialize-ExchangeShell

switch ($Action) {
    "Start" {
        $servers = @(Get-ExchangeServer | ForEach-Object { $_.Name })
        foreach ($d in $Domains) {
            $name = "$connectorPrefix$d"
            if (Get-SendConnector -Identity $name -ErrorAction SilentlyContinue) {
                Write-Host "Connector $name already exists"
            }
            else {
                New-SendConnector -Name $name -AddressSpaces $d -SmartHosts $Sink -DNSRoutingEnabled $false `
                    -SourceTransportServers $servers | Out-Null
                Write-Host "Created connector $name -> $Sink" -ForegroundColor Green
            }
        }

        $ts = Get-TransportService -Identity $env:COMPUTERNAME -ErrorAction Stop
        $pickup = if ($ts.PickupDirectoryPath) { [string]$ts.PickupDirectoryPath } else { Join-Path $env:ExchangeInstallPath "TransportRoles\Pickup" }
        if (-not (Test-Path -LiteralPath $pickup)) { throw "Pickup folder not found: $pickup" }
        Write-Host "Writing $MessageCount messages to $pickup"

        $tmp = Join-Path $env:TEMP "exchange-loadtest"
        New-Item -ItemType Directory -Path $tmp -Force | Out-Null
        $stamp = Get-Date -Format "yyyyMMddHHmmss"
        for ($i = 1; $i -le $MessageCount; $i++) {
            $d = $Domains[$i % $Domains.Count]
            $text = "From: $Sender`r`nTo: user$i@$d`r`nSubject: $SubjectPrefix $stamp-$i`r`nDate: $((Get-Date).ToString('r'))`r`n`r`nExchange lab load test message $i"
            $file = "lt-$stamp-$i.eml"
            Set-Content -LiteralPath (Join-Path $tmp $file) -Value $text -Encoding ASCII
            Move-Item -LiteralPath (Join-Path $tmp $file) -Destination $pickup
        }
        Write-Host "Done. Pickup delivers about 100 messages a minute; waiting 20 seconds before listing the queues."
        Start-Sleep -Seconds 20
        Show-Queues
        Write-Host "The collector runs every minute: refresh the app in 2 to 3 minutes. Run -Action Status to watch, -Action Cleanup when done." -ForegroundColor Cyan
    }
    "Status" { Show-Queues }
    "Cleanup" {
        # Messages first: with the connectors gone they would reroute into an Unreachable queue.
        foreach ($s in @(Get-ExchangeServer | ForEach-Object { $_.Name })) {
            try {
                $msgs = @(Get-Message -Server $s -Filter "Subject -like '$SubjectPrefix*'" -ResultSize Unlimited)
                if ($msgs.Count) {
                    $msgs | Remove-Message -WithNDR $false -Confirm:$false
                    Write-Host "Removed $($msgs.Count) test messages on $s" -ForegroundColor Green
                }
                else { Write-Host "No test messages on $s" }
            }
            catch { Write-Warning "Cleanup on $s failed: $($_.Exception.Message)" }
        }
        Get-SendConnector | Where-Object { $_.Name -like "$connectorPrefix*" } | ForEach-Object {
            Remove-SendConnector -Identity $_.Identity -Confirm:$false
            Write-Host "Removed connector $($_.Name)" -ForegroundColor Green
        }
        Show-Queues
    }
}
