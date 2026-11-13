import { useMemo, useState } from "react";
import { EmptyPanel } from "../components/DataBanner";
import { MultiSelect } from "../components/MultiSelect";
import { SourceHint, StatusBadge } from "../components/QueueTable";
import { useSort } from "../hooks/useSort";
import { useDatabaseCopies } from "../hooks/useExchangeData";

export function DatabaseCopiesPage() {
  const [server, setServer] = useState<string[]>([]);
  const [copy, setCopy] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);

  const databases = useDatabaseCopies();

  const servers = useMemo(
    () => Array.from(new Set(databases.data.map((d) => d.server))).sort(),
    [databases.data]
  );
  const copies = useMemo(
    () => Array.from(new Set(databases.data.map((d) => d.name))).sort(),
    [databases.data]
  );
  const statuses = useMemo(
    () => Array.from(new Set(databases.data.map((d) => d.status))).sort(),
    [databases.data]
  );

  const totalMounted = useMemo(
    () => databases.data.filter((d) => d.mounted).length,
    [databases.data]
  );
  const totalHealthy = useMemo(
    () => databases.data.filter((d) => d.status.toLowerCase() === "healthy").length,
    [databases.data]
  );

  const filtered = useMemo(() => {
    let rows = databases.data;
    if (server.length) rows = rows.filter((d) => server.includes(d.server));
    if (copy.length) rows = rows.filter((d) => copy.includes(d.name));
    if (status.length) rows = rows.filter((d) => status.includes(d.status));
    return rows;
  }, [databases.data, server, copy, status]);

  const dbSort = useSort(filtered, "server", "asc");

  return (
    <div>
      <header className="page-header">
        <h1>Database Copies</h1>
        <p>
          Exchange database copy health — copy/replay queue lengths and mount status. Requires
          feature set <code>database</code>.
        </p>
      </header>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Mounted DBs</div>
          <div className="value ok">{totalMounted}</div>
        </div>
        <div className="kpi">
          <div className="label">Healthy DBs</div>
          <div className="value ok">{totalHealthy}</div>
        </div>
      </div>

      <div className="toolbar">
        <MultiSelect label="Server" options={servers} value={server} onChange={setServer} />
        <MultiSelect label="Copy" options={copies} value={copy} onChange={setCopy} />
        <MultiSelect label="Status" options={statuses} value={status} onChange={setStatus} />
      </div>

      <section className="panel">
        {databases.data.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => dbSort.handleSort("server")}>Server{dbSort.indicator("server")}</th>
                  <th className="sortable" onClick={() => dbSort.handleSort("name")}>Copy{dbSort.indicator("name")}</th>
                  <th className="sortable" onClick={() => dbSort.handleSort("status")}>Status{dbSort.indicator("status")}</th>
                  <th className="sortable" onClick={() => dbSort.handleSort("copyQueueLength")}>Copy queue{dbSort.indicator("copyQueueLength")}</th>
                  <th className="sortable" onClick={() => dbSort.handleSort("replayQueueLength")}>Replay queue{dbSort.indicator("replayQueueLength")}</th>
                  <th className="sortable" onClick={() => dbSort.handleSort("mounted")}>Mounted{dbSort.indicator("mounted")}</th>
                </tr>
              </thead>
              <tbody>
                {dbSort.sorted.map((d) => (
                  <tr key={`${d.server}|${d.name}`}>
                    <td className="mono">{d.server}</td>
                    <td className="mono">{d.name}</td>
                    <td><StatusBadge status={d.status} /></td>
                    <td className={d.copyQueueLength >= 1000 ? "danger" : d.copyQueueLength >= 500 ? "warn" : "ok"}>{d.copyQueueLength}</td>
                    <td className={d.replayQueueLength >= 1000 ? "danger" : d.replayQueueLength >= 500 ? "warn" : "ok"}>{d.replayQueueLength}</td>
                    <td>{d.mounted ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel title="No database copy rows" detail="Enable feature set database." />
        )}
        <SourceHint source={databases.source} error={databases.error} />
      </section>
    </div>
  );
}
