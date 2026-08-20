import { useCallback } from "react";
import { useRealtimeFeed } from "@/hooks/useRealtimeFeed";
import {
  fetchOpsDelegationQueue,
  fetchOpsWorkers,
} from "@/lib/api/heliophysics-proxy";
import type {
  BackendMemoryPressureLevel,
  OpsDelegationQueueResponse,
  WorkerStatusSnapshot,
} from "@/lib/types/space-weather";

export interface OpsWorkerMeshState {
  workers: WorkerStatusSnapshot[];
  queue: OpsDelegationQueueResponse;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_QUEUE: OpsDelegationQueueResponse = {
  pendingTasks: [],
  queuedApprovals: [],
};

export function useOpsWorkerMesh(
  enabled = true,
  governorLevel?: BackendMemoryPressureLevel,
): OpsWorkerMeshState {
  const fetcher = useCallback(async () => {
    const [workersResponse, queueResponse] = await Promise.all([
      fetchOpsWorkers(),
      fetchOpsDelegationQueue(),
    ]);
    return {
      workers: workersResponse.workers,
      queue: {
        ...queueResponse,
        brokerPolicy:
          queueResponse.brokerPolicy ?? workersResponse.brokerPolicy,
      },
    };
  }, []);

  const feed = useRealtimeFeed<{
    workers: WorkerStatusSnapshot[];
    queue: OpsDelegationQueueResponse;
  }>({
    fetcher,
    initialData: {
      workers: [],
      queue: EMPTY_QUEUE,
    },
    intervalMs: 10_000,
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
    workers: feed.data.workers,
    queue: feed.data.queue,
    loading: feed.loading,
    error: feed.error,
    refresh: feed.refresh,
  };
}
