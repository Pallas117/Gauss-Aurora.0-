import { useCallback, useEffect, useState } from "react";
import {
  fetchTuringDevices,
  fetchTuringDevicesSummary,
} from "@/lib/api/turing";
import type {
  TuringDevice,
  TuringDevicesResponse,
  TuringDevicesSummaryResponse,
} from "@/lib/contracts/turing";
import { getAdaptivePollInterval } from "@/lib/power/polling";

const POLL_INTERVAL_MS = 15_000;

export interface UseTuringDevicesResult {
  devices: TuringDevice[];
  summary: TuringDevicesSummaryResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTuringDevices(): UseTuringDevicesResult {
  const [devices, setDevices] = useState<TuringDevice[]>([]);
  const [summary, setSummary] = useState<TuringDevicesSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [devicesRes, summaryRes] = await Promise.all([
        fetchTuringDevices(),
        fetchTuringDevicesSummary(),
      ]);
      setDevices(devicesRes.devices);
      setSummary(summaryRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Turing devices");
      setDevices([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void refresh().then(() => {
        if (cancelled) return;
        const nextMs = getAdaptivePollInterval(POLL_INTERVAL_MS);
        timeoutRef.current = window.setTimeout(run, nextMs);
      });
    };
    const timeoutRef = { current: undefined as number | ReturnType<typeof setTimeout> | undefined };
    run();
    return () => {
      cancelled = true;
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, [refresh]);

  return { devices, summary, loading, error, refresh };
}

const SUMMARY_POLL_MS = 30_000;

export function useTuringSummary(): {
  summary: TuringDevicesSummaryResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [summary, setSummary] = useState<TuringDevicesSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchTuringDevicesSummary();
      setSummary(res);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void refresh().then(() => {
        if (cancelled) return;
        const nextMs = getAdaptivePollInterval(SUMMARY_POLL_MS);
        timeoutRef.current = window.setTimeout(run, nextMs);
      });
    };
    const timeoutRef = { current: undefined as number | ReturnType<typeof setTimeout> | undefined };
    run();
    return () => {
      cancelled = true;
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, [refresh]);

  return { summary, loading, refresh };
}
