import { useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalSpaceWeatherPoint } from "@/lib/types/space-weather";
import { getAccessToken } from "@/lib/api/auth";
import {
  fetchSpaceWeather5s,
  fetchSpaceWeatherLatest,
} from "@/lib/api/heliophysics-proxy";
import { readOfflineCache, writeOfflineCache } from "@/lib/offline/offline-cache";
import { getAdaptivePollInterval } from "@/lib/power/polling";

const POLL_INTERVAL_MS = 5000;
const CACHE_KEY = "feed:space-weather-5s:PT24H:17280";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HISTORY_LOOKBACK = "PT2H";
const HISTORY_LIMIT = 1440;
const MAX_POINTS = 2048;
const CACHE_WRITE_INTERVAL_MS = 60 * 1000;

function getBaseUrl(): string {
  return (typeof import_meta !== 'undefined' ? import_meta?.env?.VITE_HELIO_PROXY_URL : typeof process !== 'undefined' ? process.env?.VITE_HELIO_PROXY_URL : undefined) ?? "http://localhost:3001";
}

export interface SolarWind5sState {
  points: CanonicalSpaceWeatherPoint[];
  latest: CanonicalSpaceWeatherPoint | null;
  loading: boolean;
  error: string | null;
  source: "polling" | "websocket";
}

interface UseSolarWind5sOptions {
  enabled?: boolean;
}

function trimPoints(points: CanonicalSpaceWeatherPoint[]): CanonicalSpaceWeatherPoint[] {
  if (points.length <= MAX_POINTS) {
    return points;
  }
  return points.slice(points.length - MAX_POINTS);
}

function mergePoint(
  previous: CanonicalSpaceWeatherPoint[],
  incoming: CanonicalSpaceWeatherPoint,
): CanonicalSpaceWeatherPoint[] {
  if (previous.length === 0) {
    return [incoming];
  }

  const nextTs = Date.parse(incoming.timestamp);
  if (!Number.isFinite(nextTs)) {
    return previous;
  }

  const lastTs = Date.parse(previous[previous.length - 1]!.timestamp);
  if (Number.isFinite(lastTs) && nextTs > lastTs) {
    return trimPoints([...previous, incoming]);
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

  // Ignore older out-of-order packets to keep merge cost bounded on constrained hardware.
  return previous;
}

export function useSolarWind5s(options: UseSolarWind5sOptions = {}): SolarWind5sState {
  const { enabled = true } = options;
  const [points, setPoints] = useState<CanonicalSpaceWeatherPoint[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"polling" | "websocket">("polling");
  const wsRef = useRef<WebSocket | null>(null);
  const pointsRef = useRef<CanonicalSpaceWeatherPoint[]>([]);
  const lastCacheWriteRef = useRef(0);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      setPoints([]);
      pointsRef.current = [];
      setSource("polling");
      return;
    }

    let mounted = true;

    const maybeWriteCache = (nextPoints: CanonicalSpaceWeatherPoint[]) => {
      const now = Date.now();
      if (now - lastCacheWriteRef.current < CACHE_WRITE_INTERVAL_MS) {
        return;
      }
      lastCacheWriteRef.current = now;
      void writeOfflineCache<CanonicalSpaceWeatherPoint[]>(CACHE_KEY, nextPoints, CACHE_TTL_MS);
    };

    const fetchFeed = async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!mounted) {
            return;
          }
          const cached = await readOfflineCache<CanonicalSpaceWeatherPoint[]>(CACHE_KEY);
          if (cached?.data && cached.data.length > 0 && navigator.onLine === false) {
            setPoints(cached.data);
            pointsRef.current = cached.data;
            setError(
              `Offline mode: using cached protected 5s heliophysics feed (${Math.max(
                0,
                Math.round((Date.now() - cached.cachedAt) / 1000),
              )}s old).`,
            );
            return;
          }
          setError("Sign in to load the protected 5s heliophysics feed.");
          setPoints([]);
          pointsRef.current = [];
          return;
        }
        if (pointsRef.current.length === 0) {
          const history = trimPoints(await fetchSpaceWeather5s(HISTORY_LOOKBACK, HISTORY_LIMIT));
          if (!mounted) {
            return;
          }
          setPoints(history);
          pointsRef.current = history;
          maybeWriteCache(history);
        } else {
          const latestPoint = await fetchSpaceWeatherLatest();
          if (!mounted) {
            return;
          }
          setPoints((prev) => {
            const merged = mergePoint(prev, latestPoint);
            pointsRef.current = merged;
            maybeWriteCache(merged);
            return merged;
          });
        }
        setError(null);
      } catch (err) {
        if (!mounted) {
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to fetch feed";
        const cached = await readOfflineCache<CanonicalSpaceWeatherPoint[]>(CACHE_KEY);
        if (cached?.data && cached.data.length > 0) {
          setPoints(cached.data);
          pointsRef.current = cached.data;
          setError(
            `${message}. Using cached 5s heliophysics feed (${Math.max(
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
      await fetchFeed();
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

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const wsEnabled = String((typeof import_meta !== 'undefined' ? import_meta?.env?.VITE_HELIO_WS_ENABLED : typeof process !== 'undefined' ? process.env?.VITE_HELIO_WS_ENABLED : undefined) ?? "false") === "true";
    if (!wsEnabled) {
      return;
    }

    let ws: WebSocket | null = null;
    let cancelled = false;

    const connect = async () => {
      const base = getBaseUrl().replace(/^http/i, "ws");
      const token = await getAccessToken();
      if (!token || cancelled) {
        setSource("polling");
        return;
      }
      const wsUrl = `${base}/ws/feed/space-weather?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setSource("websocket");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            topic?: string;
            payload?: CanonicalSpaceWeatherPoint;
          };
          if (message.topic !== "space-weather" || !message.payload) {
            return;
          }
          setPoints((prev) => {
            const merged = mergePoint(prev, message.payload);
            pointsRef.current = merged;
            return merged;
          });
        } catch {
          // Ignore malformed websocket payloads.
        }
      };

      ws.onerror = () => {
        setSource("polling");
      };

      ws.onclose = () => {
        setSource("polling");
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (ws) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [enabled]);

  const latest = useMemo(
    () => (points.length > 0 ? points[points.length - 1] : null),
    [points],
  );

  return {
    points,
    latest,
    loading,
    error,
    source,
  };
}
