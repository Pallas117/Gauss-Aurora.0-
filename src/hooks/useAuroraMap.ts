import { useEffect, useState } from "react";
import type { AuroraMapResponse } from "@/lib/types/space-weather";
import { getAccessToken } from "@/lib/api/auth";
import { fetchAuroraMap as fetchAuroraMapContract } from "@/lib/api/heliophysics-proxy";
import { readOfflineCache, writeOfflineCache } from "@/lib/offline/offline-cache";
import { getAdaptivePollInterval } from "@/lib/power/polling";

const POLL_INTERVAL_MS = 5000;
const CACHE_KEY = "feed:aurora-map:gsm";
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface AuroraMapState {
  map: AuroraMapResponse | null;
  loading: boolean;
  error: string | null;
}

interface UseAuroraMapOptions {
  enabled?: boolean;
}

export function useAuroraMap(options: UseAuroraMapOptions = {}): AuroraMapState {
  const { enabled = true } = options;
  const [map, setMap] = useState<AuroraMapResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      setMap(null);
      return;
    }

    let mounted = true;

    const fetchMap = async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!mounted) {
            return;
          }
          const cached = await readOfflineCache<AuroraMapResponse>(CACHE_KEY);
          if (cached?.data && navigator.onLine === false) {
            setMap(cached.data);
            setError(
              `Offline mode: using cached aurora map (${Math.max(
                0,
                Math.round((Date.now() - cached.cachedAt) / 1000),
              )}s old).`,
            );
            return;
          }
          setError("Sign in to load the protected aurora map feed.");
          setMap(null);
          return;
        }
        const json = await fetchAuroraMapContract();
        if (!mounted) {
          return;
        }
        setMap(json);
        setError(null);
        void writeOfflineCache<AuroraMapResponse>(CACHE_KEY, json, CACHE_TTL_MS);
      } catch (err) {
        if (!mounted) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to fetch aurora map";
        const cached = await readOfflineCache<AuroraMapResponse>(CACHE_KEY);
        if (cached?.data) {
          setMap(cached.data);
          setError(
            `${message}. Using cached aurora map (${Math.max(
              0,
              Math.round((Date.now() - cached.cachedAt) / 1000),
            )}s old).`,
          );
          return;
        }
        setError(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    let timer: number | null = null;
    const run = async () => {
      await fetchMap();
      if (!mounted) {
        return;
      }
      timer = window.setTimeout(run, getAdaptivePollInterval(POLL_INTERVAL_MS));
    };
    void run();

    return () => {
      mounted = false;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled]);

  return { map, loading, error };
}
