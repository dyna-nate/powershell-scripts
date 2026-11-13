import { useMemo, useState } from "react";
import { EmptyPanel } from "../components/DataBanner";
import { MultiSelect } from "../components/MultiSelect";
import { SourceHint } from "../components/QueueTable";
import { useSort } from "../hooks/useSort";
import { useMailboxDatabases, useMailboxHealth, useTopMailboxes } from "../hooks/useExchangeData";

const SECONDS_PER_DAY = 86400;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function limitClass(status: string, over: boolean): string {
  if (status === "ProhibitSend" || status === "MailboxDisabled") return "danger";
  if (over) return "warn";
  return "ok";
}

export function MailboxesPage() {
  const [server, setServer] = useState<string[]>([]);
  const [database, setDatabase] = useState<string[]>([]);

  const mailboxes = useTopMailboxes();
  const databases = useMailboxDatabases();
  const health = useMailboxHealth();

  const servers = useMemo(
    () => Array.from(new Set(mailboxes.data.map((m) => m.server))).sort(),
    [mailboxes.data]
  );
  const dbNames = useMemo(
    () => Array.from(new Set(mailboxes.data.map((m) => m.database))).sort(),
    [mailboxes.data]
  );

  const filteredMailboxes = useMemo(() => {
    let rows = mailboxes.data;
    if (server.length) rows = rows.filter((m) => server.includes(m.server));
    if (database.length) rows = rows.filter((m) => database.includes(m.database));
    // Never-logged-on mailboxes sort after every real age.
    return rows.map((m) => ({
      ...m,
      daysSinceLogon:
        m.lastLogonAgeSeconds == null ? Number.POSITIVE_INFINITY : m.lastLogonAgeSeconds / SECONDS_PER_DAY,
    }));
  }, [mailboxes.data, server, database]);

  const filteredDatabases = useMemo(() => {
    let rows = databases.data;
    if (server.length) rows = rows.filter((d) => server.includes(d.server));
    if (database.length) rows = rows.filter((d) => database.includes(d.database));
    return rows;
  }, [databases.data, server, database]);

  const mailboxSort = useSort(filteredMailboxes, "sizeBytes", "desc");
  const dbSort = useSort(filteredDatabases, "totalSizeBytes", "desc");

  const scanned = useMemo(() => health.data.reduce((sum, h) => sum + h.scanned, 0), [health.data]);
  const overLimit = useMemo(() => mailboxes.data.filter((m) => m.overLimit).length, [mailboxes.data]);
  const largest = useMemo(
    () => mailboxes.data.reduce<(typeof mailboxes.data)[number] | null>(
      (best, m) => (!best || m.sizeBytes > best.sizeBytes ? m : best),
      null
    ),
    [mailboxes.data]
  );
  const failing = health.data.filter((h) => !h.success).length;

  const hasData = mailboxes.data.length > 0 || databases.data.length > 0;

  return (
    <div>
      <header className="page-header">
        <h1>Mailboxes</h1>
        <p>
          Largest mailboxes per server (top 50 by size) and per-database totals from{" "}
          <code>Get-MailboxStatistics</code>. Refreshed about every 30 minutes by the optional mailbox
          task.
        </p>
      </header>

      {!hasData && !mailboxes.loading ? (
        <section className="panel">
          <EmptyPanel
            title="No mailbox metrics"
            detail="Mailbox statistics are optional and come from their own scheduled task. Install it with the installer switch -IncludeMailboxStats (default every 30 minutes), then wait for the first run."
          />
          <SourceHint source={mailboxes.source} error={mailboxes.error} />
        </section>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="label">Mailboxes scanned</div>
              <div className="value">{scanned || "—"}</div>
            </div>
            <div className="kpi">
              <div className="label">Top mailboxes over limit</div>
              <div className={`value ${overLimit ? "warn" : "ok"}`}>{overLimit}</div>
            </div>
            <div className="kpi">
              <div className="label">Largest mailbox</div>
              <div className="value">{largest ? formatBytes(largest.sizeBytes) : "—"}</div>
              {largest ? <div className="muted mono">{largest.name}</div> : null}
            </div>
            <div className="kpi">
              <div className="label">Collector</div>
              <div className={`value ${!health.data.length ? "" : failing ? "danger" : "ok"}`}>
                {!health.data.length ? "—" : failing ? `${failing} failing` : "OK"}
              </div>
            </div>
          </div>

          <div className="toolbar">
            <MultiSelect label="Server" options={servers} value={server} onChange={setServer} />
            <MultiSelect label="Database" options={dbNames} value={database} onChange={setDatabase} />
          </div>

          <section className="panel">
            <h2>Top mailboxes by size</h2>
            {filteredMailboxes.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => mailboxSort.handleSort("name")}>Mailbox{mailboxSort.indicator("name")}</th>
                      <th className="sortable" onClick={() => mailboxSort.handleSort("database")}>Database{mailboxSort.indicator("database")}</th>
                      <th className="sortable" onClick={() => mailboxSort.handleSort("server")}>Server{mailboxSort.indicator("server")}</th>
                      <th className="sortable" onClick={() => mailboxSort.handleSort("sizeBytes")}>Size{mailboxSort.indicator("sizeBytes")}</th>
                      <th className="sortable" onClick={() => mailboxSort.handleSort("deletedBytes")}>Deleted items{mailboxSort.indicator("deletedBytes")}</th>
                      <th className="sortable" onClick={() => mailboxSort.handleSort("itemCount")}>Items{mailboxSort.indicator("itemCount")}</th>
                      <th className="sortable" onClick={() => mailboxSort.handleSort("daysSinceLogon")}>Days since logon{mailboxSort.indicator("daysSinceLogon")}</th>
                      <th className="sortable" onClick={() => mailboxSort.handleSort("limitStatus")}>Storage limit{mailboxSort.indicator("limitStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mailboxSort.sorted.map((m) => (
                      <tr key={`${m.server}|${m.name}`}>
                        <td className="mono">{m.name}</td>
                        <td className="mono">{m.database}</td>
                        <td className="mono">{m.server}</td>
                        <td>{formatBytes(m.sizeBytes)}</td>
                        <td>{formatBytes(m.deletedBytes)}</td>
                        <td>{Math.round(m.itemCount).toLocaleString()}</td>
                        <td>{Number.isFinite(m.daysSinceLogon) ? m.daysSinceLogon.toFixed(1) : "never"}</td>
                        <td className={m.limitStatus ? limitClass(m.limitStatus, m.overLimit) : ""}>
                          {m.limitStatus || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyPanel title="No mailbox rows" detail="No mailboxes match the selected filters." />
            )}
            <SourceHint source={mailboxes.source} error={mailboxes.error} />
          </section>

          <section className="panel">
            <h2>Database totals (all mailboxes)</h2>
            {filteredDatabases.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => dbSort.handleSort("database")}>Database{dbSort.indicator("database")}</th>
                      <th className="sortable" onClick={() => dbSort.handleSort("server")}>Server{dbSort.indicator("server")}</th>
                      <th className="sortable" onClick={() => dbSort.handleSort("mailboxCount")}>Mailboxes{dbSort.indicator("mailboxCount")}</th>
                      <th className="sortable" onClick={() => dbSort.handleSort("totalSizeBytes")}>Total size{dbSort.indicator("totalSizeBytes")}</th>
                      <th className="sortable" onClick={() => dbSort.handleSort("totalItemCount")}>Total items{dbSort.indicator("totalItemCount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbSort.sorted.map((d) => (
                      <tr key={`${d.server}|${d.database}`}>
                        <td className="mono">{d.database}</td>
                        <td className="mono">{d.server}</td>
                        <td>{d.mailboxCount.toLocaleString()}</td>
                        <td>{formatBytes(d.totalSizeBytes)}</td>
                        <td>{Math.round(d.totalItemCount).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyPanel title="No database totals" detail="No databases match the selected filters." />
            )}
            <SourceHint source={databases.source} error={databases.error} />
          </section>
        </>
      )}
    </div>
  );
}
