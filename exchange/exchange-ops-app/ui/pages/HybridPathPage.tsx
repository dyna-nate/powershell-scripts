import { EmptyPanel } from "../components/DataBanner";
import { SourceHint } from "../components/QueueTable";
import { useEnvironment } from "../context/EnvironmentContext";
import {
  useHybridOutbound,
  useOnlineConnectors,
  useOnlineOutboundUnhealthy,
  useOnlineServiceHealth,
} from "../hooks/useExchangeData";
import { useSort } from "../hooks/useSort";

export function HybridPathPage() {
  const { onlineAvailable } = useEnvironment();
  const hybrid = useHybridOutbound();
  const connectors = useOnlineConnectors();
  const service = useOnlineServiceHealth();
  const unhealthy = useOnlineOutboundUnhealthy();

  const backlogTotal = hybrid.data.reduce((n, r) => n + r.hybridBacklog, 0);
  const retryTotal = hybrid.data.reduce((n, r) => n + r.hybridRetry, 0);
  const healthyConnectors = connectors.data.filter((c) => c.healthy).length;

  const hybridSort = useSort(hybrid.data, "server", "asc");
  const connSort = useSort(connectors.data, "name", "asc");

  return (
    <div>
      <header className="page-header">
        <h1>Hybrid Path</h1>
        <p>
          Can mail leave on-prem toward Exchange Online, and can Online accept/send on hybrid
          connectors? KPIs are path analogs — not equal queue depths.
        </p>
      </header>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">On-prem hybrid backlog</div>
          <div className="value">{backlogTotal}</div>
        </div>
        <div className="kpi">
          <div className="label">On-prem hybrid retry</div>
          <div className="value">{retryTotal}</div>
        </div>
        {onlineAvailable ? (
          <>
            <div className="kpi">
              <div className="label">Online connectors healthy</div>
              <div className="value">
                {healthyConnectors}/{connectors.data.length}
              </div>
            </div>
            <div className="kpi">
              <div className="label">Online outbound unhealthy</div>
              <div className="value">{unhealthy.data.outboundUnhealthy}</div>
            </div>
            <div className="kpi">
              <div className="label">Exchange Online service</div>
              <div className={`value ${service.data.healthy ? "ok" : "danger"}`}>
                {service.data.healthy ? "Healthy" : service.data.status}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="split-panels">
        <section className="panel">
          <h2>On-prem → Online (Get-Queue hybrid hops)</h2>
          <p className="muted">
            Queues classified as <code>mail_path=hybrid_outbound</code>. Set monitoring config{" "}
            <code>hybridHopDomains</code> to match this tenant&apos;s hybrid connector hostnames
            (defaults cover <code>*.mail.protection.outlook.com</code>).
          </p>
          {hybrid.data.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => hybridSort.handleSort("server")}>Server{hybridSort.indicator("server")}</th>
                    <th className="sortable" onClick={() => hybridSort.handleSort("hybridBacklog")}>Hybrid backlog{hybridSort.indicator("hybridBacklog")}</th>
                    <th className="sortable" onClick={() => hybridSort.handleSort("hybridRetry")}>Hybrid retry{hybridSort.indicator("hybridRetry")}</th>
                  </tr>
                </thead>
                <tbody>
                  {hybridSort.sorted.map((r) => (
                    <tr key={r.server}>
                      <td>{r.server}</td>
                      <td>{r.hybridBacklog}</td>
                      <td>{r.hybridRetry}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel
              title="No hybrid outbound backlog"
              detail="No mail_path=hybrid_outbound rollups in the last 2h. Confirm queues feature set and hybridHopDomains."
            />
          )}
          <SourceHint source={hybrid.source} error={hybrid.error} />
        </section>

        <section className="panel">
          <h2>Exchange Online connectors</h2>
          {onlineAvailable ? (
            <>
              <p className="muted">
                Inbound/outbound connector enabled + validated state from EXO PowerShell.
              </p>
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
                          <td className={c.healthy ? "ok" : "danger"}>
                            {c.healthy ? "yes" : "no"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyPanel title="No Online connectors" detail="Query returned no connector rows." />
              )}
              <SourceHint source={connectors.source} error={connectors.error} />
            </>
          ) : (
            <EmptyPanel
              title="Online not configured"
              detail="Add featureSets: online and pythonOnline (tenantId, appId, certificateThumbprint) on the extension monitoring configuration. This panel stays empty until custom.exchange.online.* metrics ingest."
            />
          )}
        </section>
      </div>
    </div>
  );
}
