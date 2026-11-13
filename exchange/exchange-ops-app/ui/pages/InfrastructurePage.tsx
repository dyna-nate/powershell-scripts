import { useMemo, useState } from "react";
import { EmptyPanel } from "../components/DataBanner";
import { MultiSelect } from "../components/MultiSelect";
import { SourceHint } from "../components/QueueTable";
import {
  useNamedQueueKpis,
  useSubmissionCounters,
  useClusterNetworks,
} from "../hooks/useExchangeData";

export function InfrastructurePage() {
  const named = useNamedQueueKpis();
  const counters = useSubmissionCounters();
  const cluster = useClusterNetworks();

  const [clusterNode, setClusterNode] = useState<string[]>([]);
  const [clusterState, setClusterState] = useState<string[]>([]);

  const clusterNodes = useMemo(
    () => Array.from(new Set(cluster.data.map((n) => n.node))).sort(),
    [cluster.data]
  );
  const clusterStates = useMemo(
    () => Array.from(new Set(cluster.data.map((n) => n.state))).sort(),
    [cluster.data]
  );
  const clusterUpCount = useMemo(
    () => cluster.data.filter((n) => n.state.toLowerCase() === "up").length,
    [cluster.data]
  );
  const clusterDownCount = useMemo(
    () => cluster.data.filter((n) => n.state.toLowerCase() !== "up").length,
    [cluster.data]
  );

  const filteredCluster = useMemo(() => {
    let rows = cluster.data;
    if (clusterNode.length) rows = rows.filter((n) => clusterNode.includes(n.node));
    if (clusterState.length) rows = rows.filter((n) => clusterState.includes(n.state));
    return rows;
  }, [cluster.data, clusterNode, clusterState]);

  return (
    <div>
      <header className="page-header">
        <h1>Infrastructure</h1>
        <p>
          Named transport KPIs (from Get-Queue) and submission counters. Requires feature sets{" "}
          <code>queue-named</code>, <code>counters</code>.
        </p>
      </header>

      <section className="panel">
        <h2>Named queue lengths (Get-Queue aligned)</h2>
        {named.data.length ? (
          <div className="kpi-grid">
            {named.data.map((n) => (
              <div className="kpi" key={n.label}>
                <div className="label">{n.label}</div>
                <div className="value">{n.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="No named queue KPIs"
            detail="Enable feature set queue-named on the monitoring configuration."
          />
        )}
        <SourceHint source={named.source} error={named.error} />
      </section>

      <section className="panel">
        <h2>Cluster networks</h2>
        <div className="kpi-grid">
          <div className="kpi">
            <div className="label">Nodes Up</div>
            <div className="value ok">{clusterUpCount}</div>
          </div>
          <div className="kpi">
            <div className="label">Nodes Not Up</div>
            <div className={`value ${clusterDownCount === 0 ? "ok" : "danger"}`}>{clusterDownCount}</div>
          </div>
        </div>
        <div className="toolbar">
          <MultiSelect label="Server" options={clusterNodes} value={clusterNode} onChange={setClusterNode} />
          <MultiSelect label="State" options={clusterStates} value={clusterState} onChange={setClusterState} />
        </div>
        {cluster.data.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {filteredCluster.map((n) => (
                  <tr key={n.node}>
                    <td>{n.node}</td>
                    <td className={n.state.toLowerCase() === "up" ? "ok" : "danger"}>{n.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel title="No cluster node data" detail="Requires ms-exchange.cluster.node.state metric." />
        )}
        <SourceHint source={cluster.source} error={cluster.error} />
      </section>

      <section className="panel">
        <h2>Submission / IS counters</h2>
        {counters.data.length ? (
          <div className="kpi-grid">
            {counters.data.map((c) => (
              <div className="kpi" key={c.label}>
                <div className="label">{c.label}</div>
                <div className="value">{c.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel title="No counter KPIs" detail="Enable feature set counters." />
        )}
        <SourceHint source={counters.source} error={counters.error} />
      </section>
    </div>
  );
}
