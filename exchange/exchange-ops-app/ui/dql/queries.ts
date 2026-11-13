/** Shared DQL builders for custom.exchange.* metrics (Get-Queue + Online path). */

export type Timeframe = { from: string; to: string };

export type EnvironmentDimension = "onprem" | "online";

/** Dimension key that carries the environment value on every custom.exchange.* metric. */
export const ENVIRONMENT_DIMENSION = "exchange.environment";

export type QueryFilters = {
  server?: string | string[];
  identity?: string | string[];
  status?: string | string[];
  deliveryType?: string | string[];
  environment?: EnvironmentDimension;
  mailPath?: string | string[];
};

export const DEFAULT_TIMEFRAME: Timeframe = {
  from: "now()-5m",
  to: "now()",
};

function tf(timeframe: Timeframe): string {
  return `from: ${timeframe.from}, to: ${timeframe.to}`;
}

export function environmentFilterClause(environment?: EnvironmentDimension): string {
  if (!environment) return "";
  return `| filter \`${ENVIRONMENT_DIMENSION}\` == "${escapeDql(environment)}"`;
}

function toFilterClause(field: string, value: string | string[]): string {
  if (Array.isArray(value)) {
    const list = value.map((v) => `"${escapeDql(v)}"`).join(", ");
    return `| filter in(${field}, {${list}})`;
  }
  return `| filter ${field} == "${escapeDql(value)}"`;
}

function appendFilters(parts: string[], filters?: QueryFilters): string[] {
  const out = [...parts];
  if (filters?.environment) {
    out.push(environmentFilterClause(filters.environment));
  }
  if (filters?.server?.length) {
    out.push(toFilterClause("`exchange.server`", filters.server));
  }
  if (filters?.identity?.length) {
    out.push(toFilterClause("`queue.identity`", filters.identity));
  }
  if (filters?.status?.length) {
    out.push(toFilterClause("status", filters.status));
  }
  if (filters?.deliveryType?.length) {
    out.push(toFilterClause("delivery_type", filters.deliveryType));
  }
  if (filters?.mailPath?.length) {
    out.push(toFilterClause("mail_path", filters.mailPath));
  }
  return out.filter(Boolean);
}

/** Fleet rollup: total queued messages by server */
export function dqlFleetTotals(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  _filters?: Pick<QueryFilters, "environment">
): string {
  return `
timeseries TREND = sum(custom.exchange.queue.total_messages),
           ${tf(timeframe)},
           by: { SERVER = \`exchange.server\` },
           filter: \`${ENVIRONMENT_DIMENSION}\` == "onprem"
| fieldsAdd \`TOTAL MESSAGES\` = arrayLast(TREND)
| fieldsAdd TREND = arrayRemoveNulls(TREND)
`.trim();
}

/** Top queues snapshot: last 5 minutes, sorted by message count */
export function dqlTopQueues(filters?: Pick<QueryFilters, "environment">): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries messages = sum(custom.exchange.queue.message_count),
           velocity = sum(custom.exchange.queue.velocity), from: now()-5m, to: now(),
           by: { \`exchange.server\`, \`queue.identity\`, delivery_type, status, next_hop_domain, next_hop_category, mail_path, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd messageCount = arrayLast(messages),
            velocityLast = arrayLast(velocity)
| fields \`exchange.server\`, \`queue.identity\`, delivery_type, status, next_hop_domain, next_hop_category, mail_path, \`${ENVIRONMENT_DIMENSION}\`, messageCount, velocityLast, messages
| sort messageCount desc
`.trim();
}

/** Latest per-queue snapshot for explorer table */
export function dqlQueueExplorer(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: QueryFilters
): string {
  const filterParts = appendFilters([], filters);

  return `
timeseries messages = sum(custom.exchange.queue.message_count), 
           velocity = sum(custom.exchange.queue.velocity), ${tf(timeframe)}, 
           by: { \`exchange.server\`, \`queue.identity\`, delivery_type, status, next_hop_domain, next_hop_category, mail_path, \`${ENVIRONMENT_DIMENSION}\` }
           ${filterParts.join("\n")}
| fieldsAdd messageCount = arrayLast(messages),
            velocityLast = arrayLast(velocity)
| fieldsAdd queue.identity = if(contains(queue.identity, "\\\\"), queue.identity,
            else: concat(exchange.server, "\\\\", replaceString(queue.identity, exchange.server, "")))
| fields \`exchange.server\`, \`queue.identity\`, delivery_type, status, next_hop_domain, next_hop_category, mail_path, \`${ENVIRONMENT_DIMENSION}\`, messageCount, velocityLast, messages
| sort messageCount desc
`.trim();
}

