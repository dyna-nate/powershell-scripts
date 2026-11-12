#Requires -RunAsAdministrator
# Run this as a saved .ps1 file (.\Prepare-NKEXCH02.ps1), not pasted line by line:
# pasted, a failed check's 'throw' no longer stops the lines after it.
$ErrorActionPreference = 'Stop'
# --- Edit these ---
$DomainName   = 'lab.local'          # your AD domain FQDN
$DnsServers   = @('10.0.0.4')        # your DC's IP
$NewName      = 'NKEXCH02'
$SetIpInGuest = $false               # leave $false on Azure; set DNS on the VNet/NIC instead
$InterfaceAlias = 'Ethernet'

$dl = 'C:\ExchangePrereqs'
New-Item -ItemType Directory -Path $dl -Force | Out-Null

# 1. DNS (only if not set at the Azure VNet level)
if ($SetIpInGuest) {
    Set-DnsClientServerAddress -InterfaceAlias $InterfaceAlias -ServerAddresses $DnsServers
}

# 2. Confirm the DC is reachable before joining
# (TCP 389 test, not ping: Windows Firewall blocks ICMP by default)
if (-not (Test-NetConnection $DnsServers[0] -Port 389 -InformationLevel Quiet)) { throw "Can't reach LDAP on DC at $($DnsServers[0])" }
Resolve-DnsName $DomainName -ErrorAction Stop | Out-Null

# 3. Windows features
$features = @(
 'Server-Media-Foundation','NET-Framework-45-Features','RPC-over-HTTP-proxy',
 'RSAT-Clustering','RSAT-Clustering-CmdInterface','RSAT-Clustering-Mgmt','RSAT-Clustering-PowerShell',
 'WAS-Process-Model','Web-Asp-Net45','Web-Basic-Auth','Web-Client-Auth','Web-Digest-Auth',
 'Web-Dir-Browsing','Web-Dyn-Compression','Web-Http-Errors','Web-Http-Logging','Web-Http-Redirect',
 'Web-Http-Tracing','Web-ISAPI-Ext','Web-ISAPI-Filter','Web-Lgcy-Mgmt-Console','Web-Metabase',
 'Web-Mgmt-Console','Web-Mgmt-Service','Web-Net-Ext45','Web-Request-Monitor','Web-Server',
 'Web-Stat-Compression','Web-Static-Content','Web-Windows-Auth','Web-WMI',
 'Windows-Identity-Foundation','RSAT-ADDS'
)
# Skip names this Windows build doesn't have (e.g. Web-Lgcy-Mgmt-Console is gone on Server 2025)
$missing = $features | Where-Object { -not (Get-WindowsFeature -Name $_) }
if ($missing) { Write-Warning "Not available on this OS, skipping: $($missing -join ', ')" }
Install-WindowsFeature -Name ($features | Where-Object { $_ -notin $missing }) | Format-Table Success, RestartNeeded, ExitCode

# 4. Downloads: URL Rewrite and Visual C++ runtimes
$files = @{
 'rewrite_amd64_en-US.msi' = 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi'
 'vcredist2012_x64.exe'    = 'https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x64.exe'
 'vcredist2013_x64.exe'    = 'https://aka.ms/highdpimfc2013x64enu'
}
foreach ($f in $files.GetEnumerator()) {
    Invoke-WebRequest -Uri $f.Value -OutFile (Join-Path $dl $f.Key) -UseBasicParsing
}
Start-Process msiexec.exe -ArgumentList "/i `"$dl\rewrite_amd64_en-US.msi`" /qn" -Wait
Start-Process "$dl\vcredist2012_x64.exe" -ArgumentList '/install /quiet /norestart' -Wait
Start-Process "$dl\vcredist2013_x64.exe" -ArgumentList '/install /quiet /norestart' -Wait

# 5. Join the domain and rename (prompts for domain admin credentials), then reboot
Add-Computer -DomainName $DomainName -NewName $NewName -Credential (Get-Credential "$DomainName\Administrator") -Restart
