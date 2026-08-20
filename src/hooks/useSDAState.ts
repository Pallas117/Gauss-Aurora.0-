import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useMMSReconnection } from "@/hooks/useMMSReconnection";
import { useOpsCommandSnapshot } from "@/hooks/useOpsCommandSnapshot";
import { useSpaceDomainSnapshot } from "@/hooks/useSpaceDomainSnapshot";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { usePowerProfile } from "@/hooks/usePowerProfile";
import { useSuryaForecast } from "@/hooks/useSuryaForecast";
import { useAiContext } from "@/contexts/AiContext";
import { useAgenticEvaluator } from "@/hooks/useAgenticEvaluator";
import { prioritizeVisualizationPoints } from "@/lib/visual-priority";
import type { LayerVisibility } from "@/components/types";
import type { VisualizationPoint } from "@/lib/types/radiation";
import type { SpaceDomainAnalysis, SpaceDomainSummary } from "@/lib/types/space-weather";

const debrisEnvEnabled =
    String(
        (typeof import.meta !== "undefined"
            ? import.meta.env?.VITE_FEATURE_DEBRIS_3D
            : process.env.VITE_FEATURE_DEBRIS_3D) ?? "true",
    ).toLowerCase() !== "false";

function determineFallbackSeverity(summary: SpaceDomainSummary): SpaceDomainAnalysis["severity"] {
    if (
        summary.conjunctionRisk.recentCriticalCount > 0 ||
        (summary.conjunctionRisk.maxCollisionProbability ?? 0) >= 0.01
    ) {
        return "critical";
    }
    if (
        summary.learnedLane.trigger ||
        (summary.conjunctionRisk.maxCollisionProbability ?? 0) >= 0.005
    ) {
        return "warning";
    }
    if (summary.learnedLane.score >= 0.45 || summary.crowding.maxRiskScore >= 0.55) {
        return "watch";
    }
    return "quiet";
}

function formatPercent(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) {
        return "n/a";
    }
    return `${Math.round(value * 100)}%`;
}

function formatMeters(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) {
        return "n/a";
    }
    return `${Math.round(value).toLocaleString()} m`;
}

function buildDeterministicPublicAnalysis(
    summary: SpaceDomainSummary,
    analysis: SpaceDomainAnalysis | null,
    availabilityMode: "live" | "projected" | "warming" = "live",
): SpaceDomainAnalysis {
    const severity = analysis?.severity ?? determineFallbackSeverity(summary);
    const metrics = analysis?.metrics ?? {
        learnedLaneScore: summary.learnedLane.score,
        maxRiskScore: summary.crowding.maxRiskScore,
        maxCollisionProbability: summary.conjunctionRisk.maxCollisionProbability,
        minMissDistanceM: summary.conjunctionRisk.minMissDistanceM,
        conjunctionCount: summary.counts.conjunctionCount,
    };

    const headline =
        availabilityMode === "projected"
            ? "Projected orbital lane active"
            : availabilityMode === "warming"
                ? "Public orbital lane awaiting ingest"
                : severity === "critical"
                    ? "Critical conjunction activity detected"
                    : severity === "warning"
                        ? "Elevated orbital risk requires attention"
                        : severity === "watch"
                            ? "Orbital watch active across the public lane"
                            : "Public orbital lane remains stable";

    const summaryText =
        availabilityMode === "projected"
            ? "Live SSA ingest is stale, so Gauss is serving a clearly labeled projected hold-state from the last trusted orbital snapshot."
            : availabilityMode === "warming"
                ? "Catalog and risk-zone feeds are still warming up. Public SDA remains online while ingest catches up."
                : severity === "critical"
                    ? `Critical conjunction lane active with ${metrics.conjunctionCount} tracked events, peak collision probability ${formatPercent(metrics.maxCollisionProbability)}, and minimum miss distance ${formatMeters(metrics.minMissDistanceM)}.`
                    : severity === "warning"
                        ? `Elevated SSA pressure detected: learned lane ${formatPercent(metrics.learnedLaneScore)}, catalog risk ${formatPercent(metrics.maxRiskScore)}, and ${metrics.conjunctionCount} conjunctions under watch.`
                        : severity === "watch"
                            ? `Crowding and learned-lane drift are above quiet baseline. Catalog risk is ${formatPercent(metrics.maxRiskScore)} with learned SSA score ${formatPercent(metrics.learnedLaneScore)}.`
                            : `No elevated conjunction trigger is active. Catalog risk is ${formatPercent(metrics.maxRiskScore)} and the learned SSA lane remains below the warning threshold.`;

    return {
        generatedAt: analysis?.generatedAt ?? summary.updatedAt ?? new Date().toISOString(),
        cadenceSeconds: analysis?.cadenceSeconds ?? 30,
        source: "deterministic",
        severity,
        headline,
        summary: summaryText,
        confidence: analysis?.confidence ?? summary.learnedLane.confidence,
        changed: analysis?.changed ?? false,
        changedSignals: analysis?.changedSignals ?? [],
        metrics,
        model: {
            used: false,
            modelId: null,
            generatedAt: null,
        },
    };
}

