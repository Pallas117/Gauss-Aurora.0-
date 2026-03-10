import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendTrendSample,
  getAdaptivePollInterval,
  getTrendAwarePollInterval,
  type TrendPollOptions,
  type TrendSample,
} from "@/lib/power/polling";

export interface UseRealtimeFeedOptions<T> {
  fetcher: () => Promise<T>;
  initialData: T;
  intervalMs?: number;
  enabled?: boolean;
  mapError?: (error: unknown) => string;
  trendSampling?: TrendPollOptions & {
    selectMetric: (data: T) => number | null;
    selectTimestampMs?: (data: T) => number | null;
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
  trendSampling,
}: UseRealtimeFeedOptions<T>): UseRealtimeFeedState<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  const trendSamplesRef = useRef<TrendSample[]>([]);
  const trendSamplingRef = useRef(trendSampling);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    trendSamplingRef.current = trendSampling;
    if (!trendSampling) {
      trendSamplesRef.current = [];
    }
  }, [trendSampling]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      if (!mountedRef.current) {
        return;
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
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      const mapped = mapError ? mapError(err) : err instanceof Error ? err.message : "Fetch failed";
      setError(mapped);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [mapError]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      trendSamplesRef.current = [];
      return;
    }

    let active = true;
    let timer: number | null = null;

    const run = async () => {
      await refresh();
      if (!active) {
        return;
      }
      timer = window.setTimeout(
        run,
        trendSamplingRef.current
          ? getTrendAwarePollInterval(intervalMs, trendSamplesRef.current, trendSamplingRef.current)
          : getAdaptivePollInterval(intervalMs),
      );
    };

    void run();

    return () => {
      active = false;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled, intervalMs, refresh]);

  return {
    data,
    loading,
    error,
    lastUpdated,
    refresh,
  };
}
