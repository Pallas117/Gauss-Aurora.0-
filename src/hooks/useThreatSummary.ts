import { useCallback, useMemo } from "react";
import type { ThreatSummaryResponse } from "@/lib/types/space-weather";
import { fetchThreatSummary } from "@/lib/api/heliophysics-proxy";
import { getAccessToken } from "@/lib/api/auth";
import { useRealtimeFeed } from "@/hooks/useRealtimeFeed";

const POLL_INTERVAL_MS = 5000;

export interface ThreatSummaryState {
  data: ThreatSummaryResponse | null;
  topThreat: ThreatSummaryResponse["threats"][number] | null;
  loading: boolean;
  error: string | null;
}

interface UseThreatSummaryOptions {
  enabled?: boolean;
}

export function useThreatSummary(options: UseThreatSummaryOptions = {}): ThreatSummaryState {
  const { enabled = true } = options;

  const fetcher = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error("Sign in to load protected threat fusion output.");
    }
    return fetchThreatSummary();
  }, []);

  const feed = useRealtimeFeed<ThreatSummaryResponse | null>({
    fetcher,
    initialData: null,
    intervalMs: POLL_INTERVAL_MS,
    enabled,
    trendSampling: {
      selectMetric: (data) => {
        if (!data) {
          return null;
        }
        return (
          data.summary.top_threat_score * 0.6 +
          data.summary.actionable_threat_count * 10 +
          data.gate.flux_proxy * 0.02
        );
      },
      selectTimestampMs: (data) => (data ? Date.parse(data.timestamp) : null),
      maxMultiplier: 3,
    },
  });

  const topThreat = useMemo(
    () => (feed.data && feed.data.threats.length > 0 ? feed.data.threats[0] : null),
    [feed.data],
  );

  return {
    data: feed.data,
    topThreat,
    loading: feed.loading,
    error: feed.error,
  };
}
