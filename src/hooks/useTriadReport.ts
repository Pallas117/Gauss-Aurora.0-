/**
 * Runs the Triad pipeline (Surya → DeepSeek) and exposes the report for UI.
 * POST /api/ops/pipeline/triad with sourcePath; parse and return surya, deepseek, summary.
 */

import { useCallback, useState } from "react";
import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";

const BASE_URL = getApiBaseUrl();

export interface TriadReport {
  timestamp: string;
  surya: {
    worker: string;
    model: string;
    forecast: Array<{ time: string; value: number }>;
    source_path?: string;
    source_size_bytes?: number;
    stub?: boolean;
  };
  deepseek: {
    worker: string;
    recommendation: string;
    reasoning?: string;
    stub?: boolean;
  };
  summary: string;
}

export interface UseTriadReportState {
  report: TriadReport | null;
  loading: boolean;
  error: string | null;
}

export function useTriadReport() {
  const [state, setState] = useState<UseTriadReportState>({
    report: null,
    loading: false,
    error: null,
  });

  const fetchLatest = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE_URL}/api/ops/pipeline/triad/latest`, { headers });
      const json = (await res.json()) as TriadReport & { error?: string };
      if (!res.ok) {
        setState((s) => ({ ...s, loading: false, error: json?.error ?? "No report", report: null }));
        return null;
      }
      const report: TriadReport = {
        timestamp: json.timestamp ?? new Date().toISOString(),
        surya: json.surya ?? { worker: "surya", model: "surya.366m.v1", forecast: [] },
        deepseek: json.deepseek ?? { worker: "deepseek", recommendation: "", stub: true },
        summary: json.summary ?? json.deepseek?.recommendation ?? "",
      };
      setState((s) => ({ ...s, loading: false, error: null, report }));
      return report;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch latest Triad report";
      setState((s) => ({ ...s, loading: false, error: message, report: null }));
      return null;
    }
  }, []);

  const runTriad = useCallback(async (sourcePath: string) => {
    if (!sourcePath.trim()) {
      setState((s) => ({ ...s, error: "sourcePath is required" }));
      return null;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BASE_URL}/api/ops/pipeline/triad`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ sourcePath: sourcePath.trim() }),
      });
      const json = (await res.json()) as TriadReport & { error?: string; detail?: string };
      if (!res.ok) {
        const message = json?.error ?? json?.detail ?? `${res.status} ${res.statusText}`;
        setState((s) => ({ ...s, loading: false, error: message, report: null }));
        return null;
      }
      const report: TriadReport = {
        timestamp: json.timestamp ?? new Date().toISOString(),
        surya: json.surya ?? { worker: "surya", model: "surya.366m.v1", forecast: [] },
        deepseek: json.deepseek ?? { worker: "deepseek", recommendation: "", stub: true },
        summary: json.summary ?? json.deepseek?.recommendation ?? "",
      };
      setState((s) => ({ ...s, loading: false, error: null, report }));
      return report;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Triad pipeline failed";
      setState((s) => ({ ...s, loading: false, error: message, report: null }));
      return null;
    }
  }, []);

  return { ...state, runTriad, fetchLatest };
}
