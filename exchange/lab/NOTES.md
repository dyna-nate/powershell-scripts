# Lab: adding a second Exchange server (NKEXCH02)

Notes carried over from a Claude Code session in the `ExchangeQueue-tenant-handoff-1.2.17` project
(Nov 2026). The Exchange build number to version mapping and the Windows Server 2025
compatibility points came from memory and have not been checked against Microsoft's docs.

## Starting point

Output of `Get-ExchangeServer` / `Get-OrganizationConfig` / `Get-DatabaseAvailabilityGroup` on NKEXCH01:

- One server, `NKEXCH01`, Mailbox role, edition `StandardEvaluation` (180-day evaluation).
- `AdminDisplayVersion` 15.2 (Build 2562.17), which I believe is **Exchange Server SE RTM**, not 2019
  (2019 CU15 is 15.2.1748.x). Check against Microsoft's build-number list.
- Org name `Lab`, `ObjectVersion` 16763.
- No DAG exists yet.
- Exchange cmdlets only exist in the **Exchange Management Shell**, not plain Windows PowerShell.
  In a plain window, `Add-PSSnapin Microsoft.Exchange.Management.PowerShell.SnapIn` loads them.

New server target: Windows Server 2025 Datacenter Azure Edition, on-prem only.

## Plan

1. **Prepare NKEXCH02.** Run `Prepare-NKEXCH02.ps1` as a saved file on the new server (see below).
2. **Group membership.** On the DC, add the install account to `Organization Management`
   (and Schema/Enterprise Admins only if Setup has to update AD), then log off and on:
   `Add-ADGroupMember -Identity 'Organization Management' -Members <account>`
3. **Install Exchange SE** at the same build as NKEXCH01 or newer. Skip `/PrepareSchema` and
   `/PrepareAD` when the build matches:
   `.\Setup.exe /IAcceptExchangeServerLicenseTerms_DiagnosticDataOFF /Mode:Install /Roles:Mailbox`
   Let Setup's readiness check be the authority on prerequisites.
4. **Compare servers:** `Get-ExchangeServer | fl Name,Edition,AdminDisplayVersion` should show the
   same build on both. Compare virtual directory URLs, certificates and receive/send connectors.
5. **Optional DAG** (none exists):
   ```powershell
   New-DatabaseAvailabilityGroup -Name DAG01 -WitnessServer <non-Exchange server> -WitnessDirectory C:\DAG01 `
     -DatabaseAvailabilityGroupIpAddresses ([System.Net.IPAddress]::None)
   Add-DatabaseAvailabilityGroupServer -Identity DAG01 -MailboxServer NKEXCH01
   Add-DatabaseAvailabilityGroupServer -Identity DAG01 -MailboxServer NKEXCH02
   Add-MailboxDatabaseCopy -Identity <db> -MailboxServer NKEXCH02 -ActivationPreference 2
   ```
   The witness must not be either Exchange server.
6. **Metrics on NKEXCH02.** Install OneAgent and run the queue collector per host (LOCAL mode).

## Prepare-NKEXCH02.ps1: what happened on the first run

- Edit `$DomainName` and `$DnsServers` first. The lab DC is NateKunz-AD.lab.local at `10.50.0.4` (the script now has it; `10.0.0.4` was a placeholder).
- `Web-Lgcy-Mgmt-Console` is not a valid feature name on Server 2025, so the first
  `Install-WindowsFeature` call failed as a whole and installed nothing. The script now skips
  feature names the OS does not have and warns about them. Other IIS names may be missing too.
- Run it as a saved `.ps1`, not pasted line by line: pasted, a failed check's `throw` does not
  stop the lines after it. From an admin PowerShell:
  `Set-ExecutionPolicy -Scope Process Bypass -Force; cd C:\ExchangePrereqs; .\Prepare-NKEXCH02.ps1`
- The DC check tests TCP 389, not ping (Windows Firewall blocks ICMP by default).
- On Azure, set the static IP and DNS on the NIC or VNet, not inside the guest OS.
- Check the join: `Get-CimInstance Win32_ComputerSystem | fl Name,Domain,PartOfDomain`.

## Extension notes (Dynatrace `custom:exchange-queue`)

- The customer's **1.2.18** build fails with `FileNotFoundError ... site-packages\scripts\Get-ExchangeQueues.ps1`.
  The 1.2.17 wheel ships the script in `exchange_queue/assets/` and `scripts/`; the 1.2.18 build
  evidently does not. Use 1.2.17, or rebuild 1.2.18 with the `.ps1` included as package data.
- `exchange.environment` is hardcoded in `metrics.py` (`onprem` / `online`), not configurable.
- `mail_path` is classified per queue in `mail_path.py`; the only setting is `hybridHopDomains`.
- 1.2.17's docs only mention Exchange 2019 and Online. Check that it collects correctly on SE.

## Load test (queues and Mail-Flow data)

`Invoke-ExchangeLoadTest.ps1` fills the queues with messages that cannot be delivered: it creates `LT-*` Send
connectors to an unused smart host (default 10.50.0.250) and drops messages into the local Pickup folder.
Run it in an elevated PowerShell on an Exchange server (NKEXCH01 is enough; run `-Action Start` on both servers to load both):

```powershell
.\Invoke-ExchangeLoadTest.ps1 -Action Start -MessageCount 300   # create connectors, send, list queues
.\Invoke-ExchangeLoadTest.ps1 -Action Status                    # queues on every server
.\Invoke-ExchangeLoadTest.ps1 -Action Cleanup                   # delete test messages, then the connectors
```

partner1.example and partner2.example queue as `external_other`; contoso-com.mail.protection.outlook.com queues as
`hybrid_outbound`. Not run against a real server when written; check `Get-TransportService | fl PickupDirectoryPath` if nothing is picked up.
