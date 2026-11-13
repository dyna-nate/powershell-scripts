import { useMemo, useState } from "react";
import type { FlowEdge } from "../hooks/useExchangeData";

type Props = {
  edges: FlowEdge[];
  maxNodes?: number;
};

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "retry" || s === "suspended") return "#f07178";
  if (s === "active" || s === "ready") return "#3ecf8e";
  return "#f0b429";
}

/**
 * Hierarchical mail-flow map: servers on the left, next-hop domains on the right.
 * Clusters when cardinality is high (keeps top edges by message count).
 */
export function MailFlowMap({ edges, maxNodes = 40 }: Props) {
  const layout = useMemo(() => {
    const sorted = [...edges].sort((a, b) => b.messageCount - a.messageCount);
    const limited = sorted.slice(0, maxNodes);
    const servers = Array.from(new Set(limited.map((e) => e.server)));
    const hops = Array.from(new Set(limited.map((e) => e.nextHopDomain || "(none)")));

    const width = 900;
    const height = Math.max(620, Math.max(servers.length, hops.length) * 48 + 80);
    const leftX = 140;
    const rightX = width - 160;
    const serverPos = new Map(
      servers.map((s, i) => [
        s,
        { x: leftX, y: 60 + (i + 0.5) * ((height - 80) / Math.max(servers.length, 1)) },
      ])
    );
    const hopPos = new Map(
      hops.map((h, i) => [
        h,
        { x: rightX, y: 60 + (i + 0.5) * ((height - 80) / Math.max(hops.length, 1)) },
      ])
    );
    const maxMsg = Math.max(...limited.map((e) => e.messageCount), 1);

    const serverTotals = new Map<string, number>();
    for (const e of limited) {
      serverTotals.set(e.server, (serverTotals.get(e.server) ?? 0) + e.messageCount);
    }

    return { limited, serverPos, hopPos, width, height, maxMsg, serverTotals, truncated: sorted.length > limited.length };
  }, [edges, maxNodes]);

  const [tooltip, setTooltip] = useState<{ name: string; total: number; x: number; y: number } | null>(null);

  return (
    <div>
      {layout.truncated ? (
        <p className="muted">Showing top {maxNodes} flows by message count (cardinality guard).</p>
      ) : null}
      <svg className="flow-map" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Mail flow map">
        {layout.limited.map((e, idx) => {
          const a = layout.serverPos.get(e.server)!;
          const b = layout.hopPos.get(e.nextHopDomain || "(none)")!;
          const strokeW = 1 + (e.messageCount / layout.maxMsg) * 8;
          const midX = (a.x + b.x) / 2;
          return (
            <g key={`${e.server}-${e.nextHopDomain}-${idx}`}>
              <path
                d={`M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`}
                fill="none"
                stroke={statusColor(e.status)}
                strokeWidth={strokeW}
                opacity={0.75}
              >
                <title>
                  {e.server} → {e.nextHopDomain} ({e.messageCount} msgs, {e.status}, {e.deliveryType})
                </title>
              </path>
            </g>
          );
        })}
        {[...layout.serverPos.entries()].map(([name, p]) => (
          <g
            key={`s-${name}`}
            style={{ cursor: "default" }}
            onMouseEnter={() => setTooltip({ name, total: layout.serverTotals.get(name) ?? 0, x: p.x, y: p.y })}
            onMouseLeave={() => setTooltip(null)}
          >
            <circle cx={p.x} cy={p.y} r={14} fill="#1e2a38" stroke="#3d8bfd" strokeWidth={2} />
            <text x={p.x} y={p.y + 28} textAnchor="middle" fill="#e8eef4" fontSize="12">
              {name}
            </text>
          </g>
        ))}
        {tooltip && (
          <g>
            <rect
              x={tooltip.x + 20}
              y={tooltip.y - 18}
              width={140}
              height={36}
              rx={6}
              fill="#1a222c"
              stroke="#3d8bfd"
              strokeWidth={1}
            />
            <text x={tooltip.x + 90} y={tooltip.y - 3} textAnchor="middle" fill="#8b9aab" fontSize="11">
              {tooltip.name}
            </text>
            <text x={tooltip.x + 90} y={tooltip.y + 13} textAnchor="middle" fill="#e8eef4" fontSize="13" fontWeight="600">
              {tooltip.total.toLocaleString()} msgs
            </text>
          </g>
        )}
        {[...layout.hopPos.entries()].map(([name, p]) => (
          <g key={`h-${name}`}>
            <rect x={p.x - 12} y={p.y - 12} width={24} height={24} rx={4} fill="#1e2a38" stroke="#8b9aab" />
            <text x={p.x} y={p.y + 28} textAnchor="middle" fill="#e8eef4" fontSize="11">
              {name.length > 28 ? `${name.slice(0, 26)}…` : name}
            </text>
          </g>
        ))}
        <text x={140} y={28} fill="#8b9aab" fontSize="12">
          Exchange servers
        </text>
        <text x={layout.width - 160} y={28} textAnchor="middle" fill="#8b9aab" fontSize="12">
          Next hop domains
        </text>
      </svg>
    </div>
  );
}
