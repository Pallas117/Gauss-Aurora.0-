import type { CanonicalSpaceWeatherPoint, AuthClearance } from "@/lib/types/space-weather";
import type { VisualizationPoint, OrbitType } from "@/lib/types/radiation";
import { withVisualizationPriority } from "@/lib/visual-priority";

export interface NowcastPredictionPoint {
    timestamp: string;
    geomagneticPerturbation: number;
    auroraIntensity: number;
    confidence: number;
}

export interface NowcastInferencePayload {
    modelVersion: string;
    generatedAt: string;
    horizonMinutes: number;
    predictions: NowcastPredictionPoint[];
}

export const NOWCAST_ENERGY_RANGE = { min: 0.2, max: 15 };

export function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

export function asFinite(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

export function parseNowcastPredictionPoint(value: unknown): NowcastPredictionPoint | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : null;
    const geomagneticPerturbation = asFinite(record.geomagneticPerturbation);
    const auroraIntensity = asFinite(record.auroraIntensity);
    const confidence = asFinite(record.confidence);
    if (!timestamp || geomagneticPerturbation == null || auroraIntensity == null || confidence == null) {
        return null;
    }
    return {
        timestamp,
        geomagneticPerturbation,
        auroraIntensity,
        confidence,
    };
}

export function parseNowcastInferencePayload(value: unknown): NowcastInferencePayload | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const modelVersion = typeof record.modelVersion === "string" ? record.modelVersion : null;
    const generatedAt = typeof record.generatedAt === "string" ? record.generatedAt : null;
    const horizonMinutes = asFinite(record.horizonMinutes);
    const predictionsRaw = Array.isArray(record.predictions) ? record.predictions : null;
    if (!modelVersion || !generatedAt || horizonMinutes == null || !predictionsRaw) {
        return null;
    }
    const predictions = predictionsRaw
        .map(parseNowcastPredictionPoint)
        .filter((point): point is NowcastPredictionPoint => point != null);

    return {
        modelVersion,
        generatedAt,
        horizonMinutes,
        predictions,
    };
}

export function nowcastPredictionToCanonicalPoint(
    base: CanonicalSpaceWeatherPoint,
    prediction: NowcastPredictionPoint,
): CanonicalSpaceWeatherPoint {
    const perturb = Math.max(0, prediction.geomagneticPerturbation);
    const kpForecast = Math.max(0, Math.min(9, perturb / 8));
    const bzForecast = Math.max(-20, Math.min(8, -perturb / 6.5));
    const dynamicPressure = Math.max(0.7, Math.min(12, base.solarWind.dynamicPressure + perturb / 48));
    const speed = Math.max(250, Math.min(1200, base.solarWind.speed + perturb * 1.15));
    const density = Math.max(0.2, Math.min(60, base.solarWind.density + clamp01(prediction.auroraIntensity) * 3.6));
    const stormTier =
        kpForecast >= 7 ? "severe" : kpForecast >= 5 ? "warning" : kpForecast >= 4 ? "watch" : "quiet";

    return {
        ...base,
        timestamp: prediction.timestamp,
        solarWind: {
            ...base.solarWind,
            speed,
            density,
            dynamicPressure,
        },
        magneticField: {
            ...base.magneticField,
            z: bzForecast,
            bt: Math.max(Math.abs(bzForecast), base.magneticField.bt),
        },
        indices: {
            ...base.indices,
            kp: kpForecast,
        },
        alerts: {
            stormTier,
            reason: `Nowcast mapped (${prediction.confidence.toFixed(2)} confidence)`,
        },
        quality: {
            ...base.quality,
            extrapolated: true,
        },
        diagnostics: {
            ...base.diagnostics,
            shueR0Re: Math.max(6.2, Math.min(11.5, 11.2 - dynamicPressure * 0.35)),
        },
    };
}

export function nowcastPredictionToVisualizationPoints(
    payload: NowcastInferencePayload | null,
    activeIndex = 0,
): VisualizationPoint[] {
    if (!payload || payload.predictions.length === 0) {
        return [];
    }
    return payload.predictions.slice(0, 12).map((prediction, index) => {
        const perturb = Math.max(0, prediction.geomagneticPerturbation);
        const aurora = clamp01(prediction.auroraIntensity);
        const confidence = clamp01(prediction.confidence);
        const orbitType = (index % 3 === 1 ? "MEO" : index % 3 === 2 ? "GEO" : "LEO") as OrbitType;
        const altitude = orbitType === "LEO" ? 550 : orbitType === "MEO" ? 20200 : 35786;
        const lShell = orbitType === "LEO" ? 1.8 : orbitType === "MEO" ? 3.2 : 6.6;
        const distanceFromActive = Math.abs(index - activeIndex);
        const activeScale = Math.max(0.35, 1 - distanceFromActive * 0.14);

        return withVisualizationPriority({
            timestamp: prediction.timestamp,
            flux: (perturb * 170 + aurora * 8200) * (0.72 + 0.28 * confidence) * activeScale,
            altitude,
            L_shell: lShell,
            orbitType,
            particleType: "electron" as const,
            energyRange: NOWCAST_ENERGY_RANGE,
        });
    });
}

export function formatDelay(seconds: number | undefined): string {
    if (!seconds || seconds <= 0) return "n/a";
    const mins = Math.round(seconds / 60);
    return `${mins} min`;
}

export function formatCadenceLabel(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms) || ms <= 0) {
        return "suspended";
    }
    if (ms >= 60_000 && ms % 60_000 === 0) {
        return `${Math.round(ms / 60_000)}m`;
    }
    if (ms >= 1000 && ms % 1000 === 0) {
        return `${Math.round(ms / 1000)}s`;
    }
    return `${Math.round(ms)}ms`;
}

export function formatMetric(value: number | null | undefined, digits = 1): string {
    if (value == null || !Number.isFinite(value)) {
        return "n/a";
    }
    return value.toFixed(digits);
}

export function sourceDecisionVariant(
    decision: "primary" | "validate" | "sample" | "suspend" | undefined,
    healthy: boolean,
): "secondary" | "destructive" | "outline" {
    if (decision === "suspend") {
        return "destructive";
    }
    if (decision === "primary" && healthy) {
        return "secondary";
    }
    return "outline";
}

export function hasMissionClearance(clearance: AuthClearance | null | undefined): boolean {
    return clearance === "mission" || clearance === "restricted";
}

export function getViteEnv(key: string): string | undefined {
    try {
        const reader = Function(
            "envKey",
            "try { return import.meta?.env?.[envKey]; } catch { return undefined; }",
        ) as (envKey: string) => unknown;
        const value = reader(key);
        if (typeof value === "string") {
            return value;
        }
    } catch {
        // ignore; fall through to process env fallback
    }
    if (typeof process === "undefined") {
        return undefined;
    }
    const value = process.env?.[key];
    return typeof value === "string" ? value : undefined;
}
