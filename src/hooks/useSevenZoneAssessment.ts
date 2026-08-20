import { useCallback } from "react";
import { useRealtimeFeed } from "@/hooks/useRealtimeFeed";
import { fetchSevenZoneAssessment } from "@/lib/api/heliophysics-proxy";
import type { SevenZoneAssessment } from "@/lib/types/seven-zone";
import type { BackendMemoryPressureLevel } from "@/lib/types/space-weather";

export function useSevenZoneAssessment(options?: { enabled?: boolean; governorLevel?: BackendMemoryPressureLevel }) {
  const fetcher = useCallback(() => fetchSevenZoneAssessment(), []);
  return useRealtimeFeed<SevenZoneAssessment | null>({
    fetcher,
    initialData: null,
    intervalMs: 30_000,
    enabled: options?.enabled ?? true,
    governor: { level: options?.governorLevel, constrainedMs: 60_000, criticalMs: 120_000 },
  });
}