export function useSDAState() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const location = useLocation();
    const presentation = new URLSearchParams(location.search).get("presentation") === "1";

    const mission = useMissionSnapshot();
    const backendHealth = useBackendHealth();
    const canViewProtectedFeeds = mission.session ? !mission.session.authRequired || mission.session.authenticated : false;
    const debrisEnabled = debrisEnvEnabled || (mission.session?.features?.debris ?? false);

    const ops = useOpsCommandSnapshot(canViewProtectedFeeds, backendHealth.memoryLevel);
    const mms = useMMSReconnection({
        enabled: canViewProtectedFeeds && backendHealth.memoryLevel !== "critical",
    });
    const spaceDomain = useSpaceDomainSnapshot({
        enabled: debrisEnabled,
        governorLevel: backendHealth.memoryLevel,
    });
    const riskZones = spaceDomain.riskZones;
    const satelliteData = spaceDomain.satellites;
    const { profile: powerProfile } = usePowerProfile();
    const [compactViewport, setCompactViewport] = useState(false);

    const latest = mission.snapshot?.canonicalLatest ?? ops.data?.canonicalLatest ?? null;
    const vectorOverlay = mission.snapshot?.vectorOverlay ?? null;

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) {
            return;
        }
        const media = window.matchMedia("(max-width: 900px)");
        const onChange = () => {
            setCompactViewport(media.matches);
        };
        onChange();
        media.addEventListener?.("change", onChange);
        return () => {
            media.removeEventListener?.("change", onChange);
        };
    }, []);

    const sceneData = useMemo((): VisualizationPoint[] | undefined => {
        if (!debrisEnabled || riskZones.length === 0) return undefined;
        let zones = riskZones;
        if (powerProfile === "low-power") {
            zones = prioritizeVisualizationPoints(
                zones.filter((r) => r.orbitType === "GEO"),
                25,
            );
        }
        const out = prioritizeVisualizationPoints(zones, 50);
        return out.length > 0 ? out : undefined;
    }, [debrisEnabled, riskZones, powerProfile]);

    const [layers, setLayers] = useState<LayerVisibility>({
        earth: true,
        belts: true,
        magnetosphere: true,
        fieldLines: true,
        mhdWaves: true,
        mmsReconnection: true,
        radiationData: true,
    });

    const { updateVisualState, updateSuryaData, logOperatorAction } = useAiContext();
    const surya = useSuryaForecast();

    // Power the Agentic Context Loop
    useAgenticEvaluator(
        canViewProtectedFeeds &&
            backendHealth.deepseekMode === "auto" &&
            backendHealth.memoryLevel === "nominal",
    );

    // Sync Surya into Context Engine
    useEffect(() => {
        if (!canViewProtectedFeeds) {
            return;
        }
        surya.fetchForecast();
    }, [canViewProtectedFeeds, surya.fetchForecast]);

    useEffect(() => {
        if (surya.data) {
            updateSuryaData(surya.data);
        }
    }, [surya.data, updateSuryaData]);

    // Sync visual layers into Context Engine
    useEffect(() => {
        updateVisualState({ activeLayers: layers });
    }, [layers, updateVisualState]);

    const visual = useMemo(() => {
        const pressure = latest?.solarWind.dynamicPressure ?? 2;
        const bz = latest?.magneticField.z ?? 0;
        const kp = latest?.indices.kp ?? 2;

        const pressureNorm = Math.min(1, pressure / 10);
        const magnetopauseCompression = Math.max(0.6, 1 - pressureNorm * 0.4);
        const beltIntensity = Math.min(1, kp / 9 + 0.2);
        const reconnectionStrength = Math.max(0, Math.min(1, -bz / 15));

        return { magnetopauseCompression, beltIntensity, reconnectionStrength };
    }, [latest]);

    const disabledLayers = useMemo(() => {
        const out: Partial<Record<keyof LayerVisibility, string>> = {};
        if (!canViewProtectedFeeds) {
            out.mmsReconnection = "Sign in to view MMS reconnection vectors.";
        }
        if (!debrisEnabled) {
            out.radiationData = "Set VITE_FEATURE_DEBRIS_3D=true for debris/risk zones.";
        }
        return out;
    }, [canViewProtectedFeeds, debrisEnabled]);

    const useLiteSdaScene =
        powerProfile === "low-power" ||
        compactViewport ||
        backendHealth.svgLiteForced;
    const publicAnalysis = useMemo(() => {
        if (!spaceDomain.summary) {
            return null;
        }
        if (!spaceDomain.analysis) {
            return buildDeterministicPublicAnalysis(spaceDomain.summary, spaceDomain.analysis ?? null);
        }
        if (
            useLiteSdaScene ||
            backendHealth.deepseekMode !== "auto" ||
            spaceDomain.availability?.mode !== "live"
        ) {
            return buildDeterministicPublicAnalysis(
                spaceDomain.summary,
                spaceDomain.analysis,
                spaceDomain.availability?.mode ?? "live",
            );
        }
        return spaceDomain.analysis;
    }, [
        backendHealth.deepseekMode,
        spaceDomain.analysis,
        spaceDomain.availability?.mode,
        spaceDomain.summary,
        useLiteSdaScene,
    ]);
    const liteSdaReason =
        backendHealth.memoryLevel === "critical"
            ? "Backend RAM is critical: forcing SVG-only SDA mode until headroom recovers."
            : backendHealth.memoryLevel === "constrained"
                ? "Backend RAM is constrained: using the lightweight SDA map to preserve reliability."
                : powerProfile === "low-power"
                    ? "Low-power profile active: 3D scene paused to reduce GPU and battery usage."
                    : "Compact viewport detected: using a lightweight SDA map for faster interaction.";

    return {
        canvasRef,
        presentation,
        mission,
        canViewProtectedFeeds,
        debrisEnabled,
        ops,
        mms,
        spaceDomain,
        publicAnalysis,
        analysisTrend: spaceDomain.analysisTrend,
        riskZones,
        satelliteData,
        powerProfile,
        compactViewport,
        backendHealth,
        latest,
        vectorOverlay,
        sceneData,
        layers,
        setLayers,
        surya,
        visual,
        disabledLayers,
        useLiteSdaScene,
        liteSdaReason,
        logOperatorAction
    };
}
