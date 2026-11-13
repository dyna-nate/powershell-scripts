/**
 * Demo sample data is disabled for AppEngine deploys.
 *
 * Do not use import.meta.env here — dt-app's runtime may leave it undefined
 * ("Cannot read properties of undefined (reading 'PROD')").
 *
 * Local Contoso walkthrough: temporarily set FORCE below to true in a private branch,
 * or use the Vite shim + empty Grail with sidebar toggle only when hostname is localhost.
 */

const STORAGE_KEY = "exchange-ops.demoData";

function isLocalDevHost(): boolean {
  try {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1";
  } catch {
    return false;
  }
}

export function isDemoDataEnabled(): boolean {
  if (!isLocalDevHost()) {
    return false;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDemoDataEnabled(enabled: boolean): void {
  if (!isLocalDevHost()) {
    return;
  }
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("exchange-ops-demo-change"));
}

export function isDemoToggleVisible(): boolean {
  return isLocalDevHost();
}

export function subscribeDemoDataChange(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener("exchange-ops-demo-change", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("exchange-ops-demo-change", handler);
    window.removeEventListener("storage", handler);
  };
}
