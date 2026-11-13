import { useMemo, useState } from "react";
import { useSort } from "../hooks/useSort";
import { EmptyPanel } from "../components/DataBanner";
import { Sparkline, SourceHint } from "../components/QueueTable";
import { useEnvironment } from "../context/EnvironmentContext";
import {
  useExchangeServices,
  useFleet,
  useHybridOutbound,
  useOnlineConnectors,
  useOnlineOutboundUnhealthy,
  useOnlineServiceHealth,
  useQueues,
} from "../hooks/useExchangeData";

type CompareMode = "servers" | "path";

export function ComparePage() {
  const { onlineAvailable } = useEnvironment();
  const [mode, setMode] = useState<CompareMode>(onlineAvailable ? "path" : "servers");

  return (
    <div>
      <header className="page-header">
        <h1>Compare</h1>
        <p>
          Side-by-side triage: on-prem servers, or hybrid path analogs (on-prem vs Online — not equal
          counts).
        </p>
      </header>

      <div className="toolbar">
        <label className="field">
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as CompareMode)}>
            <option value="servers">Server A vs Server B</option>
            <option value="path" disabled={!onlineAvailable}>
              On-prem path vs Online path{onlineAvailable ? "" : " (Online not configured)"}
            </option>
          </select>
        </label>
      </div>

      {mode === "servers" ? <ServerCompare /> : <PathCompare />}
    </div>
  );
}

function PathCompare() {
  const { onlineAvailable } = useEnvironment();
  const hybrid = useHybridOutbound();
  const connectors = useOnlineConnectors();
  const unhealthy = useOnlineOutboundUnhealthy();
  const service = useOnlineServiceHealth();
  const services = useExchangeServices();

  const backlog = hybrid.data.reduce((n, r) => n + r.hybridBacklog, 0);
  const retry = hybrid.data.reduce((n, r) => n + r.hybridRetry, 0);
  const transportDown = services.data.filter(
    (s) => s.name === "MSExchangeTransport" && s.status !== "Running"
  ).length;
  const outboundUnhealthy = unhealthy.data.outboundUnhealthy;
  const onlineHealthyConnectors = connectors.data.filter((c) => c.healthy).length;

  if (!onlineAvailable) {
    return (
      <EmptyPanel
        title="Online path compare unavailable"
        detail="Enable extension feature set online and pythonOnline before using path analogs. Use Server A vs Server B for on-prem compare."
      />
    );
  }

  const analogs = [
    {
      label: "Hybrid / external backlog vs outbound connector issues",
      onprem: `${backlog} msgs on hybrid hops`,
      online: `${outboundUnhealthy} unhealthy outbound connector(s)`,
      note: "Analog — Online has no Get-Queue depth",
    },
    {
      label: "Hybrid retry vs connector validation / health",
      onprem: `${retry} msgs in Retry/Suspended toward Online`,
      online: `${connectors.data.length - onlineHealthyConnectors} connector(s) not healthy`,
      note: "Analog — retry state ↔ connector health",
    },
    {
      label: "Transport service vs Exchange Online service",
      onprem: transportDown > 0 ? `${transportDown} transport service(s) down` : "Transport running",
      online: service.data.healthy
        ? "Exchange Online healthy"
        : `Exchange Online: ${service.data.status}`,
      note: "Analog — different layers, same ops question",
    },
  ];

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">On-prem hybrid backlog</div>
          <div className="value">{backlog}</div>
        </div>
        <div className="kpi">
          <div className="label">Online outbound unhealthy</div>
          <div className="value">{outboundUnhealthy}</div>
        </div>
        <div className="kpi">
          <div className="label">Online service</div>
          <div className={`value ${service.data.healthy ? "ok" : "danger"}`}>
            {service.data.healthy ? "Healthy" : service.data.status}
          </div>
        </div>
      </div>

      <section className="panel">
        <h2>Path analog map</h2>
        <p className="muted">Labeled analogs for hybrid mail-path health — not EMS equality.</p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Question</th>
                <th>On-prem</th>
                <th>Online</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {analogs.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.onprem}</td>
                  <td>{row.online}</td>
                  <td className="muted">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SourceHint source={hybrid.source} error={hybrid.error} />
      </section>
    </>
  );
}

function ServerCompare() {
  const fleet = useFleet();
  const queues = useQueues();
  const servers = useMemo(
    () => Array.from(new Set(fleet.data.map((s) => s.server))).sort(),
    [fleet.data]
  );
  const [left, setLeft] = useState(servers[0] ?? "");
  const [right, setRight] = useState(servers[1] ?? servers[0] ?? "");

  const leftFleet = fleet.data.find((s) => s.server === left);
  const rightFleet = fleet.data.find((s) => s.server === right);
  const leftQueues = queues.data.filter((q) => q.server === left);
  const rightQueues = queues.data.filter((q) => q.server === right);

  return (
    <>
      <div className="toolbar">
        <label className="field">
          Server A
          <select value={left} onChange={(e) => setLeft(e.target.value)}>
            {servers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Server B
          <select value={right} onChange={(e) => setRight(e.target.value)}>
            {servers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">{left} total</div>
          <div className="value">{leftFleet?.total ?? 0}</div>
          <Sparkline values={leftFleet?.series ?? []} />
        </div>
        <div className="kpi">
          <div className="label">{right} total</div>
          <div className="value">{rightFleet?.total ?? 0}</div>
          <Sparkline values={rightFleet?.series ?? []} />
        </div>
        <div className="kpi">
          <div className="label">{left} queue rows</div>
          <div className="value">{leftQueues.length}</div>
        </div>
        <div className="kpi">
          <div className="label">{right} queue rows</div>
          <div className="value">{rightQueues.length}</div>
        </div>
      </div>

      <section className="panel">
        <h2>Queue delta (A − B by next hop)</h2>
        <CompareHops left={leftQueues} right={rightQueues} />
        <SourceHint source={fleet.source} error={fleet.error} />
      </section>
    </>
  );
}

function CompareHops({
  left,
  right,
}: {
  left: { nextHopDomain: string; messageCount: number }[];
  right: { nextHopDomain: string; messageCount: number }[];
}) {
  const rows = useMemo(() => {
    const map = new Map<string, { a: number; b: number }>();
    for (const q of left) {
      const cur = map.get(q.nextHopDomain) ?? { a: 0, b: 0 };
      cur.a += q.messageCount;
      map.set(q.nextHopDomain, cur);
    }
    for (const q of right) {
      const cur = map.get(q.nextHopDomain) ?? { a: 0, b: 0 };
      cur.b += q.messageCount;
      map.set(q.nextHopDomain, cur);
    }
    return [...map.entries()].map(([hop, v]) => ({ hop, a: v.a, b: v.b, delta: v.a - v.b }));
  }, [left, right]);

  const hopSort = useSort(rows, "delta", "desc");

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th className="sortable" onClick={() => hopSort.handleSort("hop")}>Next hop{hopSort.indicator("hop")}</th>
            <th className="sortable" onClick={() => hopSort.handleSort("a")}>Server A{hopSort.indicator("a")}</th>
            <th className="sortable" onClick={() => hopSort.handleSort("b")}>Server B{hopSort.indicator("b")}</th>
            <th className="sortable" onClick={() => hopSort.handleSort("delta")}>Delta{hopSort.indicator("delta")}</th>
          </tr>
        </thead>
        <tbody>
          {hopSort.sorted.map((r) => (
            <tr key={r.hop}>
              <td>{r.hop}</td>
              <td>{r.a}</td>
              <td>{r.b}</td>
              <td>{r.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
