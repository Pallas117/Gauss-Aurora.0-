import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendTrendSample,
  getAdaptivePollInterval,
  getTrendAwarePollInterval,
  getGovernorAwarePollInterval,
  type TrendPollOptions,
  type TrendSample,
} from "@/lib/power/polling";
import type { BackendMemoryPressureLevel } from "@/lib/types/space-weather";

export interface UseRealtimeFeedOptions<T> {
  fetcher: () => Promise<T>;
  initialData: T;
  intervalMs?: number;
  enabled?: boolean;
  mapError?: (error: unknown) => string;
  resolveIntervalMs?: (data: T, baseIntervalMs: number, samples: TrendSample[]) => number | null | undefined;
  trendSampling?: TrendPollOptions & {
    selectMetric: (data: T) => number | null;
    selectTimestampMs?: (data: T) => number | null;
  };
  governor?: {
    level?: BackendMemoryPressureLevel;
    nominalMs?: number;
    constrainedMs?: number;
    criticalMs?: number;
    hiddenMs?: number;
  };
}

export interface UseRealtimeFeedState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 5000;

export function useRealtimeFeed<T>({
  fetcher,
  initialData,
  intervalMs = DEFAULT_INTERVAL_MS,
  enabled = true,
  mapError,
  resolveIntervalMs,
  trendSampling,
  governor,
}: UseRealtimeFeedOptions<T>): UseRealtimeFeedState<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  const dataRef = useRef(data);
  const trendSamplesRef = useRef<TrendSample[]>([]);
  const trendSamplingRef = useRef(trendSampling);
  const resolveIntervalMsRef = useRef(resolveIntervalMs);
  const governorRef = useRef(governor);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    trendSamplingRef.current = trendSampling;
    if (!trendSampling) {
      trendSamplesRef.current = [];
    }
  }, [trendSampling]);

  useEffect(() => {
    resolveIntervalMsRef.current = resolveIntervalMs;
  }, [resolveIntervalMs]);

  useEffect(() => {
    governorRef.current = governor;
  }, [governor]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<T | null> => {
    try {
      const next = await fetcherRef.current();
      if (!mountedRef.current) {
        return null;
      }
      setData(next);
      const trendConfig = trendSamplingRef.current;
      if (trendConfig) {
        const metric = trendConfig.selectMetric(next);
        const timestampMs = trendConfig.selectTimestampMs?.(next) ?? Date.now();
        if (metric != null && Number.isFinite(metric) && Number.isFinite(timestampMs)) {
          trendSamplesRef.current = appendTrendSample(
            trendSamplesRef.current,
            { timestampMs, value: metric },
            trendConfig,
          );
        }
      }
      setError(null);
      setLastUpdated(new Date());
      return next;
    } catch (err) {
      if (!mountedRef.current) {
        return null;
      }
      const mapped = mapError ? mapError(err) : err instanceof Error ? err.message : "Fetch failed";
      setError(mapped);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [mapError]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      trendSamplesRef.current = [];
      return;
    }

    let active = true;
    let timer: number | null = null;

    const run = async () => {
      const next = await load();
      if (!active) {
        return;
      }
      const resolvedInterval = resolveIntervalMsRef.current?.(
        next ?? dataRef.current,
        getGovernorAwarePollInterval(intervalMs, governorRef.current),
        trendSamplesRef.current,
      );
      const governorBaseMs = getGovernorAwarePollInterval(intervalMs, governorRef.current);
      timer = window.setTimeout(
        run,
        resolvedInterval && Number.isFinite(resolvedInterval) && resolvedInterval > 0
          ? Math.round(resolvedInterval)
          : trendSamplingRef.current
            ? getTrendAwarePollInterval(governorBaseMs, trendSamplesRef.current, trendSamplingRef.current)
            : getAdaptivePollInterval(governorBaseMs),
      );
    };

    void run();

    return () => {
      active = false;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled, intervalMs, load]);

  return {
    data,
    loading,
    error,
    lastUpdated,
    refresh,
  };
}
