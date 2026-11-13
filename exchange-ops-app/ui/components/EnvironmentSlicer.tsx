import { useEffect, useState } from "react";
import { useEnvironment, type EnvironmentFilter } from "../context/EnvironmentContext";
import {
  isDemoDataEnabled,
  isDemoToggleVisible,
  setDemoDataEnabled,
  subscribeDemoDataChange,
} from "../config/demoMode";

export function EnvironmentSlicer() {
  const { environment, setEnvironment, onlineAvailable, onlineLoading } = useEnvironment();
  const [demo, setDemo] = useState(isDemoDataEnabled);
  const showDemoToggle = isDemoToggleVisible();

  useEffect(() => subscribeDemoDataChange(() => setDemo(isDemoDataEnabled())), []);

  const options: { value: EnvironmentFilter; label: string; disabled?: boolean; title?: string }[] =
    [
      { value: "onprem", label: "On-prem" },
      {
        value: "both",
        label: "Both",
        disabled: !onlineAvailable && !onlineLoading,
        title: onlineAvailable
          ? undefined
          : "Online metrics not detected — enable extension online feature set first",
      },
      {
        value: "online",
        label: "Online",
        disabled: !onlineAvailable && !onlineLoading,
        title: onlineAvailable
          ? undefined
          : "Online metrics not detected — enable extension online feature set first",
      },
    ];

  return (
    <div className="env-slicer" role="group" aria-label="Environment">
      <span className="env-slicer-label">Environment</span>
      <div className="env-slicer-options">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={environment === opt.value ? "env-btn active" : "env-btn"}
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => setEnvironment(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {showDemoToggle ? (
        <label className="env-demo-toggle">
          <input
            type="checkbox"
            checked={demo}
            onChange={(e) => setDemoDataEnabled(e.target.checked)}
          />
          Demo sample data
        </label>
      ) : null}
    </div>
  );
}
