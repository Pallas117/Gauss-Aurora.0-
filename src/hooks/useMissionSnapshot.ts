import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchAuthSession, fetchDashboardLatest } from "@/lib/api/heliophysics-proxy";
import { readOfflineCache, writeOfflineCache } from "@/lib/offline/offline-cache";
import {
  appendTrendSample,
  getAdaptivePollInterval,
  getTrendAwarePollInterval,
  type TrendSample,
} from "@/lib/power/polling";
import type { AuthSessionState, DashboardLatestResponse } from "@/lib/types/space-weather";

const BASE_POLL_INTERVAL_MS = 5000;
const BASE_SESSION_REFRESH_MS = 15000;
const SESSION_CACHE_KEY = "mission:auth-session";
const SNAPSHOT_CACHE_KEY = "mission:dashboard-latest";
const SESSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_CACHE_TTL_MS = 45 * 60 * 1000;

function extractDashboardTrendMetric(snapshot: DashboardLatestResponse): number {
  const canonical = snapshot.canonicalLatest;
  const topThreat = snapshot.threatSummary.summary.top_threat_score;
  const reconnectionProbability = snapshot.mmsLatest?.probability?.reconnection ?? 0;

  return (
    canonical.solarWind.speed * 0.01 +
    canonical.indices.kp * 6 +
    Math.abs(canonical.magneticField.z) * 3 +
    topThreat * 0.2 +
    reconnectionProbability * 20
  );
}

function resolvePollIntervalMs(samples: TrendSample[]): number {
  return getTrendAwarePollInterval(BASE_POLL_INTERVAL_MS, samples, { maxMultiplier: 3.25 });
}

function resolveSessionRefreshMs(): number {
  return getAdaptivePollInterval(BASE_SESSION_REFRESH_MS);
}

const DEFAULT_SESSION: AuthSessionState = {
  authRequired: true,
  authenticated: false,
  role: null,
  clearance: null,
  userId: null,
  email: null,
  emailVerified: false,
};

function isAuthError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("sign in required") ||
    normalized.includes("insufficient role") ||
    normalized.includes("unauthorized")
  );
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine;
}

function formatCacheAge(cachedAt: number): string {
  const ageSeconds = Math.max(0, Math.round((Date.now() - cachedAt) / 1000));
  if (ageSeconds < 60) {
    return `${ageSeconds}s`;
  }
  const mins = Math.round(ageSeconds / 60);
  return `${mins}m`;
}

export interface MissionSnapshotState {
  session: AuthSessionState | null;
  snapshot: DashboardLatestResponse | null;
  loading: boolean;
  error: string | null;
  pollingPaused: boolean;
  usingCachedData: boolean;
  cachedAt: number | null;
  lastSuccessfulSyncAt: number | null;
  refresh: () => Promise<void>;
  refreshSession: () => Promise<AuthSessionState>;
}

interface UseMissionSnapshotControllerOptions {
  enabled?: boolean;
}

