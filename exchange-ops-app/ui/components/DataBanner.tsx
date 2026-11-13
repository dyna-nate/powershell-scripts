import { useEffect, useState } from "react";
import {
  isDemoDataEnabled,
  setDemoDataEnabled,
  subscribeDemoDataChange,
} from "../config/demoMode";
import { useEnvironment } from "../context/EnvironmentContext";
import { APP_VERSION } from "../version";

/** Global banner: demo mode warning or Online-not-configured notice. */
export function DataBanner() {
  const { onlineAvailable, onlineLoading, environment } = useEnvironment();
  const [demo, setDemo] = useState(isDemoDataEnabled);

  useEffect(() => subscribeDemoDataChange(() => setDemo(isDemoDataEnabled())), []);

  if (demo) {
    return (
      <div className="data-banner data-banner-demo" role="status">
        <strong>Demo sample data is ON.</strong> Charts may show Contoso placeholders — not customer
        Exchange health.{" "}
        <button type="button" className="linkish" onClick={() => setDemoDataEnabled(false)}>
          Turn off demo data
        </button>
        <span className="data-banner-meta">v{APP_VERSION}</span>
      </div>
    );
  }

  if (!onlineLoading && !onlineAvailable && (environment === "online" || environment === "both")) {
    return (
      <div className="data-banner data-banner-info" role="status">
        <strong>Exchange Online metrics not detected.</strong> Enable the extension{" "}
        <code>online</code> feature set and fill <code>pythonOnline</code>, or keep Environment on
        On-prem. Hybrid Path Online panels stay empty until ingest exists.
        <span className="data-banner-meta">v{APP_VERSION}</span>
      </div>
    );
  }

  // No always-on "info" banner — Fleet Overview should be the first thing operators see.
  return null;
}

export function EmptyPanel({
  title = "No data",
  detail,
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="empty-panel">
      <div className="empty-panel-title">{title}</div>
      {detail ? <p className="muted">{detail}</p> : null}
    </div>
  );
}
