import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

/** Dynatrace serves apps under /ui/apps/<app.id>/... — without this, "/" never matches. */
function appBasename(): string {
  try {
    const match = window.location.pathname.match(/^\/ui\/apps\/[^/]+/);
    return match?.[0] ?? "";
  } catch {
    return "";
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <BrowserRouter basename={appBasename()}>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}
