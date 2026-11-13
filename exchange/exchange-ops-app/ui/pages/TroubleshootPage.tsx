import { useMemo, useState } from "react";
import { useErrors, usePoison, useStuck } from "../hooks/useExchangeData";
import { MultiSelect } from "../components/MultiSelect";
import { QueueTable, SourceHint, StatusBadge } from "../components/QueueTable";
import { useSort } from "../hooks/useSort";

export function TroubleshootPage() {
  const stuck = useStuck();
  const poison = usePoison();
  const errors = useErrors();
  const errSort = useSort(errors.data, "errorCount", "desc");

  const [stuckServer, setStuckServer] = useState<string[]>([]);
  const [stuckIdentity, setStuckIdentity] = useState<string[]>([]);
  const [stuckStatus, setStuckStatus] = useState<string[]>([]);
  const [stuckDeliveryType, setStuckDeliveryType] = useState<string[]>([]);
  const [stuckNextHop, setStuckNextHop] = useState<string[]>([]);
  const [stuckMailPath, setStuckMailPath] = useState<string[]>([]);

  const stuckServers = useMemo(
    () => Array.from(new Set(stuck.data.map((q) => q.server))).sort(),
    [stuck.data]
  );
  const stuckIdentities = useMemo(
    () => Array.from(new Set(stuck.data.map((q) => q.identity))).sort(),
    [stuck.data]
  );
  const stuckStatuses = useMemo(
    () => Array.from(new Set(stuck.data.map((q) => q.status))).sort(),
    [stuck.data]
  );
  const stuckDeliveryTypes = useMemo(
    () => Array.from(new Set(stuck.data.map((q) => q.deliveryType))).sort(),
    [stuck.data]
  );
  const stuckNextHops = useMemo(
    () => Array.from(new Set(stuck.data.map((q) => q.nextHopDomain).filter(Boolean))).sort(),
    [stuck.data]
  );
  const stuckMailPaths = useMemo(
    () => Array.from(new Set(stuck.data.map((q) => q.mailPath).filter((v): v is string => !!v))).sort(),
    [stuck.data]
  );

  const filteredStuck = useMemo(() => {
    let rows = stuck.data;
    if (stuckServer.length) rows = rows.filter((q) => stuckServer.includes(q.server));
    if (stuckIdentity.length) rows = rows.filter((q) => stuckIdentity.includes(q.identity));
    if (stuckStatus.length) rows = rows.filter((q) => stuckStatus.includes(q.status));
    if (stuckDeliveryType.length) rows = rows.filter((q) => stuckDeliveryType.includes(q.deliveryType));
    if (stuckNextHop.length) rows = rows.filter((q) => stuckNextHop.includes(q.nextHopDomain));
    if (stuckMailPath.length) rows = rows.filter((q) => stuckMailPath.includes(q.mailPath ?? ""));
    return rows;
  }, [stuck.data, stuckServer, stuckIdentity, stuckStatus, stuckDeliveryType, stuckNextHop, stuckMailPath]);

  return (
    <div>
      <header className="page-header">
        <h1>Troubleshoot</h1>
        <p>
          Playbooks for common Exchange transport issues. Counts match EMS <code>Get-Queue</code> at
          each extension scrape.
        </p>
      </header>

      <div className="playbook-grid">
        <article className="playbook">
          <h3>Stuck delivery (velocity ≈ 0)</h3>
          <p className="muted">
            Queues with messages but no progress. Compare with <code>Get-Queue</code> and review{" "}
            <code>LastError</code> / next hop DNS or smart host.
          </p>
        </article>
        <article className="playbook">
          <h3>Retry / LastError</h3>
          <p className="muted">
            Queues reporting Retry/Suspended or a non-empty LastError from the queue-errors feature
            set.
          </p>
        </article>
        <article className="playbook">
          <h3>Poison &amp; Unreachable</h3>
          <p className="muted">
            Concentration in Poison or Unreachable identities — investigate content and routing.
          </p>
        </article>
      </div>

      <section className="panel">
        <h2>Stuck queues</h2>
        <div className="toolbar">
          <MultiSelect label="Server" options={stuckServers} value={stuckServer} onChange={setStuckServer} />
          <MultiSelect label="Queue" options={stuckIdentities} value={stuckIdentity} onChange={setStuckIdentity} />
          <MultiSelect label="Status" options={stuckStatuses} value={stuckStatus} onChange={setStuckStatus} />
          <MultiSelect label="Delivery type" options={stuckDeliveryTypes} value={stuckDeliveryType} onChange={setStuckDeliveryType} />
          <MultiSelect label="Next hop" options={stuckNextHops} value={stuckNextHop} onChange={setStuckNextHop} />
          <MultiSelect label="Mail path" options={stuckMailPaths} value={stuckMailPath} onChange={setStuckMailPath} />
        </div>
        <QueueTable rows={filteredStuck} hideColumns={["nextHopCategory", "trend"]} />
      </section>

      <section className="panel">
        <h2>Retry / error signals</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => errSort.handleSort("status")}>Status{errSort.indicator("status")}</th>
                <th className="sortable" onClick={() => errSort.handleSort("server")}>Server{errSort.indicator("server")}</th>
                <th className="sortable" onClick={() => errSort.handleSort("identity")}>Queue{errSort.indicator("identity")}</th>
                <th className="sortable" onClick={() => errSort.handleSort("nextHopDomain")}>Next hop{errSort.indicator("nextHopDomain")}</th>
                <th className="sortable" onClick={() => errSort.handleSort("lastError")}>Last error{errSort.indicator("lastError")}</th>
                <th className="sortable" onClick={() => errSort.handleSort("errorCount")}>Signals{errSort.indicator("errorCount")}</th>
              </tr>
            </thead>
            <tbody>
              {errSort.sorted.map((e) => (
                <tr key={`${e.server}|${e.identity}`}>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td>{e.server}</td>
                  <td className="mono">{e.identity}</td>
                  <td>{e.nextHopDomain}</td>
                  <td className="mono">{e.lastError || "—"}</td>
                  <td>{e.errorCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Poison / Unreachable / Retry concentration</h2>
        <QueueTable rows={poison.data} />
        <SourceHint source={stuck.source} error={stuck.error} />
      </section>
    </div>
  );
}
