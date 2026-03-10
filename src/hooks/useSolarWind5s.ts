import { useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalSpaceWeatherPoint } from "@/lib/types/space-weather";
import { getAccessToken } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";
import {
  fetchSpaceWeather5s,
  fetchSpaceWeatherLatest,
} from "@/lib/api/heliophysics-proxy";
import { readOfflineCache, writeOfflineCache } from "@/lib/offline/offline-cache";
import {
  appendTrendSample,
  getAdaptivePollInterval,
  getTrendAwarePollInterval,
  type TrendSample,
} from "@/lib/power/polling";

const POLL_INTERVAL_MS = 5000;
const CACHE_KEY = "feed:space-weather-5s:PT24H:17280";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HISTORY_LOOKBACK = "PT2H";
const HISTORY_LIMIT = 1440;
const MAX_POINTS = 2048;
const CACHE_WRITE_INTERVAL_MS = 60 * 1000;
const OFFLINE_POLL_INTERVAL_MS = 30_000;
const WS_HEALTH_POLL_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

function extractSolarWindTrendMetric(point: CanonicalSpaceWeatherPoint): number {
  return (
    point.solarWind.speed * 0.01 +
    point.solarWind.density * 0.75 +
    Math.abs(point.magneticField.z) * 3 +
    point.indices.kp * 6 +
    point.coupling.newell * 0.0005
  );
}

function seedSolarWindTrendSamples(points: CanonicalSpaceWeatherPoint[]): TrendSample[] {
  return points.slice(-8).reduce<TrendSample[]>((samples, point) => {
    const timestampMs = Date.parse(point.timestamp);
    const metric = extractSolarWindTrendMetric(point);
    if (!Number.isFinite(timestampMs) || !Number.isFinite(metric)) {
      return samples;
    }
    return appendTrendSample(samples, { timestampMs, value: metric });
  }, []);
}

