/**
 * Fetches Surya forecast from backend. Stub returns 501 with documented shape.
 * See docs/SURYA_INTEGRATION.md. Use behind VITE_FEATURE_SURYA_STUB for stub UI.
 */

import { useCallback, useState } from "react";
import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";
import { fetchWithResilience } from "@/lib/network/resilient-fetch";
import { readOfflineCache, writeOfflineCache } from "@/lib/offline/offline-cache";

export interface SuryaForecastPoint {
  time: string;
  value: number;
}

export interface SuryaForecastResponse {
  forecast: SuryaForecastPoint[];
  model: string;
  horizonHours: number;
}

export interface SuryaForecastState {
  data: SuryaForecastResponse | null;
  isStub: boolean;
  error: string | null;
  loading: boolean;
}

const BASE_URL = getApiBaseUrl();
const CACHE_KEY = "ai:surya:forecast";
const CACHE_TTL_MS = 30 * 60 * 1000;

export function useSuryaForecast() {
  const [state, setState] = useState<SuryaForecastState>({
    data: null,
    isStub: false,
    error: null,
    loading: false,
  });

  const fetchForecast = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetchWithResilience(
        `${BASE_URL}/api/ai/surya/forecast`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await getAuthHeaders()),
          },
          body: JSON.stringify({}),
        },
        {
          scope: "surya forecast",
          timeoutMs: 12_000,
          retries: 2,
        },
      );
      const json = (await res.json()) as SuryaForecastResponse & { error?: string };
      const ok = res.ok || res.status === 501;
      if (ok && typeof json?.model === "string" && typeof json?.horizonHours === "number") {
        const normalized = json as SuryaForecastResponse;
        void writeOfflineCache<SuryaForecastResponse>(CACHE_KEY, normalized, CACHE_TTL_MS);
        setState({
          data: normalized,
          isStub: res.status === 501,
          error: null,
          loading: false,
        });
      } else {
        const message =
          typeof json?.error === "string"
            ? json.error
            : `${res.status} ${res.statusText}`.trim() || "Request failed";
        setState({
          data: null,
          isStub: false,
          error: message,
          loading: false,
        });
      }
    } catch (err) {
      const cached = await readOfflineCache<SuryaForecastResponse>(CACHE_KEY);
      if (cached?.data) {
        setState({
          data: cached.data,
          isStub: false,
          error: `${err instanceof Error ? err.message : "Request failed"}. Using cached Surya forecast (${Math.max(
            0,
            Math.round((Date.now() - cached.cachedAt) / 1000),
          )}s old).`,
          loading: false,
        });
        return;
      }
      setState({
        data: null,
        isStub: false,
        error: err instanceof Error ? err.message : "Request failed",
        loading: false,
      });
    }
  }, []);

  return { ...state, fetchForecast };
}
