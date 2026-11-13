import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { dqlOnlineIngestProbe } from "../dql/queries";
import { isDemoDataEnabled, subscribeDemoDataChange } from "../config/demoMode";

/** UI environment filter for On-prem / Online / Both. */
export type EnvironmentFilter = "onprem" | "online" | "both";

const ENV_STORAGE_KEY = "exchange-ops.environment";

type EnvironmentContextValue = {
  environment: EnvironmentFilter;
  setEnvironment: (value: EnvironmentFilter) => void;
  /** Dimension value for DQL, or undefined when Both. */
  environmentDimension?: "onprem" | "online";
  /** True when Online metrics exist in Grail, or demo mode is on. */
  onlineAvailable: boolean;
  onlineLoading: boolean;
};

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

function readStoredEnvironment(): EnvironmentFilter {
  try {
    const saved = localStorage.getItem(ENV_STORAGE_KEY);
    if (saved === "onprem" || saved === "online" || saved === "both") {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return "onprem";
}

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironmentState] = useState<EnvironmentFilter>(readStoredEnvironment);
  const [demoOn, setDemoOn] = useState(isDemoDataEnabled);
  const probe = useDql({ query: dqlOnlineIngestProbe() });

  useEffect(() => subscribeDemoDataChange(() => setDemoOn(isDemoDataEnabled())), []);

  const setEnvironment = useCallback((value: EnvironmentFilter) => {
    setEnvironmentState(value);
    try {
      localStorage.setItem(ENV_STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
  }, []);

  const onlineFromGrail =
    !probe.isLoading &&
    !probe.error &&
    Array.isArray(probe.data?.records) &&
    probe.data.records.length > 0;

  const onlineAvailable = demoOn || onlineFromGrail;

  useEffect(() => {
    if (!onlineAvailable && (environment === "online" || environment === "both")) {
      setEnvironment("onprem");
    }
  }, [onlineAvailable, environment, setEnvironment]);

  const value = useMemo(
    () => ({
      environment,
      setEnvironment,
      environmentDimension:
        environment === "both" ? undefined : (environment as "onprem" | "online"),
      onlineAvailable,
      onlineLoading: Boolean(probe.isLoading),
    }),
    [environment, setEnvironment, onlineAvailable, probe.isLoading]
  );

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}

export function useEnvironment(): EnvironmentContextValue {
  const ctx = useContext(EnvironmentContext);
  if (!ctx) {
    throw new Error("useEnvironment must be used within EnvironmentProvider");
  }
  return ctx;
}