/** Error indicator series */
export function dqlQueueErrors(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment" | "mailPath">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries errors = sum(custom.exchange.queue.error), ${tf(timeframe)}, by: { \`exchange.server\`, \`queue.identity\`, status, last_error, next_hop_domain, mail_path, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd errorCount = arraySum(errors)
| filter errorCount > 0
| fieldsAdd queue.identity = if(contains(queue.identity, "\\\\"), queue.identity,
            else: concat(exchange.server, "\\\\", replaceString(queue.identity, exchange.server, "")))
| fields \`exchange.server\`, \`queue.identity\`, status, last_error, next_hop_domain, mail_path, errorCount
| sort errorCount desc
`.trim();
}

/** Mail-flow map edges: server -> next hop domain weighted by messages */
export function dqlMailFlow(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment" | "mailPath">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries messages = sum(custom.exchange.queue.message_count), ${tf(timeframe)}, by: { \`exchange.server\`, delivery_type, status, next_hop_domain, next_hop_category, mail_path, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd messageCount = arrayLast(messages)
| filter messageCount > 0
| fields \`exchange.server\`, delivery_type, status, next_hop_domain, next_hop_category, mail_path, messageCount
| sort messageCount desc
`.trim();
}

/** Stuck queues: velocity ~0 with messages */
export function dqlStuckQueues(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment" | "mailPath">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries messages = sum(custom.exchange.queue.message_count), 
           velocity = sum(custom.exchange.queue.velocity), ${tf(timeframe)}, by: { \`exchange.server\`, \`queue.identity\`, status, next_hop_domain, delivery_type, mail_path, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd messageCount = arrayLast(messages), velocityLast = arrayLast(velocity)
| filter messageCount > 0 and (isNull(velocityLast) or velocityLast <= 0.01)
| fieldsAdd queue.identity = if(contains(queue.identity, "\\\\"), queue.identity,
            else: concat(exchange.server, "\\\\", replaceString(queue.identity, exchange.server, "")))
| fields \`exchange.server\`, \`queue.identity\`, status, next_hop_domain, delivery_type, mail_path, messageCount, velocityLast
| sort messageCount desc
`.trim();
}

/** Poison / unreachable concentration */
export function dqlPoisonAndUnreachable(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries messages = sum(custom.exchange.queue.message_count), ${tf(timeframe)}, by: { \`exchange.server\`, \`queue.identity\`, delivery_type, status, next_hop_domain, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd messageCount = arrayLast(messages)
| filter messageCount > 0 and (
    contains(lower(\`queue.identity\`), "poison") or
    contains(lower(\`queue.identity\`), "unreachable") or
    status == "Retry" or
    status == "Suspended"
  )
| fieldsAdd queue.identity = if(contains(queue.identity, "\\\\"), queue.identity,
            else: concat(exchange.server, "\\\\", replaceString(queue.identity, exchange.server, "")))
| fields \`exchange.server\`, \`queue.identity\`, delivery_type, status, next_hop_domain, messageCount
| sort messageCount desc
`.trim();
}

/** Named Get-Queue aggregates (operator-aligned KPI names) */
export function dqlNamedQueues(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries
  poison = avg(custom.exchange.queue.poison.length),
  submission = avg(custom.exchange.queue.submission.length),
  deferred = avg(custom.exchange.queue.submission.deferred),
  activeMb = avg(custom.exchange.queue.active.mailbox.length),
  extActive = avg(custom.exchange.queue.external.active.length),
  extTotal = avg(custom.exchange.queue.external.total.length),
  intActive = avg(custom.exchange.queue.internal.active.length),
  intTotal = avg(custom.exchange.queue.internal.total.length),
  mbRetry = avg(custom.exchange.queue.retry.mailbox.length),
  ${tf(timeframe)}, by: { \`exchange.server\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
`.trim();
}

/** DAG copy / replay / mount */
export function dqlDatabaseCopies(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries
  copyQ = avg(custom.exchange.database.copy_queue_length),
  replayQ = avg(custom.exchange.database.replay_queue_length),
  mounted = avg(custom.exchange.database.mounted),
  ${tf(timeframe)}, by: { \`exchange.server\`, \`database.copy\`, \`database.status\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd copyQueueLength = arrayLast(copyQ), replayQueueLength = arrayLast(replayQ), isMounted = arrayLast(mounted)
| fieldsAdd database.copy = if(contains(database.copy, "\\\\"), database.copy,
            else: replaceString(database.copy, exchange.server, concat("\\\\", exchange.server)))
`.trim();
}

/** Windows services */
export function dqlServices(timeframe: Timeframe = { from: "now()-10m", to: "now()" }): string {
  return `
timeseries
  running = min(custom.exchange.service.running),
  present = max(custom.exchange.service.present),
  ${tf(timeframe)},
  by: { \`exchange.server\`, \`service.name\`, \`service.label\` },
  filter: \`${ENVIRONMENT_DIMENSION}\` == "onprem"
| fieldsAdd r = arrayLast(running), p = arrayLast(present)
| fieldsAdd STATUS = if(p == 0, "Not installed", else: if(r == 1, "Running", else: "Stopped"))
| fields SERVER = \`exchange.server\`, LABEL = \`service.label\`, \`SERVICE NAME\` = \`service.name\`, STATUS
| sort SERVER, LABEL
`.trim();
}

export function dqlSubmissionCounters(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries
  success = avg(custom.exchange.submission.successful.persec),
  tempFail = avg(custom.exchange.submission.temp_failures.persec),
  hubRetry = avg(custom.exchange.submission.hub_servers_in_retry),
  queued = avg(custom.exchange.is.messages_queued_for_submission),
  ${tf(timeframe)}, by: { \`exchange.server\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd
  successfulSubmissionsPerSec = arrayLast(success),
  temporarySubmissionFailuresPerSec = arrayLast(tempFail),
  hubServersInRetry = arrayLast(hubRetry),
  messagesQueuedForSubmission = arrayLast(queued)
`.trim();
}

/** On-prem hybrid outbound backlog */
export function dqlHybridOutbound(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment">
): string {
  const filterParts = appendFilters([], { ...filters, environment: filters?.environment ?? "onprem" });
  return `
timeseries
  backlog = sum(custom.exchange.hybrid.outbound.message_count),
  retry = sum(custom.exchange.hybrid.outbound.retry_messages),
  ${tf(timeframe)}, by: { \`exchange.server\`, \`${ENVIRONMENT_DIMENSION}\`, mail_path }
${filterParts.join("\n")}
| fieldsAdd hybridBacklog = arrayLast(backlog), hybridRetry = arrayLast(retry)
| fields \`exchange.server\`, hybridBacklog, hybridRetry
| sort hybridBacklog desc
`.trim();
}

/** Exchange Online connectors */
export function dqlOnlineConnectors(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment">
): string {
  const filterParts = appendFilters([], { ...filters, environment: filters?.environment ?? "online" });
  return `
timeseries
  enabled = avg(custom.exchange.online.connector.enabled),
  validated = avg(custom.exchange.online.connector.validated),
  healthy = avg(custom.exchange.online.connector.healthy),
  ${tf(timeframe)}, by: { \`exchange.tenant_id\`, \`connector.name\`, \`connector.direction\`, \`connector.type\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd isEnabled = arrayLast(enabled), isValidated = arrayLast(validated), isHealthy = arrayLast(healthy)
| fields \`exchange.tenant_id\`, \`connector.name\`, \`connector.direction\`, \`connector.type\`, isEnabled, isValidated, isHealthy
| sort \`connector.name\` asc
`.trim();
}

export function dqlOnlineServiceHealth(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment">
): string {
  const filterParts = appendFilters([], { ...filters, environment: filters?.environment ?? "online" });
  return `
timeseries healthy = avg(custom.exchange.online.service.healthy), ${tf(timeframe)}, by: { \`exchange.tenant_id\`, \`service.status\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd isHealthy = arrayLast(healthy)
| fields \`exchange.tenant_id\`, \`service.status\`, isHealthy
`.trim();
}

export function dqlOnlineOutboundUnhealthy(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment">
): string {
  const filterParts = appendFilters([], { ...filters, environment: filters?.environment ?? "online" });
  return `
timeseries unhealthy = avg(custom.exchange.online.connector.outbound_unhealthy), ${tf(timeframe)}, by: { \`exchange.tenant_id\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd outboundUnhealthy = arrayLast(unhealthy)
| fields \`exchange.tenant_id\`, outboundUnhealthy
`.trim();
}

/** Lightweight probe: any Online connector metric in the default window. */
export function dqlOnlineIngestProbe(timeframe: Timeframe = DEFAULT_TIMEFRAME): string {
  return `
timeseries sample = avg(custom.exchange.online.connector.enabled), ${tf(timeframe)}, by: { \`${ENVIRONMENT_DIMENSION}\` }
| filter \`${ENVIRONMENT_DIMENSION}\` == "online"
| filter isNotNull(arrayLast(sample))
| limit 1
`.trim();
}

/** Mailbox stats refresh about every 30 minutes, so they use a wider window than queue data. */
export const MAILBOX_TIMEFRAME: Timeframe = { from: "now()-2h", to: "now()" };

/** Top mailboxes by size (Get-MailboxStatistics, top N per server) */
export function dqlTopMailboxes(
  timeframe: Timeframe = MAILBOX_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment" | "server">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries
  size = max(custom.exchange.mailbox.total_item_size_bytes),
  deleted = max(custom.exchange.mailbox.total_deleted_item_size_bytes),
  items = max(custom.exchange.mailbox.item_count),
  lastLogonAge = max(custom.exchange.mailbox.last_logon_age_seconds),
  ${tf(timeframe)}, by: { \`exchange.server\`, \`mailbox.name\`, \`database.name\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd sizeBytes = arrayLast(arrayRemoveNulls(size)),
            deletedBytes = arrayLast(arrayRemoveNulls(deleted)),
            itemCount = arrayLast(arrayRemoveNulls(items)),
            lastLogonAgeSeconds = arrayLast(arrayRemoveNulls(lastLogonAge))
| fields \`exchange.server\`, \`mailbox.name\`, \`database.name\`, sizeBytes, deletedBytes, itemCount, lastLogonAgeSeconds
| sort sizeBytes desc
`.trim();
}

/** Storage limit state per mailbox (extra dimension storage_limit_status) */
export function dqlMailboxLimits(
  timeframe: Timeframe = MAILBOX_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment" | "server">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries over = max(custom.exchange.mailbox.over_limit),
  ${tf(timeframe)}, by: { \`exchange.server\`, \`mailbox.name\`, storage_limit_status, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd overLimit = arrayLast(arrayRemoveNulls(over))
| fields \`exchange.server\`, \`mailbox.name\`, storage_limit_status, overLimit
`.trim();
}

/** Per-database mailbox totals (all mailboxes, not only the top N) */
export function dqlMailboxDatabases(
  timeframe: Timeframe = MAILBOX_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment" | "server">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries
  mailboxes = max(custom.exchange.database.mailbox_count),
  size = max(custom.exchange.database.mailbox_total_size_bytes),
  items = max(custom.exchange.database.mailbox_total_item_count),
  ${tf(timeframe)}, by: { \`exchange.server\`, \`database.name\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd mailboxCount = arrayLast(arrayRemoveNulls(mailboxes)),
            totalSizeBytes = arrayLast(arrayRemoveNulls(size)),
            totalItemCount = arrayLast(arrayRemoveNulls(items))
| fields \`exchange.server\`, \`database.name\`, mailboxCount, totalSizeBytes, totalItemCount
| sort totalSizeBytes desc
`.trim();
}

/** Mailbox collector health (own scheduled task, optional) */
export function dqlMailboxCollectorHealth(
  timeframe: Timeframe = MAILBOX_TIMEFRAME,
  filters?: Pick<QueryFilters, "environment" | "server">
): string {
  const filterParts = appendFilters([], filters);
  return `
timeseries
  success = min(custom.exchange.mailbox.collector.success),
  scanned = max(custom.exchange.mailbox.collector.mailboxes_scanned),
  duration = max(custom.exchange.mailbox.collector.duration_ms),
  ${tf(timeframe)}, by: { \`exchange.server\`, \`${ENVIRONMENT_DIMENSION}\` }
${filterParts.join("\n")}
| fieldsAdd collectorSuccess = arrayLast(arrayRemoveNulls(success)),
            mailboxesScanned = arrayLast(arrayRemoveNulls(scanned)),
            durationMs = arrayLast(arrayRemoveNulls(duration))
| fields \`exchange.server\`, collectorSuccess, mailboxesScanned, durationMs
`.trim();
}

/** Cluster node state (DAG) */
export function dqlClusterNetworks(): string {
  return `
timeseries {Running = avg(\`ms-exchange.cluster.node.state\`), timestamp = start()},
  from: now()-5m, to: now(), interval: 1m,
  by: {NODE = cluster.node.name, STATE = cluster.node.state}
| fields data = record(Running = Running[], timestamp = timestamp[], NODE, STATE)
| expand data
| fieldsAdd timestamp = data[timestamp], Running = data[Running], NODE = data[NODE], STATE = data[STATE]
| fieldsRemove data
| sort timestamp desc
| filter isNotNull(Running)
| summarize {STATE = takeFirst(STATE), timestamp = takeFirst(timestamp)},
             by:{NODE}
| fieldsRemove timestamp
`.trim();
}

export function escapeDql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
