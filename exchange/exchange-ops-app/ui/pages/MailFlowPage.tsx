import { useMailFlow } from "../hooks/useExchangeData";
import { MailFlowMap } from "../components/MailFlowMap";
import { SourceHint } from "../components/QueueTable";

export function MailFlowPage() {
  const flow = useMailFlow();

  return (
    <div>
      <header className="page-header">
        <h1>Mail-flow Map</h1>
        <p>
          Graphical view of Exchange servers to next-hop domains. Edge thickness is message count;
          color reflects queue status (green Active/Ready, red Retry/Suspended).
        </p>
      </header>

      <section className="panel">
        <MailFlowMap edges={flow.data} />
        <SourceHint source={flow.source} error={flow.error} />
      </section>
    </div>
  );
}
