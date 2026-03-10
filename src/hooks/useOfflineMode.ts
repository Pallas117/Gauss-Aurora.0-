import { useEffect, useMemo, useState } from "react";
import { getAdaptivePollInterval } from "@/lib/power/polling";

export interface UseOfflineModeOptions {
  lastSuccessfulSyncAt?: number | string | Date | null;
  staleAfterMs?: number;
}

export interface OfflineModeState {
  isOnline: boolean;
  isOffline: boolean;
  staleData: boolean;
  staleAgeMs: number | null;
  lastSuccessfulSyncAt: number | null;
  changedAt: number;
}

function toTimestamp(value: number | string | Date | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  if (typeof value === "string") {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }
  return null;
}

function getInitialOnlineState(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine;
}

export function useOfflineMode(options: UseOfflineModeOptions = {}): OfflineModeState {
  const { lastSuccessfulSyncAt = null, staleAfterMs = 60_000 } = options;
  const [isOnline, setIsOnline] = useState<boolean>(getInitialOnlineState());
  const [changedAt, setChangedAt] = useState<number>(Date.now());
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      setChangedAt(Date.now());
    };
    const onOffline = () => {
      setIsOnline(false);
      setChangedAt(Date.now());
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    let timer: number | null = null;
    let active = true;
    const run = () => {
      if (!active) {
        return;
      }
      setTick((value) => value + 1);
      timer = window.setTimeout(run, getAdaptivePollInterval(10_000));
    };
    run();

    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const syncTs = toTimestamp(lastSuccessfulSyncAt);

  return useMemo(() => {
    const now = Date.now();
    const ageMs = syncTs == null ? null : Math.max(0, now - syncTs);
    const staleData =
      syncTs == null || (Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? ageMs != null && ageMs > staleAfterMs : false);

    return {
      isOnline,
      isOffline: !isOnline,
      staleData,
      staleAgeMs: ageMs,
      lastSuccessfulSyncAt: syncTs,
      changedAt,
    };
  }, [changedAt, isOnline, staleAfterMs, syncTs, tick]);
}
