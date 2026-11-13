import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";

const AUTO_REFRESH_INTERVAL = 60_000;

type RefreshContextValue = {
  register: (refetch: () => void) => () => void;
  refreshAll: () => void;
  isRefreshing: boolean;
  lastRefreshed: Date | null;
  autoRefresh: boolean;
  setAutoRefresh: (on: boolean) => void;
};

const RefreshContext = createContext<RefreshContextValue>({
  register: () => () => {},
  refreshAll: () => {},
  isRefreshing: false,
  lastRefreshed: null,
  autoRefresh: false,
  setAutoRefresh: () => {},
});

export function RefreshProvider({ children }: PropsWithChildren) {
  const registry = useRef<Set<() => void>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(() => new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshAllRef = useRef<() => void>(() => {});

  const register = useCallback((refetch: () => void) => {
    registry.current.add(refetch);
    return () => { registry.current.delete(refetch); };
  }, []);

  const refreshAll = useCallback(() => {
    setIsRefreshing(true);
    registry.current.forEach((fn) => fn());
    setTimeout(() => {
      setIsRefreshing(false);
      setLastRefreshed(new Date());
    }, 1500);
  }, []);

  refreshAllRef.current = refreshAll;

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => refreshAllRef.current(), AUTO_REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [autoRefresh]);

  return (
    <RefreshContext.Provider value={{ register, refreshAll, isRefreshing, lastRefreshed, autoRefresh, setAutoRefresh }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefreshContext() {
  return useContext(RefreshContext);
}
