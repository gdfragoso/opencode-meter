import { useCallback, useEffect, useRef, useState } from "react";
import { useRefresh } from "@/dashboard/App";

export interface UseAutoRefreshResult {
  lastUpdated: number;
  isPaused: boolean;
  secondsSinceUpdate: number;
  interval: number;
  setInterval: (ms: number) => void;
}

export function useAutoRefresh(initialInterval = 30000): UseAutoRefreshResult {
  const { refresh } = useRefresh();
  // Lazy initialiser: Date.now() during render is impure and would give a
  // different value on every re-render.
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());
  const [secondsSince, setSecondsSince] = useState(0);
  const [interval, setIntervalState] = useState(initialInterval);

  const isPaused = interval === 0;

  // The timers are rebuilt only when the interval changes. Keeping the tick in
  // a ref stops a new `refresh` identity from tearing them down and restarting
  // the second counter on every refresh.
  const tickRef = useRef<() => void>(() => {});
  // Assigned in an effect, not during render: the ref has to hold the latest
  // closure without being read while React is rendering.
  useEffect(() => {
    tickRef.current = () => {
      if (document.hidden || isPaused) return;
      refresh();
      setLastUpdated(Date.now());
      setSecondsSince(0);
    };
  });

  useEffect(() => {
    const secondTimer = globalThis.setInterval(() => {
      setSecondsSince((prev) => prev + 1);
    }, 1000);

    const refreshTimer =
      interval > 0
        ? globalThis.setInterval(() => {
            tickRef.current();
          }, interval)
        : null;

    return () => {
      globalThis.clearInterval(secondTimer);
      if (refreshTimer !== null) globalThis.clearInterval(refreshTimer);
    };
  }, [interval]);

  // Coming back to a hidden tab, the second counter is however far behind the
  // last refresh actually was.
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        setSecondsSince(Math.floor((Date.now() - lastUpdated) / 1000));
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [lastUpdated]);

  const setRefreshInterval = useCallback((ms: number) => {
    setIntervalState(ms);
  }, []);

  return {
    lastUpdated,
    isPaused,
    secondsSinceUpdate: secondsSince,
    interval,
    setInterval: setRefreshInterval,
  };
}
