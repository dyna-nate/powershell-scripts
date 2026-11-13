/**
 * Data access layer for Exchange Ops (Get-Queue + Online hybrid path).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { useRefreshContext } from "../context/RefreshContext";
import {
  dqlFleetTotals,
  dqlMailFlow,
  dqlPoisonAndUnreachable,
  dqlQueueErrors,
  dqlQueueExplorer,
  dqlTopQueues,
  dqlStuckQueues,
  dqlNamedQueues,
  dqlDatabaseCopies,
  dqlServices,
  dqlClusterNetworks,
  dqlSubmissionCounters,
  dqlHybridOutbound,
  dqlOnlineConnectors,
  dqlOnlineServiceHealth,
  dqlOnlineOutboundUnhealthy,
  dqlTopMailboxes,
  dqlMailboxLimits,
  dqlMailboxDatabases,
  dqlMailboxCollectorHealth,
  DEFAULT_TIMEFRAME,
  MAILBOX_TIMEFRAME,
  Timeframe,
  QueryFilters,
} from "../dql/queries";
import { useEnvironment } from "../context/EnvironmentContext";
import {
  isDemoDataEnabled,
  subscribeDemoDataChange,
} from "../config/demoMode";
import { DEMO, DEMO_INFRA, DEMO_MAILBOX, DEMO_ONLINE } from "./demoData";

export type DataSource = "live" | "demo" | "empty";

export type QueryState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  source: DataSource;
};

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length) return Number(v[v.length - 1]) || 0;
  return Number(v) || 0;
}

function arr(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x) || 0);
  return [];
}

function useDemoFlag(): boolean {
  const [demo, setDemo] = useState(isDemoDataEnabled);
  useEffect(() => subscribeDemoDataChange(() => setDemo(isDemoDataEnabled())), []);
  return demo;
}

function useMappedQuery<T>(
  query: string,
  demo: T,
  empty: T,
  mapRecords: (records: Record<string, unknown>[]) => T
): QueryState<T> {
  const allowDemo = useDemoFlag();
  const live = useDql({ query });
  const { register } = useRefreshContext();
  const liveExt = live as unknown as { forceRefetch?: () => void };
  const forceRefetchRef = useRef(liveExt.forceRefetch);
  forceRefetchRef.current = liveExt.forceRefetch;
  useEffect(() => {
    return register(() => { forceRefetchRef.current?.(); });
  }, [register]);

  return useMemo(() => {
    const placeholder = allowDemo ? demo : empty;
    if (live.isLoading) {
      return { data: placeholder, loading: true, error: null, source: "live" as const };
    }
    if (live.error) {
      if (allowDemo) {
        return {
          data: demo,
          loading: false,
          error: String(live.error),
          source: "demo" as const,
        };
      }
      return {
        data: empty,
        loading: false,
        error: String(live.error),
        source: "empty" as const,
      };
    }
    const records = live.data?.records ?? [];
    if (!records.length) {
      if (allowDemo) {
        return { data: demo, loading: false, error: null, source: "demo" as const };
      }
      return { data: empty, loading: false, error: null, source: "empty" as const };
    }
    return {
      data: mapRecords(records),
      loading: false,
      error: null,
      source: "live" as const,
    };
  }, [live, demo, empty, mapRecords, query, allowDemo]);
}

function useEnvFilters(extra?: QueryFilters): QueryFilters {
  const { environmentDimension } = useEnvironment();
  return {
    ...extra,
    environment: extra?.environment ?? environmentDimension,
  };
}

export type FleetServer = {
  server: string;
  total: number;
  series: number[];
};

export type QueueRow = {
  server: string;
  identity: string;
  deliveryType: string;
  status: string;
  nextHopDomain: string;
  nextHopCategory: string;
  mailPath?: string;
  messageCount: number;
  velocity: number | null;
  series: number[];
};

export type FlowEdge = {
  server: string;
  deliveryType: string;
  status: string;
  nextHopDomain: string;
  nextHopCategory: string;
  mailPath?: string;
  messageCount: number;
};

export type ErrorRow = {
  server: string;
  identity: string;
  status: string;
  lastError: string;
  nextHopDomain: string;
  errorCount: number;
};

export type OnlineConnectorRow = {
  tenantId: string;
  name: string;
  direction: string;
  type: string;
  enabled: boolean;
  validated: boolean;
  healthy: boolean;
};

export type HybridPathRow = {
  server: string;
  hybridBacklog: number;
  hybridRetry: number;
};

const EMPTY_FLEET: FleetServer[] = [];
const EMPTY_QUEUES: QueueRow[] = [];
const EMPTY_FLOW: FlowEdge[] = [];
const EMPTY_ERRORS: ErrorRow[] = [];
const EMPTY_HYBRID: HybridPathRow[] = [];
const EMPTY_CONNECTORS: OnlineConnectorRow[] = [];
const EMPTY_ONLINE_SERVICE = { tenantId: "", status: "not configured", healthy: false };
const EMPTY_ONLINE_UNHEALTHY = { tenantId: "", outboundUnhealthy: 0 };

export function useFleet(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  const filters = useEnvFilters();
  const demo = useMemo(() => {
    if (filters.environment === "online") return EMPTY_FLEET;
    return DEMO.fleet;
  }, [filters.environment]);

  return useMappedQuery(dqlFleetTotals(timeframe, filters), demo, EMPTY_FLEET, (records) =>
    records.map((r) => ({
      server: String(r["SERVER"] ?? r["exchange.server"] ?? "unknown"),
      total: num(r["TOTAL MESSAGES"]),
      series: arr(r["TREND"]),
    }))
  );
}

export function useQueues(
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
  filters?: { server?: string | string[]; identity?: string | string[]; status?: string | string[]; deliveryType?: string | string[]; mailPath?: string | string[] }
) {
  const envFilters = useEnvFilters(filters);
  const demo = useMemo(() => {
    if (envFilters.environment === "online") return EMPTY_QUEUES;
    let rows = DEMO.queues;
    if (envFilters.mailPath?.length) {
      const paths = Array.isArray(envFilters.mailPath) ? envFilters.mailPath : [envFilters.mailPath];
      rows = rows.filter((q) => paths.includes(q.mailPath ?? ""));
    }
    return rows;
  }, [envFilters.environment, envFilters.mailPath]);

  return useMappedQuery(dqlQueueExplorer(timeframe, envFilters), demo, EMPTY_QUEUES, (records) =>
    records.map((r) => ({
      server: String(r["exchange.server"] ?? "unknown"),
      identity: String(r["queue.identity"] ?? ""),
      deliveryType: String(r.delivery_type ?? ""),
      status: String(r.status ?? ""),
      nextHopDomain: String(r.next_hop_domain ?? ""),
      nextHopCategory: String(r.next_hop_category ?? ""),
      mailPath: String(r.mail_path ?? ""),
      messageCount: num(r.messageCount ?? r.messages),
      velocity: r.velocityLast == null ? null : num(r.velocityLast),
      series: arr(r.messages),
    }))
  );
}

export function useTopQueues() {
  const filters = useEnvFilters();
  return useMappedQuery(dqlTopQueues(filters), DEMO.queues, EMPTY_QUEUES, (records) =>
    records.map((r) => ({
      server: String(r["exchange.server"] ?? "unknown"),
      identity: String(r["queue.identity"] ?? ""),
      deliveryType: String(r.delivery_type ?? ""),
      status: String(r.status ?? ""),
      nextHopDomain: String(r.next_hop_domain ?? ""),
      nextHopCategory: String(r.next_hop_category ?? ""),
      mailPath: String(r.mail_path ?? ""),
      messageCount: num(r.messageCount ?? r.messages),
      velocity: r.velocityLast == null ? null : num(r.velocityLast),
      series: arr(r.messages),
    }))
  );
}

export function useMailFlow(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  const filters = useEnvFilters();
  const demo = useMemo(() => {
    if (filters.environment === "online") return EMPTY_FLOW;
    return DEMO.flow;
  }, [filters.environment]);

  return useMappedQuery(dqlMailFlow(timeframe, filters), demo, EMPTY_FLOW, (records) =>
    records.map((r) => ({
      server: String(r["exchange.server"] ?? "unknown"),
      deliveryType: String(r.delivery_type ?? ""),
      status: String(r.status ?? ""),
      nextHopDomain: String(r.next_hop_domain ?? ""),
      nextHopCategory: String(r.next_hop_category ?? ""),
      mailPath: String(r.mail_path ?? ""),
      messageCount: num(r.messageCount),
    }))
  );
}

export function useErrors(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  const filters = useEnvFilters();
  return useMappedQuery(dqlQueueErrors(timeframe, filters), DEMO.errors, EMPTY_ERRORS, (records) =>
    records.map((r) => ({
      server: String(r["exchange.server"] ?? "unknown"),
      identity: String(r["queue.identity"] ?? ""),
      status: String(r.status ?? ""),
      lastError: String(r.last_error ?? ""),
      nextHopDomain: String(r.next_hop_domain ?? ""),
      errorCount: num(r.errorCount),
    }))
  );
}

export function useStuck(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  const filters = useEnvFilters();
  return useMappedQuery(dqlStuckQueues(timeframe, filters), DEMO.stuck, EMPTY_QUEUES, (records) =>
    records.map((r) => ({
      server: String(r["exchange.server"] ?? "unknown"),
      identity: String(r["queue.identity"] ?? ""),
      deliveryType: String(r.delivery_type ?? ""),
      status: String(r.status ?? ""),
      nextHopDomain: String(r.next_hop_domain ?? ""),
      nextHopCategory: "",
      mailPath: String(r.mail_path ?? ""),
      messageCount: num(r.messageCount),
      velocity: r.velocityLast == null ? null : num(r.velocityLast),
      series: [],
    }))
  );
}

export function usePoison(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  const filters = useEnvFilters();
  return useMappedQuery(
    dqlPoisonAndUnreachable(timeframe, filters),
    DEMO.poison,
    EMPTY_QUEUES,
    (records) =>
      records.map((r) => ({
        server: String(r["exchange.server"] ?? "unknown"),
        identity: String(r["queue.identity"] ?? ""),
        deliveryType: String(r.delivery_type ?? ""),
        status: String(r.status ?? ""),
        nextHopDomain: String(r.next_hop_domain ?? ""),
        nextHopCategory: "",
        messageCount: num(r.messageCount),
        velocity: null,
        series: [],
      }))
  );
}

export type NamedKpi = { label: string; value: number };
export type DbCopyRow = {
  server: string;
  name: string;
  status: string;
  copyQueueLength: number;
  replayQueueLength: number;
  mounted: boolean;
};
export type CounterKpi = { label: string; value: number };
export type ServiceRow = { label: string; name: string; server: string; status: string };
export type ClusterNetRow = { name: string; state: string };

const EMPTY_NAMED: NamedKpi[] = [];
const EMPTY_DB: DbCopyRow[] = [];
const EMPTY_COUNTERS: CounterKpi[] = [];
const EMPTY_SERVICES: ServiceRow[] = [];

export function useNamedQueueKpis(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  const filters = useEnvFilters({ environment: "onprem" });
  return useMappedQuery(
    dqlNamedQueues(timeframe, filters),
    DEMO_INFRA.named,
    EMPTY_NAMED,
    (records) => {
      const r = records[0] ?? {};
      return [
        { label: "Poison Queue Length", value: num(r.poison) },
        { label: "Submission Queue Length", value: num(r.submission) },
        { label: "Deferred in Submission", value: num(r.deferred) },
        { label: "Active Mailbox Delivery", value: num(r.activeMb) },
        { label: "External Active Remote", value: num(r.extActive) },
        { label: "External Remote Total", value: num(r.extTotal) },
        { label: "Internal Active Remote", value: num(r.intActive) },
        { label: "Internal Remote Total", value: num(r.intTotal) },
        { label: "Mailbox Retry Delivery", value: num(r.mbRetry) },
      ] as NamedKpi[];
    }
  );
}

export function useDatabaseCopies(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  const filters = useEnvFilters({ environment: "onprem" });
  return useMappedQuery(
    dqlDatabaseCopies(timeframe, filters),
    DEMO_INFRA.databases,
    EMPTY_DB,
    (records) =>
      records.map(
        (r) =>
          ({
            server: String(r["exchange.server"] ?? "unknown"),
            name: String(r["database.copy"] ?? "unknown"),
            status: String(r["database.status"] ?? ""),
            copyQueueLength: num(r.copyQueueLength),
            replayQueueLength: num(r.replayQueueLength),
            mounted: num(r.isMounted) >= 0.5,
          }) as DbCopyRow
      )
  );
}

export function useSubmissionCounters(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  const filters = useEnvFilters({ environment: "onprem" });
  return useMappedQuery(
    dqlSubmissionCounters(timeframe, filters),
    DEMO_INFRA.counters,
    EMPTY_COUNTERS,
    (records) => {
      const r = records[0] ?? {};
      return [
        { label: "Successful Submissions/sec", value: num(r.successfulSubmissionsPerSec) },
        { label: "Temp Submission Failures/sec", value: num(r.temporarySubmissionFailuresPerSec) },
        { label: "Hub Servers in Retry", value: num(r.hubServersInRetry) },
        { label: "Messages Queued for Submission", value: num(r.messagesQueuedForSubmission) },
      ] as CounterKpi[];
    }
  );
}

export function useExchangeServices() {
  const filters = useEnvFilters({ environment: "onprem" });
  return useMappedQuery(
    dqlServices(),
    DEMO_INFRA.services,
    EMPTY_SERVICES,
    (records) =>
      records.map(
        (r) =>
          ({
            label: String(r["LABEL"] ?? ""),
            name: String(r["SERVICE NAME"] ?? ""),
            server: String(r["SERVER"] ?? "unknown"),
            status: String(r["STATUS"] ?? ""),
          }) as ServiceRow
      )
  );
}

export type ClusterNodeRow = { node: string; state: string };
const EMPTY_CLUSTER_NODES: ClusterNodeRow[] = [];

export function useClusterNetworks() {
  return useMappedQuery(
    dqlClusterNetworks(),
    DEMO_INFRA.clusterNodes,
    EMPTY_CLUSTER_NODES,
    (records) =>
      records.map((r) => ({
        node: String(r["NODE"] ?? ""),
        state: String(r["STATE"] ?? ""),
      }) as ClusterNodeRow)
  );
}

export function useHybridOutbound(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  return useMappedQuery(
    dqlHybridOutbound(timeframe),
    DEMO_ONLINE.hybridOutbound,
    EMPTY_HYBRID,
    (records) =>
      records.map(
        (r) =>
          ({
            server: String(r["exchange.server"] ?? "unknown"),
            hybridBacklog: num(r.hybridBacklog),
            hybridRetry: num(r.hybridRetry),
          }) as HybridPathRow
      )
  );
}

export function useOnlineConnectors(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  return useMappedQuery(
    dqlOnlineConnectors(timeframe),
    DEMO_ONLINE.connectors,
    EMPTY_CONNECTORS,
    (records) =>
      records.map(
        (r) =>
          ({
            tenantId: String(r["exchange.tenant_id"] ?? ""),
            name: String(r["connector.name"] ?? ""),
            direction: String(r["connector.direction"] ?? ""),
            type: String(r["connector.type"] ?? ""),
            enabled: num(r.isEnabled) >= 0.5,
            validated: num(r.isValidated) >= 0.5,
            healthy: num(r.isHealthy) >= 0.5,
          }) as OnlineConnectorRow
      )
  );
}

export function useOnlineServiceHealth(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  return useMappedQuery(
    dqlOnlineServiceHealth(timeframe),
    DEMO_ONLINE.serviceHealth,
    EMPTY_ONLINE_SERVICE,
    (records) => {
      const r = records[0] ?? {};
      return {
        tenantId: String(r["exchange.tenant_id"] ?? ""),
        status: String(r["service.status"] ?? "unknown"),
        healthy: num(r.isHealthy) >= 0.5,
      };
    }
  );
}

export function useOnlineOutboundUnhealthy(timeframe: Timeframe = DEFAULT_TIMEFRAME) {
  return useMappedQuery(
    dqlOnlineOutboundUnhealthy(timeframe),
    DEMO_ONLINE.outboundUnhealthy,
    EMPTY_ONLINE_UNHEALTHY,
    (records) => {
      const r = records[0] ?? {};
      return {
        tenantId: String(r["exchange.tenant_id"] ?? ""),
        outboundUnhealthy: num(r.outboundUnhealthy),
      };
    }
  );
}

export type MailboxRow = {
  server: string;
  name: string;
  database: string;
  sizeBytes: number;
  deletedBytes: number;
  itemCount: number;
  /** null when the mailbox has never been logged on to */
  lastLogonAgeSeconds: number | null;
  limitStatus: string;
  overLimit: boolean;
};
export type MailboxDbRow = {
  server: string;
  database: string;
  mailboxCount: number;
  totalSizeBytes: number;
  totalItemCount: number;
};
export type MailboxHealthRow = {
  server: string;
  success: boolean;
  scanned: number;
  durationMs: number;
};