function useMissionSnapshotController(
  options: UseMissionSnapshotControllerOptions = {},
): MissionSnapshotState {
  const { enabled = true } = options;
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardLatestResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<number | null>(null);
  const sessionRef = useRef<AuthSessionState | null>(null);
  const lastSuccessfulSyncRef = useRef<number | null>(null);
  const trendSamplesRef = useRef<TrendSample[]>([]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    lastSuccessfulSyncRef.current = lastSuccessfulSyncAt;
  }, [lastSuccessfulSyncAt]);

  const loadCachedSnapshot = useCallback(
    async (fallbackReason?: string): Promise<boolean> => {
      const cached = await readOfflineCache<DashboardLatestResponse>(SNAPSHOT_CACHE_KEY);
      if (!cached) {
        return false;
      }
      setSnapshot(cached.data);
      setUsingCachedData(true);
      setCachedAt(cached.cachedAt);
      const timestampMs = Date.parse(cached.data.timestamp);
      const metric = extractDashboardTrendMetric(cached.data);
      if (Number.isFinite(timestampMs) && Number.isFinite(metric)) {
        trendSamplesRef.current = appendTrendSample(trendSamplesRef.current, {
          timestampMs,
          value: metric,
        });
      }
      if (lastSuccessfulSyncRef.current == null) {
        setLastSuccessfulSyncAt(cached.cachedAt);
        lastSuccessfulSyncRef.current = cached.cachedAt;
      }
      const age = formatCacheAge(cached.cachedAt);
      setError(
        fallbackReason
          ? `${fallbackReason} Showing cached mission snapshot (${age} old).`
          : `Using cached mission snapshot (${age} old).`,
      );
      return true;
    },
    [],
  );

  const refreshSession = useCallback(async (): Promise<AuthSessionState> => {
    if (!enabled) {
      return sessionRef.current ?? DEFAULT_SESSION;
    }
    try {
      const nextSession = await fetchAuthSession();
      setSession(nextSession);
      sessionRef.current = nextSession;
      void writeOfflineCache<AuthSessionState>(SESSION_CACHE_KEY, nextSession, SESSION_CACHE_TTL_MS);
      if (!nextSession.authRequired || nextSession.authenticated) {
        setPollingPaused(false);
      }
      return nextSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch auth session";
      const cachedSession = await readOfflineCache<AuthSessionState>(SESSION_CACHE_KEY);
      const fallback = cachedSession?.data ?? sessionRef.current ?? DEFAULT_SESSION;
      setSession(fallback);
      sessionRef.current = fallback;
      setError(message);
      return fallback;
    }
  }, [enabled]);

  const refresh = useCallback(async (sessionOverride?: AuthSessionState) => {
    if (!enabled) {
      return;
    }
    const currentSession = sessionOverride ?? sessionRef.current ?? DEFAULT_SESSION;

    if (!isOnline()) {
      const usedCached = await loadCachedSnapshot(
        currentSession.authRequired && !currentSession.authenticated
          ? "Offline and unauthenticated in protected mode."
          : "Offline. Using cached mission data for resilience.",
      );
      if (usedCached) {
        setPollingPaused(true);
        setLoading(false);
        return;
      }
    }

    if (currentSession.authRequired && !currentSession.authenticated) {
      setPollingPaused(true);
      setLoading(false);
      setError("Sign in required to view protected heliophysics feeds.");
      return;
    }

    try {
      const latest = await fetchDashboardLatest();
      setSnapshot(latest);
      setUsingCachedData(false);
      setCachedAt(null);
      const timestampMs = Date.parse(latest.timestamp);
      const metric = extractDashboardTrendMetric(latest);
      if (Number.isFinite(timestampMs) && Number.isFinite(metric)) {
        trendSamplesRef.current = appendTrendSample(trendSamplesRef.current, {
          timestampMs,
          value: metric,
        });
      }
      const syncedAt = Date.now();
      setLastSuccessfulSyncAt(syncedAt);
      lastSuccessfulSyncRef.current = syncedAt;
      void writeOfflineCache<DashboardLatestResponse>(
        SNAPSHOT_CACHE_KEY,
        latest,
        SNAPSHOT_CACHE_TTL_MS,
      );
      setError(null);
      setPollingPaused(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch mission snapshot";
      const usedCached = await loadCachedSnapshot(message);
      if (!usedCached) {
        setError(message);
      }
      if (isAuthError(message)) {
        setPollingPaused(true);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, loadCachedSnapshot]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let mounted = true;

    const boot = async () => {
      const [cachedSession, cachedSnapshot] = await Promise.all([
        readOfflineCache<AuthSessionState>(SESSION_CACHE_KEY),
        readOfflineCache<DashboardLatestResponse>(SNAPSHOT_CACHE_KEY),
      ]);
      if (!mounted) {
        return;
      }
      if (cachedSession?.data) {
        setSession(cachedSession.data);
        sessionRef.current = cachedSession.data;
      }
      if (cachedSnapshot?.data) {
        setSnapshot(cachedSnapshot.data);
        setUsingCachedData(true);
        setCachedAt(cachedSnapshot.cachedAt);
        setLastSuccessfulSyncAt(cachedSnapshot.cachedAt);
        lastSuccessfulSyncRef.current = cachedSnapshot.cachedAt;
        const timestampMs = Date.parse(cachedSnapshot.data.timestamp);
        const metric = extractDashboardTrendMetric(cachedSnapshot.data);
        if (Number.isFinite(timestampMs) && Number.isFinite(metric)) {
          trendSamplesRef.current = appendTrendSample(trendSamplesRef.current, {
            timestampMs,
            value: metric,
          });
        }
      }

      const nextSession = await refreshSession();
      if (!mounted) {
        return;
      }
      await refresh(nextSession);
    };

    void boot();

    let sessionTimer: number | null = null;
    const scheduleSessionRefresh = () => {
      if (!mounted) {
        return;
      }
      sessionTimer = window.setTimeout(() => {
        void refreshSession().finally(scheduleSessionRefresh);
      }, resolveSessionRefreshMs());
    };
    scheduleSessionRefresh();

    return () => {
      mounted = false;
      if (sessionTimer) {
        window.clearTimeout(sessionTimer);
      }
    };
  }, [enabled, refresh, refreshSession]);

  const canPoll = useMemo(() => {
    if (!enabled) {
      return false;
    }
    const current = session ?? DEFAULT_SESSION;
    return !pollingPaused && (!current.authRequired || current.authenticated);
  }, [enabled, pollingPaused, session]);

  useEffect(() => {
    if (!canPoll) {
      return;
    }

    let active = true;
    let timer: number | null = null;

    const runPoll = async () => {
      if (!active) {
        return;
      }
      await refresh();
      if (!active) {
        return;
      }
      timer = window.setTimeout(runPoll, resolvePollIntervalMs(trendSamplesRef.current));
    };

    void runPoll();

    return () => {
      active = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [canPoll, refresh]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const handleOnline = () => {
      void refreshSession().then((nextSession) => refresh(nextSession));
    };

    const handleOffline = () => {
      void refresh(sessionRef.current ?? DEFAULT_SESSION);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [enabled, refresh, refreshSession]);

  return {
    session,
    snapshot,
    loading,
    error,
    pollingPaused,
    usingCachedData,
    cachedAt,
    lastSuccessfulSyncAt,
    refresh,
    refreshSession,
  };
}

const MissionSnapshotContext = createContext<MissionSnapshotState | null>(null);

export function MissionSnapshotProvider({ children }: { children: ReactNode }) {
  const value = useMissionSnapshotController({ enabled: true });
  return createElement(MissionSnapshotContext.Provider, { value }, children);
}

export function useMissionSnapshot(): MissionSnapshotState {
  const context = useContext(MissionSnapshotContext);
  const fallback = useMissionSnapshotController({ enabled: context == null });
  return context ?? fallback;
}
