import { useCallback } from "react";
import { fetchOpsCommandLatest } from "@/lib/api/heliophysics-proxy";
import type { BackendMemoryPressureLevel, OpsCommandSnapshotResponse } from "@/lib/types/space-weather";
import { useRealtimeFeed } from "@/hooks/useRealtimeFeed";

const POLL_INTERVAL_MS = 5000;

export interface OpsCommandSnapshotState {
  data: OpsCommandSnapshotResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOpsCommandSnapshot(
  enabled = true,
  governorLevel?: BackendMemoryPressureLevel,
): OpsCommandSnapshotState {
  const fetcher = useCallback(async () => fetchOpsCommandLatest(), []);

  const feed = useRealtimeFeed<OpsCommandSnapshotResponse | null>({
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
  });

  return {
    data: feed.data,
    loading: feed.loading,
    error: feed.error,
    refresh: feed.refresh,
  };
}
