import { useMemo, useState } from "react";
import { useFleet, useQueues, useTopQueues, useErrors } from "../hooks/useExchangeData";
import { useSort } from "../hooks/useSort";
import { MultiSelect } from "../components/MultiSelect";
import { Sparkline, SourceHint, StatusBadge } from "../components/QueueTable";

export function OverviewPage() {
  const fleet = useFleet();
  const queues = useQueues();
  const topQueues = useTopQueues();
  const errors = useErrors();

  const totalMessages = fleet.data.reduce((sum, s) => sum + s.total, 0);
  const retryQueues = queues.data.filter((q) => q.status.toLowerCase() === "retry").length;
  const servers = fleet.data.length;
  const [topServer, setTopServer] = useState<string[]>([]);
  const [topIdentity, setTopIdentity] = useState<string[]>([]);
  const [topNextHop, setTopNextHop] = useState<string[]>([]);

  const [fleetServer, setFleetServer] = useState<string[]>([]);
  const fleetServers = useMemo(
    () => Array.from(new Set(fleet.data.map((s) => s.server))).sort(),
    [fleet.data]
  );
  const filteredFleet = useMemo(
    () => (fleetServer.length ? fleet.data.filter((s) => fleetServer.includes(s.server)) : fleet.data),
    [fleet.data, fleetServer]
  );

  const topServers = useMemo(
    () => Array.from(new Set(topQueues.data.map((q) => q.server))).sort(),
    [topQueues.data]
  );
  const topIdentities = useMemo(
    () => Array.from(new Set(topQueues.data.map((q) => q.identity))).sort(),
    [topQueues.data]
  );
  const topNextHops = useMemo(
    () => Array.from(new Set(topQueues.data.map((q) => q.nextHopDomain).filter(Boolean))).sort(),
    [topQueues.data]
  );
  const filteredTop = useMemo(() => {
    const hasFilter = topServer.length || topIdentity.length || topNextHop.length;
    let rows = hasFilter ? topQueues.data : topQueues.data.slice(0, 5);
    if (topServer.length) rows = rows.filter((q) => topServer.includes(q.server));
    if (topIdentity.length) rows = rows.filter((q) => topIdentity.includes(q.identity));
    if (topNextHop.length) rows = rows.filter((q) => topNextHop.includes(q.nextHopDomain));
    return rows;
  }, [topQueues.data, topServer, topIdentity, topNextHop]);

  const fleetSort = useSort(filteredFleet, "total", "desc");
  const topSort = useSort(filteredTop, "messageCount", "desc");

  return (
    <div>
      <header className="page-header">
        <h1>Fleet Overview</h1>
        <p>
          Enterprise view of Exchange transport queues. Message counts come from PowerShell{" "}
          <code>Get-Queue</code> via the <code>custom:exchange-queue</code> extension.
        </p>
      </header>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Servers</div>
          <div className="value">{servers}</div>
        </div>
        <div className="kpi">
          <div className="label">Total queued messages</div>
          <div className="value">{totalMessages}</div>
        </div>
        <div className="kpi">
          <div className="label">Queues in Retry</div>
          <div className="value">{retryQueues}</div>
        </div>
        <div className="kpi">
          <div className="label">Error signals</div>
          <div className="value">{errors.data.length}</div>
        </div>
      </div>

      <section className="panel">
        <h2>Servers by queued messages</h2>
        <div className="toolbar">
          <MultiSelect label="Server" options={fleetServers} value={fleetServer} onChange={setFleetServer} />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => fleetSort.handleSort("server")}>Server{fleetSort.indicator("server")}</th>
                <th className="sortable" onClick={() => fleetSort.handleSort("total")}>Total messages{fleetSort.indicator("total")}</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {fleetSort.sorted.map((s) => (
                <tr key={s.server}>
                  <td>{s.server}</td>
                  <td className={s.total >= 1000 ? "danger" : s.total >= 500 ? "warn" : "ok"}>{s.total}</td>
                  <td>
                    <Sparkline values={s.series} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Top queues</h2>
        <div className="toolbar">
          <MultiSelect label="Server" options={topServers} value={topServer} onChange={setTopServer} />
          <MultiSelect label="Queue" options={topIdentities} value={topIdentity} onChange={setTopIdentity} />
          <MultiSelect label="Next hop" options={topNextHops} value={topNextHop} onChange={setTopNextHop} />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => topSort.handleSort("server")}>Server{topSort.indicator("server")}</th>
                <th className="sortable" onClick={() => topSort.handleSort("identity")}>Queue{topSort.indicator("identity")}</th>
                <th className="sortable" onClick={() => topSort.handleSort("nextHopDomain")}>Next hop{topSort.indicator("nextHopDomain")}</th>
                <th className="sortable" onClick={() => topSort.handleSort("status")}>Status{topSort.indicator("status")}</th>
                <th className="sortable" onClick={() => topSort.handleSort("messageCount")}>Messages{topSort.indicator("messageCount")}</th>
              </tr>
            </thead>
            <tbody>
              {topSort.sorted.map((q) => (
                <tr key={q.identity}>
                  <td>{q.server}</td>
                  <td className="mono">{q.identity}</td>
                  <td>{q.nextHopDomain}</td>
                  <td>
                    <StatusBadge status={q.status} />
                  </td>
                  <td className={q.messageCount >= 1000 ? "danger" : q.messageCount >= 500 ? "warn" : "ok"}>{q.messageCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SourceHint source={fleet.source} error={fleet.error} />
      </section>
    </div>
  );
}
