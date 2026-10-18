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
import { buildDeterministicPublicAnalysis, riskInputs } from "@/lib/ssa-public-analysis";

const debrisEnvEnabled =
    String(
        (typeof import.meta !== "undefined"
            ? import.meta.env?.VITE_FEATURE_DEBRIS_3D
            : process.env.VITE_FEATURE_DEBRIS_3D) ?? "true",
    ).toLowerCase() !== "false";

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
        // With a risk feed unavailable, use the client text, which says "unknown" (GAU-81).
        const known = riskInputs(spaceDomain.summary);
        if (
            !known.catalog ||
            !known.conjunctions ||
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
