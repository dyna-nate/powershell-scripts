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
- A GitHub token with read access to the repository, supplied by whoever gave you the install command.

## Install

Run on the Exchange server in an elevated PowerShell. Replace `<TOKEN>`.

```powershell
[Net.ServicePointManager]::SecurityProtocol='Tls12'; $t='<TOKEN>'; Invoke-WebRequest "https://api.github.com/repos/dyna-nate/powershell-scripts/contents/exchange/Install-ExchangeQueueMetrics.ps1?ref=main" -Headers @{Authorization="Bearer $t";Accept="application/vnd.github.raw"} -OutFile "$env:TEMP\Install-ExchangeQueueMetrics.ps1" -UseBasicParsing; $env:GITHUB_TOKEN=$t; & "$env:TEMP\Install-ExchangeQueueMetrics.ps1" -Credential (Get-Credential) -ExcludeEmpty
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
timeseries running = min(custom.exchange.service.running), by: {exchange.server, service}
```
Metrics are also tagged with the OneAgent host, so you can filter on `dt.entity.host`. To list everything sent,
search the Metrics app for `custom.exchange.`.

**Notebook:** import [notebooks/exchange-metric-ingest-validation.json](notebooks/exchange-metric-ingest-validation.json) (Notebooks app > Upload) to run all of the checks above in one place.

**Failure test** (optional): stop a monitored service or run the task as an account without Exchange rights.
`custom.exchange.collector.success` should drop to `0` within a minute or two. This is the metric to alert on.

## Metrics

All are gauges with an `exchange.server` dimension. Keys and dimensions mirror `ExtensionYAML/extension.yaml`. `failed.persec` and `collector.*` are not in the extension.

| Metric | Extra dimensions |
|---|---|
| `custom.exchange.queue.message_count`, `.deferred_count`, `.locked_count`, `.incoming_rate`, `.outgoing_rate`, `.velocity` | `queue.identity`, `delivery_type`, `status`, `next_hop_domain`, `next_hop_category` |
| `custom.exchange.queue.count`, `.total_messages` | |
| `custom.exchange.queue.poison.length`, `.submission.length`, `.submission.deferred`, `.active.mailbox.length`, `.external.active.length`, `.external.total.length`, `.internal.active.length`, `.internal.total.length`, `.retry.mailbox.length` | |
| `custom.exchange.queue.digest.message_count` (only with `-IncludeDigest` on the wrapper) | `delivery_type`, `status` |
| `custom.exchange.database.copy_queue_length`, `.replay_queue_length`, `.mounted` | `database.copy`, `database.name`, `database.status` |
| `custom.exchange.submission.successful.persec`, `.temp_failures.persec`, `.hub_servers_in_retry`, `.failed.persec`, `custom.exchange.is.messages_queued_for_submission` | |
| `custom.exchange.service.running`, `.present` | `service`, `label` |
| `custom.exchange.cluster.network.up` | `network` |
| `custom.exchange.collector.success`, `.duration_ms` | |

Each distinct queue, database and service is its own series and counts toward custom metric consumption.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Download fails with 404 | Token missing, expired, or without read access to the repo. |
| "Nothing is listening on 127.0.0.1:14499" | OneAgent metric API not enabled, or a different port is configured. Use `-Endpoint`. |
| Collector test fails as the service account | Password wrong, account lacks *Log on as a batch job*, or lacks Exchange permission. The installer prints the task result and log tail. |
| Task result is not `0` later on | Read `last-run.log`. Expired password on the service account is the usual cause. |
| `linesInvalid` above 0 | A metric line was rejected. Keep the `last-run.log` and report it. |
| Gaps in the data | A run took longer than the interval; use a larger `-IntervalMinutes`. Check `custom.exchange.collector.duration_ms`. |

## Uninstall

```powershell
schtasks /delete /tn "Dynatrace-ExchangeQueueMetrics" /f
Remove-Item C:\ProgramData\Dynatrace\ExchangeQueueMetrics -Recurse
```
