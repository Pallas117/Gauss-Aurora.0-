import { useEffect, useState } from "react";
import { fetchBackendHealth } from "@/lib/api/heliophysics-proxy";
import { getAdaptivePollInterval } from "@/lib/power/polling";
import type { BackendHealthResponse } from "@/lib/types/space-weather";

interface UseBackendHealthOptions {
  enabled?: boolean;
  basePollMs?: number;
}

export function useBackendHealth(
  options: UseBackendHealthOptions = {},
) {
  const { enabled = true, basePollMs = 15_000 } = options;
  const [health, setHealth] = useState<BackendHealthResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let active = true;
    let timer: number | null = null;

    const run = async () => {
      try {
        const next = await fetchBackendHealth();
        if (!active) {
          return;
        }
        setHealth(next);
        setError(null);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : "Backend health check failed");
      } finally {
        if (!active) {
          return;
        }
        setLoading(false);
        timer = window.setTimeout(run, getAdaptivePollInterval(basePollMs));
      }
    };

    void run();
    return () => {
      active = false;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [basePollMs, enabled]);

  return {
    health,
    loading,
    error,
    memoryLevel: health?.memory?.level ?? "nominal",
    svgLiteForced: health?.memory?.svgLiteForced ?? false,
  };
}
