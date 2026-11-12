# Exchange queue metrics for Dynatrace

Collects Exchange transport queue, database copy, performance counter and service health data on an Exchange
server every minute and sends it to the local Dynatrace OneAgent as `custom.exchange.*` metrics (metric ingestion
protocol, "MINT").

| File | Purpose |
|---|---|
| `Get-ExchangeQueues.ps1` | Collector. Prints one JSON object. See the root [README](../README.md). |
| `Send-ExchangeQueueMetrics.ps1` | Runs the collector and posts the metrics to the OneAgent. |
| `Install-ExchangeQueueMetrics.ps1` | Downloads the two scripts, checks prerequisites, tests the account, creates the Scheduled Task. |

## Requirements

**On the Exchange server** (install on each server you want to monitor)
- Windows PowerShell 5.1 and the Exchange Management Shell / snap-in (the collector uses `Get-Queue` and, where
  present, `Get-MailboxDatabaseCopyStatus`).
- An elevated (Administrator) PowerShell session for the install.
- Outbound HTTPS to `api.github.com` during the install only.

**Dynatrace OneAgent**
- OneAgent installed on the server, with the `Dynatrace OneAgent` Windows service running.
- The OneAgent local metric API enabled and listening on `127.0.0.1:14499` (the default). If the installer cannot
  connect, enable the OneAgent metric API feature for the host or host group in the Dynatrace settings, then retry.
  Check with `Test-NetConnection 127.0.0.1 -Port 14499`.
- No Dynatrace API token is needed. The OneAgent forwards the metrics over its own connection.

**Service account** (the account the Scheduled Task runs as)
- Exchange permission to run `Get-Queue` (for example membership of *View-Only Organization Management* or
  *Organization Management*).
- The Windows right *Log on as a batch job* on the server.
- Its password is stored by the Task Scheduler. Use a dedicated account.

**Install access**
- Access to github.com (the repository is public, no token needed). Without it, use the zip install below.

## Install

Run on the Exchange server in an elevated PowerShell.

```powershell
[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest "https://raw.githubusercontent.com/dyna-nate/powershell-scripts/main/exchange/Install-ExchangeQueueMetrics.ps1" -OutFile "$env:TEMP\Install-ExchangeQueueMetrics.ps1" -UseBasicParsing; & "$env:TEMP\Install-ExchangeQueueMetrics.ps1" -Credential (Get-Credential) -ExcludeEmpty
```

A credential prompt appears: enter the service account (`DOMAIN\user`). The installer then:

1. Downloads the scripts to `C:\ProgramData\Dynatrace\ExchangeQueueMetrics`.
2. Checks the OneAgent service, the metric API port, and that a probe metric is accepted.
3. Runs the collector once as the service account and checks that queue metrics come back.
4. Creates the Scheduled Task `Dynatrace-ExchangeQueueMetrics` (every minute), runs it once and checks that the
   OneAgent accepted every line.

It stops at the first failed check and creates no recurring task unless all checks pass. Options:
`-IntervalMinutes`, `-Branch`, `-InstallPath`, `-TaskName`, `-Endpoint`, `-SkipDownload`. Running it again
replaces the existing task. Leave `-ExcludeEmpty` on to keep the number of queue series down.

### Server without access to GitHub

Copy the four `.ps1` files from the `exchange` folder (or the extracted repo zip) to any folder on the server,
for example `C:\Temp\ExchangeMetrics`, then run the installer from that folder:

```powershell
cd C:\Temp\ExchangeMetrics
.\Install-ExchangeQueueMetrics.ps1 -SkipDownload -Credential (Get-Credential) -ExcludeEmpty -IncludeMailboxStats
```

`-SkipDownload` copies the scripts that sit next to the installer into `C:\ProgramData\Dynatrace\ExchangeQueueMetrics`
and does the rest as normal. To update, copy the new files over the old ones in that folder and run the same
command again. It replaces the scripts and the tasks and nothing else changes.

A ready-made bundle with all four scripts and an `INSTALL.txt` is in the repo at
[dist/ExchangeQueueMetrics.zip](dist/ExchangeQueueMetrics.zip). Download it, hand it to the customer, and they extract it and
run the command above. After changing a script, run `exchange/build-package.sh` and commit the new zip.

