import { useCallback, useMemo } from "react";
import type {
  BackendMemoryPressureLevel,
  MissionCoreSnapshotResponse,
} from "@/lib/types/space-weather";
import { fetchMissionCoreLatest } from "@/lib/api/heliophysics-proxy";
import { getAccessToken } from "@/lib/api/auth";
import { useRealtimeFeed } from "@/hooks/useRealtimeFeed";

const POLL_INTERVAL_MS = 10_000;

export interface UseMissionCoreSnapshotOptions {
  enabled?: boolean;
  governorLevel?: BackendMemoryPressureLevel;
}

export interface UseMissionCoreSnapshotResult {
  data: MissionCoreSnapshotResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMissionCoreSnapshot(
  options: UseMissionCoreSnapshotOptions = {},
): UseMissionCoreSnapshotResult {
  const { enabled = true } = options;
  const governorLevel = options.governorLevel;

  const fetcher = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error("Sign in to load mission core snapshot.");
    }
    return fetchMissionCoreLatest();
  }, []);

  const feed = useRealtimeFeed<MissionCoreSnapshotResponse | null>({
    fetcher,
    initialData: null,
    intervalMs: POLL_INTERVAL_MS,
    enabled,
    governor: {
      level: governorLevel,
      nominalMs: 10_000,
      constrainedMs: 20_000,
      criticalMs: 30_000,
      hiddenMs: 30_000,
    },
    trendSampling: {
      selectMetric: (data) => {
        if (!data) {
          return null;
        }
        const topThreat = data.threats[0]?.composite_score ?? 0;
        const canonical = data.observation.canonicalLatest;
        return (
          canonical.solarWind.speed * 0.01 +
          canonical.indices.kp * 6 +
          Math.abs(canonical.magneticField.z) * 3 +
          topThreat * 0.2
        );
      },
      selectTimestampMs: (data) => (data ? Date.parse(data.timestamp) : null),
      maxMultiplier: 3,
    },
  });

  return useMemo(
    () => ({
      data: feed.data,
      loading: feed.loading,
      error: feed.error,
      refresh: feed.refresh,
    }),
    [feed.data, feed.loading, feed.error, feed.refresh],
  );
}