type MailboxLimitRow = { server: string; name: string; status: string; overLimit: boolean };

const EMPTY_MAILBOXES: MailboxRow[] = [];
const EMPTY_MAILBOX_LIMITS: MailboxLimitRow[] = [];
const EMPTY_MAILBOX_DBS: MailboxDbRow[] = [];
const EMPTY_MAILBOX_HEALTH: MailboxHealthRow[] = [];

function useMailboxLimits(timeframe: Timeframe): QueryState<MailboxLimitRow[]> {
  const filters = useEnvFilters({ environment: "onprem" });
  return useMappedQuery(
    dqlMailboxLimits(timeframe, filters),
    [] as MailboxLimitRow[],
    EMPTY_MAILBOX_LIMITS,
    (records) =>
      records.map((r) => ({
        server: String(r["exchange.server"] ?? "unknown"),
        name: String(r["mailbox.name"] ?? "unknown"),
        status: String(r.storage_limit_status ?? ""),
        overLimit: num(r.overLimit) >= 0.5,
      }))
  );
}

/** Top mailboxes by size, joined with their storage limit status. */
export function useTopMailboxes(timeframe: Timeframe = MAILBOX_TIMEFRAME): QueryState<MailboxRow[]> {
  const filters = useEnvFilters({ environment: "onprem" });
  const top = useMappedQuery(
    dqlTopMailboxes(timeframe, filters),
    DEMO_MAILBOX.mailboxes,
    EMPTY_MAILBOXES,
    (records) =>
      records.map(
        (r) =>
          ({
            server: String(r["exchange.server"] ?? "unknown"),
            name: String(r["mailbox.name"] ?? "unknown"),
            database: String(r["database.name"] ?? ""),
            sizeBytes: num(r.sizeBytes),
            deletedBytes: num(r.deletedBytes),
            itemCount: num(r.itemCount),
            lastLogonAgeSeconds:
              r.lastLogonAgeSeconds == null ? null : num(r.lastLogonAgeSeconds),
            limitStatus: "",
            overLimit: false,
          }) as MailboxRow
      )
  );
  const limits = useMailboxLimits(timeframe);
  return useMemo(() => {
    if (top.source === "demo" || !limits.data.length) return top;
    const byKey = new Map(limits.data.map((l) => [`${l.server}|${l.name}`, l]));
    return {
      ...top,
      data: top.data.map((m) => {
        const l = byKey.get(`${m.server}|${m.name}`);
        return l ? { ...m, limitStatus: l.status, overLimit: l.overLimit } : m;
      }),
    };
  }, [top, limits.data]);
}

