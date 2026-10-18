import { useEffect, useMemo, useState } from "react";
import { getViteEnv } from "@/lib/heliophysics-utils";

export type PowerProfile = "performance" | "balanced" | "low-power";
export type PowerProfileMode = PowerProfile | "auto";

const DEFAULT_MODE: PowerProfileMode = "auto";

function normalizeMode(value: string | undefined | null): PowerProfileMode {
  if (!value) return DEFAULT_MODE;
  const normalized = value.trim().toLowerCase();
  if (normalized === "performance" || normalized === "balanced" || normalized === "low-power") {
    return normalized;
  }
  if (normalized === "low" || normalized === "lowpower" || normalized === "power-saver") {
    return "low-power";
  }
  return "auto";
}

function detectConstraintSignals(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const hidden = document.visibilityState !== "visible";
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };

  const saveData = nav.connection?.saveData === true;
  const lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
  const lowCpu = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;

  return hidden || reducedMotion || saveData || lowMemory || lowCpu;
}

export function usePowerProfile(mode?: PowerProfileMode) {
  const [constraintSignals, setConstraintSignals] = useState(() => detectConstraintSignals());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const update = () => {
      setConstraintSignals(detectConstraintSignals());
    };

    document.addEventListener("visibilitychange", update);

    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    media?.addEventListener?.("change", update);

    const nav = navigator as Navigator & {
      connection?: {
        addEventListener?: (type: "change", listener: () => void) => void;
        removeEventListener?: (type: "change", listener: () => void) => void;
      };
    };
    nav.connection?.addEventListener?.("change", update);

    return () => {
      document.removeEventListener("visibilitychange", update);
      media?.removeEventListener?.("change", update);
      nav.connection?.removeEventListener?.("change", update);
    };
  }, []);

  const configuredMode = useMemo(() => {
    const envMode = normalizeMode(getViteEnv("VITE_POWER_PROFILE"));
    const requested = normalizeMode(mode);
    return requested !== "auto" ? requested : envMode;
  }, [mode]);

  const profile: PowerProfile = useMemo(() => {
    if (configuredMode === "performance" || configuredMode === "balanced" || configuredMode === "low-power") {
      return configuredMode;
    }
    return constraintSignals ? "low-power" : "balanced";
  }, [configuredMode, constraintSignals]);

  return {
    profile,
    isLowPower: profile === "low-power",
    isConstraintDetected: constraintSignals,
  };
}
