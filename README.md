# PowerShell scripts

A private collection of PowerShell scripts. Each script lives in a folder named after its area and
documents itself with comment-based help (`Get-Help .\<script>.ps1 -Full`).

| Script | Purpose |
|---|---|
| [`exchange/Get-ExchangeQueues.ps1`](exchange/Get-ExchangeQueues.ps1) | Collects Exchange transport queue, database copy, performance counter and service health data and prints it as one JSON object. |

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