export function useMailboxDatabases(timeframe: Timeframe = MAILBOX_TIMEFRAME) {
  const filters = useEnvFilters({ environment: "onprem" });
  return useMappedQuery(
    dqlMailboxDatabases(timeframe, filters),
    DEMO_MAILBOX.databases,
    EMPTY_MAILBOX_DBS,
    (records) =>
      records.map(
        (r) =>
          ({
            server: String(r["exchange.server"] ?? "unknown"),
            database: String(r["database.name"] ?? "unknown"),
            mailboxCount: num(r.mailboxCount),
            totalSizeBytes: num(r.totalSizeBytes),
            totalItemCount: num(r.totalItemCount),
          }) as MailboxDbRow
      )
  );
}

export function useMailboxHealth(timeframe: Timeframe = MAILBOX_TIMEFRAME) {
  const filters = useEnvFilters({ environment: "onprem" });
  return useMappedQuery(
    dqlMailboxCollectorHealth(timeframe, filters),
    DEMO_MAILBOX.health,
    EMPTY_MAILBOX_HEALTH,
    (records) =>
      records.map(
        (r) =>
          ({
            server: String(r["exchange.server"] ?? "unknown"),
            success: num(r.collectorSuccess) >= 0.5,
            scanned: num(r.mailboxesScanned),
            durationMs: num(r.durationMs),
          }) as MailboxHealthRow
      )
  );
}
