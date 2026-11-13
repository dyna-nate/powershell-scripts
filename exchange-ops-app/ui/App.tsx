import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { EnvironmentProvider } from "./context/EnvironmentContext";
import { RefreshProvider, useRefreshContext } from "./context/RefreshContext";
import { EnvironmentSlicer } from "./components/EnvironmentSlicer";
import { OverviewPage } from "./pages/OverviewPage";
import { QueueExplorerPage } from "./pages/QueueExplorerPage";
import { MailFlowPage } from "./pages/MailFlowPage";
import { TroubleshootPage } from "./pages/TroubleshootPage";
import { ComparePage } from "./pages/ComparePage";
import { InfrastructurePage } from "./pages/InfrastructurePage";
import { DatabaseCopiesPage } from "./pages/DatabaseCopiesPage";
import { HybridPathPage } from "./pages/HybridPathPage";
import { MailboxesPage } from "./pages/MailboxesPage";
import { ServicesPage } from "./pages/ServicesPage";
import { APP_VERSION } from "./version";

function RefreshButton() {
  const { refreshAll, isRefreshing, lastRefreshed, autoRefresh, setAutoRefresh } = useRefreshContext();
  const timeLabel = lastRefreshed
    ? lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  return (
    <div className="refresh-bar">
      {timeLabel && (
        <span className="last-refreshed">Last Updated Time {timeLabel}</span>
      )}
      <button
        className={`btn secondary refresh-btn auto-refresh-toggle ${autoRefresh ? "active" : ""}`}
        onClick={() => setAutoRefresh(!autoRefresh)}
        title="Toggle auto-refresh every 60 seconds"
      >
        {autoRefresh ? "⏱ Auto: On" : "⏱ Auto: Off"}
      </button>
      <button
        className="btn secondary refresh-btn"
        onClick={refreshAll}
        disabled={isRefreshing}
        title="Refresh all data"
      >
        {isRefreshing ? "↻ Refreshing…" : "↻ Refresh"}
      </button>
    </div>
  );
}

export function App() {
  return (
    <EnvironmentProvider>
      <RefreshProvider>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            Exchange Ops
            <span>Get-Queue + hybrid mail-path</span>
          </div>
          <EnvironmentSlicer />
          <nav className="nav">
            <NavLink to="/" end>
              Fleet Overview
            </NavLink>
            <NavLink to="/hybrid-path">Hybrid Path</NavLink>
            <NavLink to="/queues">Queue Explorer</NavLink>
            <NavLink to="/database-copies">Database Copies</NavLink>
            <NavLink to="/mailboxes">Mailboxes</NavLink>
            <NavLink to="/services">Services</NavLink>
            <NavLink to="/infrastructure">Infrastructure</NavLink>
            <NavLink to="/mail-flow">Mail-flow Map</NavLink>
            <NavLink to="/troubleshoot">Troubleshoot</NavLink>
            <NavLink to="/compare">Compare</NavLink>
          </nav>
          <div className="sidebar-footer">Version {APP_VERSION}</div>
        </aside>
        <main className="main">
          <div className="main-toolbar">
            <RefreshButton />
          </div>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/hybrid-path" element={<HybridPathPage />} />
            <Route path="/queues" element={<QueueExplorerPage />} />
            <Route path="/infrastructure" element={<InfrastructurePage />} />
            <Route path="/database-copies" element={<DatabaseCopiesPage />} />
            <Route path="/mailboxes" element={<MailboxesPage />} />
            <Route path="/mail-flow" element={<MailFlowPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/troubleshoot" element={<TroubleshootPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      </RefreshProvider>
    </EnvironmentProvider>
  );
}
