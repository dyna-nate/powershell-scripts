import type { QueueRow } from "../hooks/useExchangeData";
import { useSort } from "../hooks/useSort";

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const kind =
    s === "retry" || s === "suspended" || s === "dismounted" ? "danger"
    : s === "active" || s === "ready" || s === "running" || s === "mounted" ? "ok"
    : s === "healthy" ? "warn"
    : "warn";
  return <span className={`badge ${kind}`}>{status || "n/a"}</span>;
}

export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (!values.length) return <span className="muted">—</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline fill="none" stroke="#3d8bfd" strokeWidth="1.5" points={pts} />
    </svg>
  );
}

type QueueColumn = "server" | "identity" | "deliveryType" | "status" | "nextHopDomain" | "nextHopCategory" | "mailPath" | "messageCount" | "velocity" | "trend";

export function QueueTable({ rows, hideColumns = [] }: { rows: QueueRow[]; hideColumns?: QueueColumn[] }) {
  const { sorted, handleSort, indicator } = useSort(rows, "messageCount", "desc");
  const hide = new Set(hideColumns);

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {!hide.has("server") && <th className="sortable" onClick={() => handleSort("server")}>Server{indicator("server")}</th>}
            {!hide.has("identity") && <th className="sortable" onClick={() => handleSort("identity")}>Queue{indicator("identity")}</th>}
            {!hide.has("deliveryType") && <th className="sortable" onClick={() => handleSort("deliveryType")}>Delivery{indicator("deliveryType")}</th>}
            {!hide.has("nextHopDomain") && <th className="sortable" onClick={() => handleSort("nextHopDomain")}>Next hop{indicator("nextHopDomain")}</th>}
            {!hide.has("status") && <th className="sortable" onClick={() => handleSort("status")}>Status{indicator("status")}</th>}
            {!hide.has("messageCount") && <th className="sortable" onClick={() => handleSort("messageCount")}>Messages{indicator("messageCount")}</th>}
            {!hide.has("nextHopCategory") && <th className="sortable" onClick={() => handleSort("nextHopCategory")}>Category{indicator("nextHopCategory")}</th>}
            {!hide.has("mailPath") && <th className="sortable" onClick={() => handleSort("mailPath")}>Mail path{indicator("mailPath")}</th>}
            {!hide.has("velocity") && <th className="sortable" onClick={() => handleSort("velocity")}>Velocity{indicator("velocity")}</th>}
            {!hide.has("trend") && <th>Trend</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.server}|${r.identity}`}>
              {!hide.has("server") && <td>{r.server}</td>}
              {!hide.has("identity") && <td className="mono">{r.identity}</td>}
              {!hide.has("deliveryType") && <td>{r.deliveryType}</td>}
              {!hide.has("nextHopDomain") && <td>{r.nextHopDomain}</td>}
              {!hide.has("status") && <td><StatusBadge status={r.status} /></td>}
              {!hide.has("messageCount") && <td className={r.messageCount >= 1000 ? "danger" : r.messageCount >= 500 ? "warn" : "ok"}>{r.messageCount}</td>}
              {!hide.has("nextHopCategory") && <td>{r.nextHopCategory}</td>}
              {!hide.has("mailPath") && <td>{r.mailPath || "—"}</td>}
              {!hide.has("velocity") && <td>{r.velocity == null ? "—" : r.velocity.toFixed(2)}</td>}
              {!hide.has("trend") && <td><Sparkline values={r.series} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourceHint({
  source,
  error,
}: {
  source: "live" | "demo" | "empty";
  error?: string | null;
}) {
  // Keep quiet for live data — avoid "demo" / fallback messaging that confuses operators.
  if (source === "live") {
    return null;
  }
  if (source === "empty" && error) {
    return (
      <p className="note source-hint source-hint-empty">
        Unable to load metrics: {error}
      </p>
    );
  }
  if (source === "empty") {
    return (
      <p className="note source-hint source-hint-empty">
        No matching <code>custom.exchange.*</code> metrics in the selected window.
      </p>
    );
  }
  return null;
}