function getBaseUrl(): string {
  return getApiBaseUrl();
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
  const failureCountRef = useRef(0);
  const trendSamplesRef = useRef<TrendSample[]>([]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      setPoints([]);
      pointsRef.current = [];
      trendSamplesRef.current = [];
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

    const fetchFeed = async (): Promise<"ok" | "auth" | "offline" | "error"> => {
      try {
        const token = await getAccessToken();
        if (!token) {
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          if (!mounted) {
            return "error";
          }
          const cached = await readOfflineCache<CanonicalSpaceWeatherPoint[]>(CACHE_KEY);
          if (cached?.data && cached.data.length > 0 && offline) {
            setPoints(cached.data);
            pointsRef.current = cached.data;
            trendSamplesRef.current = seedSolarWindTrendSamples(cached.data);
            setError(
              `Offline mode: using cached protected 5s heliophysics feed (${Math.max(
                0,
                Math.round((Date.now() - cached.cachedAt) / 1000),
              )}s old).`,
            );
            return "offline";
          }
          setError("Sign in to load the protected 5s heliophysics feed.");
          setPoints([]);
          pointsRef.current = [];
          return "auth";
        }
        if (pointsRef.current.length === 0) {
          const history = trimPoints(await fetchSpaceWeather5s(HISTORY_LOOKBACK, HISTORY_LIMIT));
          if (!mounted) {
            return "error";
          }
          setPoints(history);
          pointsRef.current = history;
          trendSamplesRef.current = seedSolarWindTrendSamples(history);
          maybeWriteCache(history);
        } else {
          const latestPoint = await fetchSpaceWeatherLatest();
          if (!mounted) {
            return "error";
          }
          setPoints((prev) => {
            const merged = mergePoint(prev, latestPoint);
            pointsRef.current = merged;
            const timestampMs = Date.parse(latestPoint.timestamp);
            const metric = extractSolarWindTrendMetric(latestPoint);
            if (Number.isFinite(timestampMs) && Number.isFinite(metric)) {
              trendSamplesRef.current = appendTrendSample(
                trendSamplesRef.current,
                { timestampMs, value: metric },
              );
            }
            maybeWriteCache(merged);
            return merged;
          });
        }
        failureCountRef.current = 0;
        setError(null);
        return "ok";
      } catch (err) {
        if (!mounted) {
          return "error";
        }
        failureCountRef.current += 1;
        const message = err instanceof Error ? err.message : "Failed to fetch feed";
        const cached = await readOfflineCache<CanonicalSpaceWeatherPoint[]>(CACHE_KEY);
        if (cached?.data && cached.data.length > 0) {
          setPoints(cached.data);
          pointsRef.current = cached.data;
          trendSamplesRef.current = seedSolarWindTrendSamples(cached.data);
          setError(
            `${message}. Using cached 5s heliophysics feed (${Math.max(
              0,
              Math.round((Date.now() - cached.cachedAt) / 1000),
            )}s old).`,
          );
          return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error";
        }
        setError(message);
        return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error";
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    let timer: number | null = null;
    const nextPollDelayMs = (status: "ok" | "auth" | "offline" | "error"): number => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        return getAdaptivePollInterval(WS_HEALTH_POLL_INTERVAL_MS);
      }
      if (status === "ok") {
        return getTrendAwarePollInterval(POLL_INTERVAL_MS, trendSamplesRef.current, {
          maxMultiplier: 3.5,
        });
      }
      if (status === "offline") {
        return getAdaptivePollInterval(OFFLINE_POLL_INTERVAL_MS);
      }
      if (status === "auth") {
        return getAdaptivePollInterval(Math.max(POLL_INTERVAL_MS, OFFLINE_POLL_INTERVAL_MS));
      }
      const exp = Math.min(failureCountRef.current, 4);
      return getAdaptivePollInterval(Math.min(POLL_INTERVAL_MS * 2 ** exp, MAX_BACKOFF_MS));
    };

    const run = async () => {
      const status = await fetchFeed();
      if (!mounted) {
        return;
      }
      timer = window.setTimeout(run, nextPollDelayMs(status));
    };
    void run();

    const handleOnline = () => {
      if (!mounted) {
        return;
      }
      if (timer != null) {
        window.clearTimeout(timer);
      }
      failureCountRef.current = 0;
      void run();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
    }

    return () => {
      mounted = false;
      if (timer != null) {
        window.clearTimeout(timer);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
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
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = (baseDelayMs = 3_000) => {
      if (cancelled) {
        return;
      }
      clearReconnectTimer();
      const cappedBase = Math.min(baseDelayMs * 2 ** Math.min(reconnectAttempts, 4), 30_000);
      reconnectTimer = window.setTimeout(() => {
        reconnectAttempts += 1;
        void connect();
      }, getAdaptivePollInterval(cappedBase));
    };

    const connect = async () => {
      if (cancelled) {
        return;
      }
      const base = getBaseUrl().replace(/^http/i, "ws");
      const token = await getAccessToken();
      if (!token || cancelled) {
        setSource("polling");
        scheduleReconnect(5_000);
        return;
      }
      const wsUrl = `${base}/ws/feed/space-weather?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts = 0;
        clearReconnectTimer();
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
            const timestampMs = Date.parse(message.payload.timestamp);
            const metric = extractSolarWindTrendMetric(message.payload);
            if (Number.isFinite(timestampMs) && Number.isFinite(metric)) {
              trendSamplesRef.current = appendTrendSample(
                trendSamplesRef.current,
                { timestampMs, value: metric },
              );
            }
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
        if (!cancelled) {
          scheduleReconnect(3_000);
        }
      };
    };

    const handleOnline = () => {
      reconnectAttempts = 0;
      if (ws && ws.readyState === WebSocket.OPEN) {
        return;
      }
      scheduleReconnect(1_000);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
    }
    void connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
      }
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
