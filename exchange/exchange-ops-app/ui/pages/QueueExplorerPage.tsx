import { useMemo, useState } from "react";
import { EmptyPanel } from "../components/DataBanner";
import { useEnvironment } from "../context/EnvironmentContext";
import { useOnlineConnectors, useQueues } from "../hooks/useExchangeData";
import { QueueTable, SourceHint } from "../components/QueueTable";
import { useSort } from "../hooks/useSort";
import { MultiSelect } from "../components/MultiSelect";

export function QueueExplorerPage() {
  const { environment, onlineAvailable } = useEnvironment();

  if (environment === "online") {
    if (!onlineAvailable) {
      return (
        <div>
          <header className="page-header">
            <h1>Connector Explorer</h1>
          </header>
          <EmptyPanel
            title="Online not configured"
            detail="Switch Environment to On-prem, or enable extension online + pythonOnline."
          />
        </div>
      );
    }
    return <OnlineConnectorExplorer />;
  }

  return <OnPremQueueExplorer />;
}

function OnlineConnectorExplorer() {
  const connectors = useOnlineConnectors();
  const connSort = useSort(connectors.data, "name", "asc");

  return (
    <div>
      <header className="page-header">
        <h1>Connector Explorer</h1>
        <p>
          Exchange Online inbound/outbound connectors. There is no Get-Queue surface in Online —
          this view replaces the queue explorer when Environment is Online.
        </p>
      </header>
      <section className="panel">
        {connectors.data.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => connSort.handleSort("name")}>Name{connSort.indicator("name")}</th>
                  <th className="sortable" onClick={() => connSort.handleSort("direction")}>Direction{connSort.indicator("direction")}</th>
                  <th className="sortable" onClick={() => connSort.handleSort("type")}>Type{connSort.indicator("type")}</th>
                  <th className="sortable" onClick={() => connSort.handleSort("enabled")}>Enabled{connSort.indicator("enabled")}</th>
                  <th className="sortable" onClick={() => connSort.handleSort("validated")}>Validated{connSort.indicator("validated")}</th>
                  <th className="sortable" onClick={() => connSort.handleSort("healthy")}>Healthy{connSort.indicator("healthy")}</th>
                </tr>
              </thead>
              <tbody>
                {connSort.sorted.map((c) => (
                  <tr key={`${c.direction}-${c.name}`}>
                    <td>{c.name}</td>
                    <td>{c.direction}</td>
                    <td>{c.type}</td>
                    <td>{c.enabled ? "yes" : "no"}</td>
                    <td>{c.validated ? "yes" : "no"}</td>
                    <td className={c.healthy ? "ok" : "danger"}>{c.healthy ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel title="No connectors" detail="No custom.exchange.online.connector.* rows." />
        )}
        <SourceHint source={connectors.source} error={connectors.error} />
      </section>
    </div>
  );
}

function OnPremQueueExplorer() {
  const [server, setServer] = useState<string[]>([]);
  const [identity, setIdentity] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [deliveryType, setDeliveryType] = useState<string[]>([]);
  const [mailPath, setMailPath] = useState<string[]>([]);
  const [pivot, setPivot] = useState<
    "none" | "server" | "deliveryType" | "status" | "nextHopDomain" | "mailPath"
  >("none");

  const filters = useMemo(
    () => ({
      server: server.length ? server : undefined,
      identity: identity.length ? identity : undefined,
      status: status.length ? status : undefined,
      deliveryType: deliveryType.length ? deliveryType : undefined,
      mailPath: mailPath.length ? mailPath : undefined,
    }),
    [server, identity, status, deliveryType, mailPath]
  );

  const allQueues = useQueues();
  const queues = useQueues(undefined, filters);

  const servers = useMemo(
    () => Array.from(new Set(allQueues.data.map((q) => q.server))).sort(),
    [allQueues.data]
  );
  const identities = useMemo(
    () => Array.from(new Set(allQueues.data.map((q) => q.identity))).sort(),
    [allQueues.data]
  );
  const statuses = useMemo(
    () => Array.from(new Set(allQueues.data.map((q) => q.status))).sort(),
    [allQueues.data]
  );
  const deliveryTypes = useMemo(
    () => Array.from(new Set(allQueues.data.map((q) => q.deliveryType))).sort(),
    [allQueues.data]
  );

  const pivotRows = useMemo(() => {
    if (pivot === "none") return [];
    const map = new Map<string, number>();
    for (const q of queues.data) {
      const key =
        pivot === "server"
          ? q.server
          : pivot === "deliveryType"
            ? q.deliveryType
            : pivot === "status"
              ? q.status
              : pivot === "mailPath"
                ? q.mailPath || "unknown"
                : q.nextHopDomain;
      map.set(key, (map.get(key) ?? 0) + q.messageCount);
    }
    return [...map.entries()].map(([key, total]) => ({ key, total }));
  }, [queues.data, pivot]);
  const pivotSort = useSort(pivotRows, "total", "desc");

  return (
    <div>
      <header className="page-header">
        <h1>Queue Explorer</h1>
        <p>
          Pivot transport queues by server, delivery type, status, next hop, and mail path — the same
          dimensions returned by <code>Get-Queue</code> (plus hybrid classification).
        </p>
      </header>

      <div className="toolbar">
        <MultiSelect label="Server" options={servers} value={server} onChange={setServer} />
        <MultiSelect label="Queue" options={identities} value={identity} onChange={setIdentity} />
        <MultiSelect label="Status" options={statuses} value={status} onChange={setStatus} />
        <MultiSelect label="Delivery type" options={deliveryTypes} value={deliveryType} onChange={setDeliveryType} />
        <MultiSelect
          label="Mail path"
          options={["hybrid_outbound", "internal", "external_other"]}
          value={mailPath}
          onChange={setMailPath}
        />
        <label className="field">
          Pivot
          <select value={pivot} onChange={(e) => setPivot(e.target.value as typeof pivot)}>
            <option value="none">Detail rows</option>
            <option value="server">By server</option>
            <option value="deliveryType">By delivery type</option>
            <option value="status">By status</option>
            <option value="nextHopDomain">By next hop</option>
            <option value="mailPath">By mail path</option>
          </select>
        </label>
      </div>

      <section className="panel">
        {pivot === "none" ? (
          <QueueTable rows={queues.data} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => pivotSort.handleSort("key")}>{pivot}{pivotSort.indicator("key")}</th>
                  <th className="sortable" onClick={() => pivotSort.handleSort("total")}>Messages{pivotSort.indicator("total")}</th>
                </tr>
              </thead>
              <tbody>
                {pivotSort.sorted.map((r) => (
                  <tr key={r.key}>
                    <td>{r.key}</td>
                    <td>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <SourceHint source={queues.source} error={queues.error} />
      </section>
    </div>
  );
}
