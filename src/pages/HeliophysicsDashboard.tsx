import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LayerToggles } from "@/components/ui/LayerToggles";
import { AuroraCastMap } from "@/components/heliophysics/AuroraCastMap";
import { AuthSessionModal } from "@/components/heliophysics/AuthSessionModal";
import { FeedbackPanel } from "@/components/heliophysics/FeedbackPanel";
import { SolarWindSpeedChart } from "@/components/heliophysics/SolarWindSpeedChart";
import { SuryaStubPanel } from "@/components/heliophysics/SuryaStubPanel";
import { ThreatActionCards } from "@/components/heliophysics/ThreatActionCards";
import { MissionHeader } from "@/components/heliophysics/MissionHeader";
import { AuthSessionCard } from "@/components/heliophysics/AuthSessionCard";
import { OperationalSummaryCard } from "@/components/heliophysics/OperationalSummaryCard";
import { PassWindowsCard } from "@/components/heliophysics/PassWindowsCard";
import { SourceHealthCard } from "@/components/heliophysics/SourceHealthCard";
import { GaussRagPanel } from "@/components/GaussRagPanel";
import { MissionSurfaceLinks } from "@/components/MissionSurfaceLinks";
import { GlassPanel } from "@/components/orbit/GlassPanel";
import { LiteSdaScene } from "@/components/sda/LiteSdaScene";
import { useAuroraMap } from "@/hooks/useAuroraMap";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { useMMSReconnection } from "@/hooks/useMMSReconnection";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useMissionCoreSnapshot } from "@/hooks/useMissionCoreSnapshot";
import { usePowerProfile } from "@/hooks/usePowerProfile";
import { useOfflineMode } from "@/hooks/useOfflineMode";
import { useSolarWind5s } from "@/hooks/useSolarWind5s";
import { useRiskZones } from "@/hooks/useRiskZones";
import { useSuryaForecast } from "@/hooks/useSuryaForecast";
import { useNowcastPlayback } from "@/hooks/useNowcastPlayback";
import {
  clamp01,
  formatDelay,
  getViteEnv,
  hasMissionClearance,
  nowcastPredictionToCanonicalPoint,
  nowcastPredictionToVisualizationPoints,
} from "@/lib/heliophysics-utils";
import {
  suryaActivityFromResponse,
  suryaForecastToRadiationPoints,
} from "@/lib/suryaRadiation";
import { getApiBaseUrl } from "@/lib/api/base-url";
import type { LayerVisibility } from "@/components/types";
import type { VisualizationPoint } from "@/lib/types/radiation";
import {
  prioritizeVisualizationPoints,
  withVisualizationPriority,
} from "@/lib/visual-priority";


const SpaceScene = lazy(() => import("@/components/scene/SpaceScene"));

