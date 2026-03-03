import { useEffect, useMemo, useRef, useState } from "react";
import type { MMSReconVectorPoint } from "@/lib/types/space-weather";
import { getAccessToken } from "@/lib/api/auth";
import {
  fetchMmsReconnection,
  fetchMmsReconnectionLatest,
} from "@/lib/api/heliophysics-proxy";
import { readOfflineCache, writeOfflineCache } from "@/lib/offline/offline-cache";
import { getAdaptivePollInterval } from "@/lib/power/polling";

const POLL_INTERVAL_MS = 5000;
const CACHE_KEY = "feed:mms-reconnection:PT2H:1440";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HISTORY_LOOKBACK = "PT1H";
const HISTORY_LIMIT = 720;
const MAX_VECTORS = 1024;
const CACHE_WRITE_INTERVAL_MS = 60 * 1000;

export type MMSReconnectionSource = "live" | "cache" | "none";

export interface MMSReconnectionState {
  vectors: MMSReconVectorPoint[];
  latest: MMSReconVectorPoint | null;
  loading: boolean;
  error: string | null;
  source: MMSReconnectionSource;
}

interface UseMMSReconnectionOptions {
  enabled?: boolean;
}

function trimVectors(vectors: MMSReconVectorPoint[]): MMSReconVectorPoint[] {
  if (vectors.length <= MAX_VECTORS) {
    return vectors;
  }
  return vectors.slice(vectors.length - MAX_VECTORS);
}

function mergeVector(
  previous: MMSReconVectorPoint[],
  incoming: MMSReconVectorPoint,
): MMSReconVectorPoint[] {
  if (previous.length === 0) {
    return [incoming];
  }

  const nextTs = Date.parse(incoming.timestamp);
  if (!Number.isFinite(nextTs)) {
    return previous;
  }

  const lastTs = Date.parse(previous[previous.length - 1]!.timestamp);
  if (Number.isFinite(lastTs) && nextTs > lastTs) {
    return trimVectors([...previous, incoming]);
  }

  if (Number.isFinite(lastTs) && nextTs === lastTs) {
    const updated = [...previous];
    updated[updated.length - 1] = incoming;
    return updated;
  }

  const existingIndex = previous.findIndex((point) => point.timestamp === incoming.timestamp);
  if (existingIndex >= 0) {
    const updated = [...previous];
    updated[existingIndex] = incoming;
    return updated;
  }

  return previous;
}

export function useMMSReconnection(options: UseMMSReconnectionOptions = {}): MMSReconnectionState {
  const { enabled = true } = options;
  const [vectors, setVectors] = useState<MMSReconVectorPoint[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<MMSReconnectionSource>("none");
  const vectorsRef = useRef<MMSReconVectorPoint[]>([]);
  const lastCacheWriteAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      setVectors([]);
      vectorsRef.current = [];
      setSource("none");
      return;
    }

    let mounted = true;

    const maybeWriteCache = (nextVectors: MMSReconVectorPoint[]) => {
      const now = Date.now();
      if (now - lastCacheWriteAtRef.current < CACHE_WRITE_INTERVAL_MS) {
        return;
      }
      lastCacheWriteAtRef.current = now;
      void writeOfflineCache<MMSReconVectorPoint[]>(CACHE_KEY, nextVectors, CACHE_TTL_MS);
    };

    const fetchVectors = async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!mounted) {
            return;
          }
          const cached = await readOfflineCache<MMSReconVectorPoint[]>(CACHE_KEY);
          if (cached?.data && cached.data.length > 0 && navigator.onLine === false) {
            setVectors(cached.data);
            vectorsRef.current = cached.data;
            setSource("cache");
            setError(
              `Offline mode: using cached MMS reconnection vectors (${Math.max(
                0,
                Math.round((Date.now() - cached.cachedAt) / 1000),
              )}s old).`,
            );
            return;
          }
          setError("Sign in to load protected MMS reconnection vectors.");
          setVectors([]);
          vectorsRef.current = [];
          setSource("none");
          return;
        }
        if (vectorsRef.current.length === 0) {
          const history = trimVectors(await fetchMmsReconnection(HISTORY_LOOKBACK, HISTORY_LIMIT));
          if (!mounted) {
            return;
          }
          setVectors(history);
          vectorsRef.current = history;
          maybeWriteCache(history);
        } else {
          const latestVector = await fetchMmsReconnectionLatest();
          if (!mounted) {
            return;
          }
          setVectors((prev) => {
            const merged = mergeVector(prev, latestVector);
            vectorsRef.current = merged;
            maybeWriteCache(merged);
            return merged;
          });
        }
        setError(null);
        setSource("live");
      } catch (err) {
        if (!mounted) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to fetch MMS vectors";
        const cached = await readOfflineCache<MMSReconVectorPoint[]>(CACHE_KEY);
        if (cached?.data && cached.data.length > 0) {
          setVectors(cached.data);
          vectorsRef.current = cached.data;
          setSource("cache");
          setError(
            `${message}. Using cached MMS reconnection vectors (${Math.max(
              0,
              Math.round((Date.now() - cached.cachedAt) / 1000),
            )}s old).`,
          );
          return;
        }
        setError(message);
        setSource("none");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    let timer: number | null = null;
    const run = async () => {
      await fetchVectors();
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

  return {
    vectors,
    latest: useMemo(
      () => (vectors.length > 0 ? vectors[vectors.length - 1] : null),
      [vectors],
    ),
    loading,
    error,
    source,
  };
}
