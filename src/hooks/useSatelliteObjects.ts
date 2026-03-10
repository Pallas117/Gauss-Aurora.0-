/// <reference types="vite/client" />
import { useSpaceDomainSnapshot } from "@/hooks/useSpaceDomainSnapshot";
import type { SatelliteObject, SatelliteObjectsSnapshotResponse } from "@/lib/types/space-weather";

export function useSatelliteObjects(options?: { enabled?: boolean }) {
  const state = useSpaceDomainSnapshot(options);
  return {
    data: state.satellites as SatelliteObjectsSnapshotResponse | null,
    loading: state.loading,
    error: state.error,
    refresh: state.refresh,
  };
}

export type { SatelliteObject };
