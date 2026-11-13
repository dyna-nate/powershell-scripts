import { describe, expect, it } from "vitest";
import {
  dqlFleetTotals,
  dqlMailboxCollectorHealth,
  dqlMailboxDatabases,
  dqlMailboxLimits,
  dqlOnlineConnectors,
  dqlOnlineIngestProbe,
  dqlQueueExplorer,
  dqlServices,
  escapeDql,
  environmentFilterClause,
  dqlTopMailboxes,
  ENVIRONMENT_DIMENSION,
  MAILBOX_TIMEFRAME,
} from "./queries";

describe("DQL builders", () => {
  it("builds fleet query", () => {
    const q = dqlFleetTotals();
    expect(q).toContain("custom.exchange.queue.total_messages");
    expect(q).toContain("exchange.server");
  });

  it("applies explorer filters safely", () => {
    const q = dqlQueueExplorer(undefined, {
      server: "EXCH01",
      status: "Retry",
      environment: "onprem",
      mailPath: "hybrid_outbound",
    });
    expect(q).toContain('exchange.server` == "EXCH01"');
    expect(q).toContain('status == "Retry"');
    expect(q).toContain(`\`${ENVIRONMENT_DIMENSION}\` == "onprem"`);
    expect(q).toContain('mail_path == "hybrid_outbound"');
  });

  it("builds online connector query", () => {
    const q = dqlOnlineConnectors();
    expect(q).toContain("custom.exchange.online.connector.enabled");
    expect(q).toContain(`\`${ENVIRONMENT_DIMENSION}\``);
  });

  it("builds online ingest probe", () => {
    const q = dqlOnlineIngestProbe();
    expect(q).toContain("custom.exchange.online.connector.enabled");
    expect(q).toContain("| limit 1");
  });

  it("environment filter clause", () => {
    expect(environmentFilterClause()).toBe("");
    expect(environmentFilterClause("online")).toContain('"online"');
  });

  it("escapes quotes", () => {
    expect(escapeDql('a"b')).toBe('a\\"b');
  });

  it("uses the exchange.environment dimension everywhere", () => {
    expect(ENVIRONMENT_DIMENSION).toBe("exchange.environment");
    for (const q of [dqlFleetTotals(), dqlQueueExplorer(), dqlOnlineConnectors(), dqlTopMailboxes()]) {
      expect(q).not.toMatch(/`environment`/);
    }
  });

  it("builds top mailbox query", () => {
    const q = dqlTopMailboxes(undefined, { environment: "onprem", server: "EXCH01" });
    expect(q).toContain("custom.exchange.mailbox.total_item_size_bytes");
    expect(q).toContain("custom.exchange.mailbox.total_deleted_item_size_bytes");
    expect(q).toContain("custom.exchange.mailbox.item_count");
    expect(q).toContain("custom.exchange.mailbox.last_logon_age_seconds");
    expect(q).toContain("`mailbox.name`");
    expect(q).toContain("`database.name`");
    expect(q).toContain(`from: ${MAILBOX_TIMEFRAME.from}`);
    expect(q).toContain('`exchange.environment` == "onprem"');
    expect(q).toContain('`exchange.server` == "EXCH01"');
    expect(q).toContain("arrayRemoveNulls");
    expect(q).toContain("| sort sizeBytes desc");
  });

  it("builds mailbox limit query", () => {
    const q = dqlMailboxLimits();
    expect(q).toContain("custom.exchange.mailbox.over_limit");
    expect(q).toContain("storage_limit_status");
  });

  it("builds mailbox database totals query", () => {
    const q = dqlMailboxDatabases();
    expect(q).toContain("custom.exchange.database.mailbox_count");
    expect(q).toContain("custom.exchange.database.mailbox_total_size_bytes");
    expect(q).toContain("custom.exchange.database.mailbox_total_item_count");
  });

  it("builds mailbox collector health query", () => {
    const q = dqlMailboxCollectorHealth();
    expect(q).toContain("custom.exchange.mailbox.collector.success");
    expect(q).toContain("custom.exchange.mailbox.collector.mailboxes_scanned");
    expect(q).toContain("custom.exchange.mailbox.collector.duration_ms");
  });
});

describe("dqlServices", () => {
  it("groups by the service.name and service.label dimensions", () => {
    const q = dqlServices();
    expect(q).toContain("`service.name`");
    expect(q).toContain("`service.label`");
    expect(q).not.toMatch(/by: \{[^}]*\bservice,/);
  });
});
