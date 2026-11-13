# PowerShell scripts

A collection of PowerShell scripts, plus the Dynatrace app that reads their metrics. Each script lives in a folder named after its area and
documents itself with comment-based help (`Get-Help .\<script>.ps1 -Full`).

| Script | Purpose |
|---|---|
| [`exchange/Get-ExchangeQueues.ps1`](exchange/Get-ExchangeQueues.ps1) | Collects Exchange transport queue, database copy, performance counter and service health data and prints it as one JSON object. |
| [`exchange/Send-ExchangeQueueMetrics.ps1`](exchange/Send-ExchangeQueueMetrics.ps1) | Runs the collector and sends the result to the local OneAgent as MINT metrics. Meant for a Scheduled Task. |
| [`exchange/Send-ExchangeMailboxMetrics.ps1`](exchange/Send-ExchangeMailboxMetrics.ps1) | Optional. Reads `Get-MailboxStatistics` and sends the top 50 mailboxes by size plus per-database totals as MINT metrics. Separate, slower Scheduled Task. |
| [`exchange/Install-ExchangeQueueMetrics.ps1`](exchange/Install-ExchangeQueueMetrics.ps1) | One-shot installer for an Exchange server: downloads the scripts, checks OneAgent/MINT, tests the credentials, registers the Scheduled Task. |

## exchange-ops-app

The **Exchange Ops** Dynatrace app (React and Strato, built with `dt-app`). It reads the
`custom.exchange.*` metrics these scripts send and shows queues, hybrid mail flow, database copies,
services, infrastructure and mailboxes. See [`exchange-ops-app/README.md`](exchange-ops-app/README.md).

```
cd exchange-ops-app && npm ci && npm test && npm run build
```

Set `environmentUrl` in `exchange-ops-app/app.config.json` to your tenant (it ships as `YOUR_ENV_ID`; keep your real value out of commits). Deploy with the scripts in `exchange-ops-app/scripts/` (they read a platform token from the environment;
never put a token in a file). `node_modules/`, `dist/`, `out/` and the `.dt-app/` token store are git-ignored.

## exchange/Get-ExchangeQueues.ps1

Collector used by the Dynatrace `custom:exchange-queue` extension. It can also be run on its own.

**Output.** One compressed JSON object on stdout (queues, queue digest, named queue aggregates,
database copies, performance counters, service and cluster network states). Progress lines with
timings go to stderr, so stdout stays valid JSON.

**Requirements.** Windows PowerShell 5.1 on an Exchange server with the Exchange Management Shell
or snap-in available. The account that runs it needs permission to run `Get-Queue`.

**Parameters.**

| Parameter | Meaning |
|---|---|
| `-ExcludeEmpty` | Leave empty queues out of the queue list. |
| `-MinMessageCount <n>` | Only list queues with at least `n` messages. |
| `-DeliveryTypes <list>` | Comma-separated delivery types to keep. |
| `-IncludeDigest` | Add `Get-QueueDigest` output (off by default). |
| `-IncludeDatabase`, `-IncludeCounters`, `-IncludeServices` | Database copies, performance counters, service states. All three are on unless you set them explicitly. |
| `-ComputerName <host>` | Run against a remote Exchange host over WinRM. |
| `-Credential <PSCredential>` | Account to run as. On the local host the script runs the collection as that account through a Scheduled Task (batch logon), falling back to `Start-Process -Credential`. |

**Examples.**

```powershell
# Local, on an Exchange server, as the current account
.\exchange\Get-ExchangeQueues.ps1 -ExcludeEmpty | ConvertFrom-Json

# Local, as a dedicated Exchange account
.\exchange\Get-ExchangeQueues.ps1 -ExcludeEmpty -Credential (Get-Credential)
```

**Known behavior of the `-Credential` (local) mode.**
- It registers a short-lived Scheduled Task named `Dynatrace-ExchangeQueue-<id>` for each run and
  removes it when the run ends. If a run is killed before it can finish, the task is left behind;
  thousands of leftover tasks can make the Windows Task Scheduler slow or unresponsive. The script
  removes old leftovers when the account may read `C:\Windows\System32\Tasks`.
- `EXCHANGE_QUEUE_TASKNAME` (must start with `Dynatrace-ExchangeQueue-`) sets the task name and
  `EXCHANGE_QUEUE_WORKDIR` sets the working folder; both are used by the extension.

**Origin.** Copied from the `exchange-queue-extension` repository (`scripts/Get-ExchangeQueues.ps1`,
commit `46672e8`). The two copies are not linked; keep them in sync by hand.

## Exchange metrics to Dynatrace

`Send-ExchangeQueueMetrics.ps1` runs the collector above and sends the result to the local OneAgent as MINT
metrics; `Install-ExchangeQueueMetrics.ps1` downloads both, checks the prerequisites, tests the account and
schedules the task. Requirements, install steps, validation in the tenant and troubleshooting are in
[exchange/README.md](exchange/README.md).