const HeliophysicsDashboard = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const location = useLocation();
  const baseUrl = getApiBaseUrl();
  const stripeCheckoutUrl = (getViteEnv("VITE_STRIPE_CHECKOUT_URL") ?? (typeof process !== "undefined" ? process.env?.VITE_STRIPE_CHECKOUT_URL : undefined) ?? "").toString().trim();
  const [layers, setLayers] = useState<LayerVisibility>({
    earth: true,
    belts: true,
    magnetosphere: true,
    fieldLines: true,
    mhdWaves: true,
    mmsReconnection: true,
  });
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const mission = useMissionSnapshot();
  const backendHealth = useBackendHealth();
  const offline = useOfflineMode({
    lastSuccessfulSyncAt:
      mission.lastSuccessfulSyncAt ??
      mission.snapshot?.timestamp ??
      mission.snapshot?.canonicalLatest?.timestamp ??
      null,
    staleAfterMs: 90_000,
  });

  const canViewProtectedFeeds =
    mission.session != null
      ? !mission.session.authRequired || mission.session.authenticated
      : false;

  const { profile: powerProfile } = usePowerProfile();
  const solarWind = useSolarWind5s({ enabled: canViewProtectedFeeds });
  const latest = mission.snapshot?.canonicalLatest ?? solarWind.latest;

  const {
    inferenceState,
    inferenceMessage,
    manualNowcast,
    nowcastPlaybackIndex,
    setInferenceState,
    setInferenceMessage,
    runManualInference
  } = useNowcastPlayback({
    baseUrl,
    latestPoint: latest,
    powerProfile,
    enabled: !offline.isOffline
  });

  const canRunInference =
    (mission.session?.role === "operator" || mission.session?.role === "admin") &&
    hasMissionClearance(mission.session?.clearance) &&
    !offline.isOffline;
  const useLiteHelioScene =
    powerProfile === "low-power" || backendHealth.memoryLevel !== "nominal";
  const liteHelioReason =
    backendHealth.memoryLevel === "critical"
      ? "Backend RAM is critical: heliophysics scene has shifted to SVG mode."
      : backendHealth.memoryLevel === "constrained"
        ? "Backend RAM is constrained: reduced scene load to keep telemetry responsive."
        : "Low-power mode is active: the heliophysics scene is using the lightweight renderer.";

  const aurora = useAuroraMap({ enabled: canViewProtectedFeeds });
  const suryaStubEnabled =
    (getViteEnv("VITE_FEATURE_SURYA_STUB") ?? (typeof process !== "undefined" ? process.env?.VITE_FEATURE_SURYA_STUB : undefined)) === "true";
  const suryaEnabled =
    suryaStubEnabled ||
    getViteEnv("VITE_FEATURE_SURYA_3D_LIVE") === "true";
  const debrisEnabled =
    String(getViteEnv("VITE_FEATURE_DEBRIS_3D") ?? "true").toLowerCase() !== "false" ||
    (mission.session?.features?.debris ?? false);
  const surya = useSuryaForecast();
  const { riskZones } = useRiskZones({
    enabled: debrisEnabled && canViewProtectedFeeds,
  });
  const missionCore = useMissionCoreSnapshot({ enabled: canViewProtectedFeeds });
  const [showPassOverlays, setShowPassOverlays] = useState(false);

  const mms = useMMSReconnection({ enabled: canViewProtectedFeeds });
  const threatSummary = mission.snapshot?.threatSummary ?? null;
  const sourceStatus = mission.snapshot?.sourceStatus ?? [];
  const mmsVectorsForScene = useMemo(() => {
    if (mms.vectors.length > 0) {
      return mms.vectors;
    }
    if (mission.snapshot?.mmsLatest) {
      return [mission.snapshot.mmsLatest];
    }
    return [];
  }, [mission.snapshot?.mmsLatest, mms.vectors]);

  const suryaActivity = suryaEnabled ? suryaActivityFromResponse(surya.data) : 0;
  const suryaRadiationPoints = useMemo(
    () => (suryaEnabled ? suryaForecastToRadiationPoints(surya.data) : []),
    [suryaEnabled, surya.data]
  );
  const nowcastPredictionCount = manualNowcast?.predictions.length ?? 0;
  const nowcastFrameIndex =
    nowcastPredictionCount > 0 ? nowcastPlaybackIndex % nowcastPredictionCount : 0;
  const nowcastActivePrediction =
    nowcastPredictionCount > 0 ? manualNowcast?.predictions[nowcastFrameIndex] ?? null : null;
  const nowcastFrameNumber = nowcastPredictionCount > 0 ? nowcastFrameIndex + 1 : 0;
  const nowcastVisualizationPoints = useMemo(
    () => nowcastPredictionToVisualizationPoints(manualNowcast, nowcastFrameIndex),
    [manualNowcast, nowcastFrameIndex],
  );
  const sceneCanonicalPoint = useMemo(() => {
    if (!latest) {
      return null;
    }
    if (!nowcastActivePrediction) {
      return latest;
    }
    return nowcastPredictionToCanonicalPoint(latest, nowcastActivePrediction);
  }, [latest, nowcastActivePrediction]);

  const sceneData = useMemo(() => {
    const radiation: VisualizationPoint[] = [...suryaRadiationPoints, ...nowcastVisualizationPoints];
    let risk = debrisEnabled ? riskZones : [];
    if (risk.length > 0 && powerProfile === "low-power") {
      risk = prioritizeVisualizationPoints(
        risk.filter((r) => r.orbitType === "GEO"),
        25,
      );
    }
    const combined = prioritizeVisualizationPoints(
      [...radiation, ...risk].map((point) => withVisualizationPriority(point)),
      50,
    );
    return combined.length > 0 ? combined : undefined;
  }, [suryaRadiationPoints, nowcastVisualizationPoints, debrisEnabled, riskZones, powerProfile]);

  const visual = useMemo(() => {
    const pressure = sceneCanonicalPoint?.solarWind.dynamicPressure ?? 2;
    const bz = sceneCanonicalPoint?.magneticField.z ?? 0;
    const kp = sceneCanonicalPoint?.indices.kp ?? 2;

    const pressureNorm = Math.min(1, pressure / 10);
    let magnetopauseCompression = Math.max(0.6, 1 - pressureNorm * 0.4);
    let beltIntensity = Math.min(1, kp / 9 + 0.2);
    if (suryaEnabled && suryaActivity >= 0) {
      beltIntensity = 0.7 * beltIntensity + 0.3 * suryaActivity;
    }
    let reconnectionStrength = Math.max(0, Math.min(1, -bz / 15));

    if (nowcastActivePrediction) {
      const perturbNorm = clamp01(nowcastActivePrediction.geomagneticPerturbation / 80);
      magnetopauseCompression = Math.max(0.5, magnetopauseCompression - perturbNorm * 0.1);
      beltIntensity = clamp01(0.65 * beltIntensity + 0.35 * clamp01(nowcastActivePrediction.auroraIntensity));
      reconnectionStrength = clamp01(0.65 * reconnectionStrength + 0.35 * perturbNorm);
    }

    return { magnetopauseCompression, beltIntensity, reconnectionStrength };
  }, [sceneCanonicalPoint, suryaEnabled, suryaActivity, nowcastActivePrediction]);

  useEffect(() => {
    if (suryaEnabled) surya.fetchForecast();
  }, [suryaEnabled]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("auth") === "1") {
      setAuthModalOpen(true);
    }
  }, [location.search]);

  useEffect(() => {
    if (offline.isOffline) {
      setInferenceState("disabled");
      setInferenceMessage("Manual inference is disabled while offline.");
      return;
    }
    if (!mission.session?.authRequired || mission.session.authenticated) {
      setInferenceState((prev) => (prev === "disabled" ? "ready" : prev));
      return;
    }
    setInferenceState("disabled");
  }, [mission.session, offline.isOffline]);

  const onToggle = (layer: keyof LayerVisibility) => {
    setLayers((prev) => ({
      ...prev,
      [layer]: !prev[layer],
    }));
  };

  const disabledLayers = canViewProtectedFeeds
    ? {}
    : {
      mmsReconnection: "Sign in to view MMS reconnection vectors.",
    };

  const authSummary = useMemo(() => {
    if (!mission.session) {
      return "Checking auth session...";
    }
    if (!mission.session.authRequired) {
      return "Development bypass is active. Production RBAC checks are currently disabled.";
    }
    if (!mission.session.authenticated) {
      if (mission.session.emailVerified === false) {
        return "Email verification is pending. Verify your email to unlock protected feeds.";
      }
      return "Sign in to access protected heliophysics feeds and operator controls.";
    }
    return `Signed in as ${mission.session.role ?? "viewer"} with ${mission.session.clearance ?? "public"} clearance${mission.session.email ? ` (${mission.session.email})` : ""}.`;
  }, [mission.session]);

  const solarWindError = canViewProtectedFeeds
    ? solarWind.error
    : "Sign in to load the protected 5s heliophysics feed.";

  const auroraError = canViewProtectedFeeds
    ? aurora.error
    : "Sign in to load the protected aurora map feed.";

  const openStripeCheckout = () => {
    if (!stripeCheckoutUrl) {
      setBillingMessage(
        "Stripe checkout is not configured yet. Set VITE_STRIPE_CHECKOUT_URL to enable subscriptions.",
      );
      return;
    }
    window.open(stripeCheckoutUrl, "_blank", "noopener,noreferrer");
    setBillingMessage("Opened subscription checkout in a new tab.");
  };

  return (
    <main className="min-h-screen w-full bg-background text-foreground">
      <MissionHeader
        pollingPaused={mission.pollingPaused}
        isOffline={offline.isOffline}
        usingCachedData={mission.usingCachedData}
        staleData={offline.staleData}
        stormTier={sceneCanonicalPoint?.alerts.stormTier ?? "unknown"}
      />

      <section className="grid gap-4 p-4 lg:p-6 2xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]">
        <div className="min-w-0 space-y-4">
          <MissionSurfaceLinks compact />

          <GlassPanel className="relative h-[58vh] min-h-[420px] overflow-hidden rounded-lg border bg-card p-0">
            {suryaEnabled && suryaRadiationPoints.length > 0 ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="absolute top-2 right-2 z-10 rounded bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
                      Surya-driven
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Belt intensity + radiation from Surya</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            {manualNowcast && nowcastActivePrediction ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="absolute top-2 left-2 z-10 rounded bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium text-black shadow">
                      Nowcast mapped
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>
                      Model {manualNowcast.modelVersion} · confidence{" "}
                      {(clamp01(nowcastActivePrediction.confidence) * 100).toFixed(0)}% · frame{" "}
                      {nowcastFrameNumber}/{nowcastPredictionCount}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            {useLiteHelioScene ? (
              <LiteSdaScene reason={liteHelioReason} />
            ) : (
              <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading 3D scene…</div>}>
                <SpaceScene
                  layers={layers}
                  magnetopauseCompression={visual.magnetopauseCompression}
                  beltIntensity={visual.beltIntensity}
                  reconnectionStrength={visual.reconnectionStrength}
                  mmsVectors={mmsVectorsForScene}
                  canonicalPoint={sceneCanonicalPoint}
                  vectorOverlay={mission.snapshot?.vectorOverlay}
                  data={sceneData}
                  canvasRef={canvasRef}
                  powerMode={powerProfile}
                  passWindows={missionCore.data?.passes}
                  showPassOverlays={showPassOverlays && (missionCore.data?.passes?.length ?? 0) > 0}
                />
              </Suspense>
            )}
          </GlassPanel>

          <div className="grid gap-4 xl:grid-cols-2">
            <SolarWindSpeedChart
              points={solarWind.points}
              loading={solarWind.loading}
              error={solarWindError}
              source={solarWind.source}
            />
            <AuroraCastMap
              map={aurora.map ?? mission.snapshot?.auroraLatest ?? null}
              loading={aurora.loading || mission.loading}
              error={auroraError}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <GlassPanel className="p-0">
              <GaussRagPanel className="rounded-2xl border-0 bg-transparent shadow-none" />
            </GlassPanel>
            <div id="feedback-panel">
              <FeedbackPanel />
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <AuthSessionCard
            session={mission.session}
            authSummary={authSummary}
            billingMessage={billingMessage}
            inferenceMessage={inferenceMessage}
            missionError={mission.error}
            onOpenAuthModal={() => setAuthModalOpen(true)}
            onOpenStripeCheckout={openStripeCheckout}
          />

          <LayerToggles layers={layers} onToggle={onToggle} disabledLayers={disabledLayers} />

          <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/50 p-2">
            <Checkbox
              id="pass-overlays"
              checked={showPassOverlays}
              disabled={(missionCore.data?.passes?.length ?? 0) === 0}
              onCheckedChange={(c) => setShowPassOverlays(c === true)}
              aria-describedby="pass-overlays-desc"
            />
            <label htmlFor="pass-overlays" className="text-xs font-medium cursor-pointer flex-1">
              Pass arcs overlay
            </label>
            <span id="pass-overlays-desc" className="text-[10px] text-muted-foreground">
              {(missionCore.data?.passes?.length ?? 0) === 0
                ? "No pass data"
                : "Show pass windows in 3D"}
            </span>
          </div>

          <PassWindowsCard passes={missionCore.data?.passes ?? []} />

          {suryaStubEnabled ? <SuryaStubPanel /> : null}

          <OperationalSummaryCard
            stormTier={sceneCanonicalPoint?.alerts.stormTier ?? "unknown"}
            bz={sceneCanonicalPoint?.magneticField.z ?? 0}
            l1Delay={formatDelay(sceneCanonicalPoint?.propagation.l1DelaySeconds)}
            reconnectionConfidence={mms.latest?.quality.confidence ?? "n/a"}
            nowcastModelVersion={manualNowcast?.modelVersion ?? "not applied"}
            nowcastActivePrediction={nowcastActivePrediction}
            nowcastFrameNumber={nowcastFrameNumber}
            nowcastPredictionCount={nowcastPredictionCount}
            feedMode={mission.snapshot?.source ?? solarWind.source}
            pollingPaused={mission.pollingPaused}
            isOffline={offline.isOffline}
          />

          <SourceHealthCard
            sourceStatus={sourceStatus}
            canonicalAge={mission.snapshot?.freshness.canonicalAgeSeconds?.toFixed(1) ?? "n/a"}
            mmsAge={mission.snapshot?.freshness.mmsAgeSeconds?.toFixed(1) ?? "n/a"}
            auroraAge={mission.snapshot?.freshness.auroraAgeSeconds?.toFixed(1) ?? "n/a"}
          />

          <ThreatActionCards
            threatSummary={threatSummary}
            stormTier={sceneCanonicalPoint?.alerts.stormTier ?? "unknown"}
            loading={mission.loading}
            error={mission.error}
            role={mission.session?.role ?? null}
            clearance={mission.session?.clearance ?? null}
            inferenceState={inferenceState}
            onRunInference={canRunInference ? runManualInference : undefined}
          />
        </aside>
      </section>

      <AuthSessionModal
        open={authModalOpen}
        onOpenChange={setAuthModalOpen}
        session={mission.session}
        loading={mission.loading}
        onSessionRefresh={mission.refreshSession}
      />
    </main>
  );
};

export default HeliophysicsDashboard;
