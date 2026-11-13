import { useMemo, useState } from "react";
import { EmptyPanel } from "../components/DataBanner";
import { MultiSelect } from "../components/MultiSelect";
import { SourceHint, StatusBadge } from "../components/QueueTable";
import { useSort } from "../hooks/useSort";
import { useExchangeServices } from "../hooks/useExchangeData";

export function ServicesPage() {
  const [server, setServer] = useState<string[]>([]);
  const [label, setLabel] = useState<string[]>([]);
  const [name, setName] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);

  const services = useExchangeServices();

  const servers = useMemo(
    () => Array.from(new Set(services.data.map((s) => s.server))).sort(),
    [services.data]
  );
  const labels = useMemo(
    () => Array.from(new Set(services.data.map((s) => s.label))).sort(),
    [services.data]
  );
  const names = useMemo(
    () => Array.from(new Set(services.data.map((s) => s.name))).sort(),
    [services.data]
  );
  const statuses = useMemo(
    () => Array.from(new Set(services.data.map((s) => s.status))).sort(),
    [services.data]
  );

  const filtered = useMemo(() => {
    let rows = services.data;
    if (server.length) rows = rows.filter((s) => server.includes(s.server));
    if (label.length) rows = rows.filter((s) => label.includes(s.label));
    if (name.length) rows = rows.filter((s) => name.includes(s.name));
    if (status.length) rows = rows.filter((s) => status.includes(s.status));
    return rows;
  }, [services.data, server, label, name, status]);

  const svcSort = useSort(filtered, "server", "asc");

  return (
    <div>
      <header className="page-header">
        <h1>Services</h1>
        <p>
          Critical Exchange, WWW Publishing (W3SVC), and Cluster service health. Requires feature
          set <code>services</code>.
        </p>
      </header>

      <div className="toolbar">
        <MultiSelect label="Server" options={servers} value={server} onChange={setServer} />
        <MultiSelect label="Label" options={labels} value={label} onChange={setLabel} />
        <MultiSelect label="Service Name" options={names} value={name} onChange={setName} />
        <MultiSelect label="Status" options={statuses} value={status} onChange={setStatus} />
      </div>

      <section className="panel">
        {services.data.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => svcSort.handleSort("server")}>Server{svcSort.indicator("server")}</th>
                  <th className="sortable" onClick={() => svcSort.handleSort("label")}>Label{svcSort.indicator("label")}</th>
                  <th className="sortable" onClick={() => svcSort.handleSort("name")}>Service name{svcSort.indicator("name")}</th>
                  <th className="sortable" onClick={() => svcSort.handleSort("status")}>Status{svcSort.indicator("status")}</th>
                </tr>
              </thead>
              <tbody>
                {svcSort.sorted.map((s) => (
                  <tr key={`${s.server}|${s.name}`}>
                    <td className="mono">{s.server}</td>
                    <td>{s.label}</td>
                    <td className="mono">{s.name}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel title="No service rows" detail="Enable feature set services." />
        )}
        <SourceHint source={services.source} error={services.error} />
      </section>
    </div>
  );
}