To try the metrics without scheduling anything:

```powershell
C:\ProgramData\Dynatrace\ExchangeQueueMetrics\Send-ExchangeQueueMetrics.ps1 -ExcludeEmpty -DryRun
```

## Validate

**On the server**
```powershell
schtasks /query /tn "Dynatrace-ExchangeQueueMetrics" /v /fo list | Select-String "Status|Last Run Time|Last Result|Next Run Time"
Get-Content C:\ProgramData\Dynatrace\ExchangeQueueMetrics\last-run.log
```
`Last Result` should be `0`, and the log should end with `Sent N lines ... HTTP 202 {"linesOk":N,"linesInvalid":0...}`.

**In Dynatrace** (allow 2 to 3 minutes after the first run; use a Notebook or the Metrics app)

Collector health, expect `1` for each server:
```
timeseries success = max(custom.exchange.collector.success), by: {exchange.server}, interval:1m
```
Queue depth per queue:
```
timeseries messages = max(custom.exchange.queue.message_count), by:{exchange.server, queue.identity, delivery_type}
```
Named queue aggregates (poison, submission, mailbox delivery, remote delivery):
```
timeseries v = max(custom.exchange.queue.poison.length), by: {exchange.server}
```
Database copies (mailbox servers only):
```
timeseries copyQueue = max(custom.exchange.database.copy_queue_length), by:{exchange.server, database.copy}
```
Service states, `1` is running:
```
timeseries running = min(custom.exchange.service.running), by: {exchange.server, service.name}
```
Metrics are also tagged with the OneAgent host, so you can filter on `dt.entity.host`. To list everything sent,
search the Metrics app for `custom.exchange.`.

**Notebook:** import [notebooks/exchange-metric-ingest-validation.json](notebooks/exchange-metric-ingest-validation.json) (Notebooks app > Upload) to run all of the checks above in one place.

**Failure test** (optional): stop a monitored service or run the task as an account without Exchange rights.
`custom.exchange.collector.success` should drop to `0` within a minute or two. This is the metric to alert on.

## Metrics

All are gauges with the dimensions `exchange.server` and `exchange.environment` (`onprem`, change it with `-Environment` on the wrapper). Keys and dimensions mirror `ExtensionYAML/extension.yaml`. `failed.persec` and `collector.*` are not in the extension.

| Metric | Extra dimensions |
|---|---|
| `custom.exchange.queue.message_count`, `.deferred_count`, `.locked_count`, `.incoming_rate`, `.outgoing_rate`, `.velocity` | `queue.identity`, `delivery_type`, `status`, `next_hop_domain`, `next_hop_category`, `mail_path` |
| `custom.exchange.queue.error` (1 only for queues with a `LastError`) | same as above, plus `last_error` |
| `custom.exchange.queue.count`, `.total_messages` | |
| `custom.exchange.hybrid.outbound.message_count`, `.retry_messages` | `mail_path` (always `hybrid_outbound`) |
| `custom.exchange.queue.poison.length`, `.submission.length`, `.submission.deferred`, `.active.mailbox.length`, `.external.active.length`, `.external.total.length`, `.internal.active.length`, `.internal.total.length`, `.retry.mailbox.length` | |
| `custom.exchange.queue.digest.message_count` (only with `-IncludeDigest` on the wrapper) | `delivery_type`, `status` |
| `custom.exchange.database.copy_queue_length`, `.replay_queue_length`, `.mounted` | `database.copy`, `database.name`, `database.status` |
| `custom.exchange.submission.successful.persec`, `.temp_failures.persec`, `.hub_servers_in_retry`, `.failed.persec`, `custom.exchange.is.messages_queued_for_submission` | |
| `custom.exchange.service.running`, `.present` | `service.name` (Windows service name), `service.label` (friendly name), `service.status` (`Running`, `Stopped`, `NotInstalled`, `Paused`, ...) |
| `custom.exchange.cluster.network.up` | `network` |
| `custom.exchange.collector.success`, `.duration_ms` | |

`mail_path` is `hybrid_outbound`, `internal` or `external_other`, as in the extension. A queue is `hybrid_outbound` when its next hop or identity ends with one of the hybrid hop domains (default `mail.protection.outlook.com`, `mail.eo.outlook.com`, `protection.outlook.com`). For a custom Online MX or a third-party relay, pass `-HybridHopDomains "a.example.com,b.example.com"` to the installer.

Each distinct queue, database and service is its own series and counts toward custom metric consumption.

## Mailbox size and activity (optional)

Add `-IncludeMailboxStats` to the installer command to also report mailbox size and activity from
`Get-MailboxStatistics`. It installs a second Scheduled Task, `Dynatrace-ExchangeQueueMetrics-Mailbox`
(default every 30 minutes, `-MailboxIntervalMinutes`), because reading every mailbox is slow on large servers.
The installer waits up to 10 minutes for its first run and only warns if it is late.

- The service account needs a role that can read mailbox statistics, for example *View-Only Recipients*.
- The top 50 mailboxes by size per server get their own series (`-TopMailboxes` changes the number). Databases
  are totalled over all mailboxes.
- **Mailbox display names are stored in Dynatrace** in the `mailbox.name` dimension. Do not enable this where
  that is not allowed.
- Series count per server: about 5 per top mailbox plus 3 per database.

| Metric | Dimensions |
|---|---|
| `custom.exchange.mailbox.total_item_size_bytes`, `.total_deleted_item_size_bytes`, `.item_count` | `mailbox.name`, `database.name` |
| `custom.exchange.mailbox.last_logon_age_seconds` (not sent for a mailbox that never logged on) | `mailbox.name`, `database.name` |
| `custom.exchange.mailbox.over_limit` (`0` or `1`) | `mailbox.name`, `database.name`, `storage_limit_status` |
| `custom.exchange.database.mailbox_count`, `.mailbox_total_size_bytes`, `.mailbox_total_item_count` | `database.name` |
| `custom.exchange.mailbox.collector.success`, `.duration_ms`, `.mailboxes_scanned` | |

All carry `exchange.server` and `exchange.environment`. `storage_limit_status` is `BelowLimit`, `IssueWarning`,
`ProhibitSend`, `MailboxDisabled` or `NoChecking`; `over_limit` is `1` for the middle three.

```
timeseries size = max(custom.exchange.mailbox.total_item_size_bytes, scalar: true), by:{exchange.server, mailbox.name, database.name}, from: now() - 2h
| sort size desc | limit 10
```

Try it without scheduling anything:

```powershell
C:\ProgramData\Dynatrace\ExchangeQueueMetrics\Send-ExchangeMailboxMetrics.ps1 -DryRun
```

The notebook has a section for each of these metrics.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Download fails | The server cannot reach github.com (proxy or firewall), or GitHub's anonymous API limit was hit (60 requests per hour per address). Use the zip install. |
| "Nothing is listening on 127.0.0.1:14499" | OneAgent metric API not enabled, or a different port is configured. Use `-Endpoint`. |
| Collector test fails as the service account | Password wrong, account lacks *Log on as a batch job*, or lacks Exchange permission. The installer prints the task result and log tail. |
| Task result is not `0` later on | Read `last-run.log`. Expired password on the service account is the usual cause. |
| `linesInvalid` above 0 | A metric line was rejected. Keep the `last-run.log` and report it. |
| Mailbox run fails | The account cannot read mailbox statistics (add *View-Only Recipients*), or the Exchange Management Shell is not available to the task. Read `last-mailbox-run.log`. |
| Gaps in the data | A run took longer than the interval; use a larger `-IntervalMinutes`. Check `custom.exchange.collector.duration_ms`. |

## Uninstall

```powershell
schtasks /delete /tn "Dynatrace-ExchangeQueueMetrics" /f
schtasks /delete /tn "Dynatrace-ExchangeQueueMetrics-Mailbox" /f   # only if you used -IncludeMailboxStats
Remove-Item C:\ProgramData\Dynatrace\ExchangeQueueMetrics -Recurse
```
