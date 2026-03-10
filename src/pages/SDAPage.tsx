import { Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MissionSurfaceLinks } from "@/components/MissionSurfaceLinks";
import { LayerToggles } from "@/components/ui/LayerToggles";
import { useSDAState } from "@/hooks/useSDAState";
import { Presentation, LayoutGrid } from "lucide-react";
import { AiContextProvider } from "@/contexts/AiContext";
import { AgenticActionCards } from "@/components/cockpit/AgenticActionCards";
import { TriadPanel } from "@/components/heliophysics/TriadPanel";

const SpaceScene = lazy(() => import("@/components/scene/SpaceScene"));

function asPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function LiteSdaScene({ reason }: { reason: string }) {
  return (
    <div className="flex h-full flex-col justify-between p-4 text-sm">
      <div className="rounded-md border border-border/60 bg-background/60 p-3">
        <svg
          viewBox="0 0 320 180"
          role="img"
          aria-label="Simplified SDA map"
          className="h-48 w-full text-primary/80"
        >
          <rect x="1" y="1" width="318" height="178" rx="10" fill="currentColor" fillOpacity="0.06" stroke="currentColor" strokeOpacity="0.35" />
          <circle cx="160" cy="90" r="34" fill="none" stroke="currentColor" strokeOpacity="0.7" strokeWidth="2" />
          <ellipse cx="160" cy="90" rx="78" ry="42" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" />
          <ellipse cx="160" cy="90" rx="118" ry="63" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
          <circle cx="236" cy="90" r="3.5" fill="currentColor" />
          <circle cx="88" cy="90" r="3.5" fill="currentColor" fillOpacity="0.8" />
          <line x1="42" y1="90" x2="278" y2="90" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="5 5" />
        </svg>
      </div>
      <p className="text-muted-foreground">{reason}</p>
    </div>
  );
}

function SDAPageContent() {
  const {
    canvasRef,
    presentation,
    mission,
    canViewProtectedFeeds,
    debrisEnabled,
    mms,
    spaceDomain,
    satelliteData,
    latest,
    vectorOverlay,
    sceneData,
    layers,
    setLayers,
    visual,
    disabledLayers,
    useLiteSdaScene,
    liteSdaReason,
    logOperatorAction,
  } = useSDAState();
  const spaceDomainSummary = spaceDomain.summary;

  return (
    <Tabs defaultValue="hud" className="flex h-full flex-col space-y-4" data-testid="sda-page">
      <MissionSurfaceLinks compact />

      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="hud">HUD</TabsTrigger>
          <TabsTrigger value="metrics">Metrics & Science</TabsTrigger>
        </TabsList>
        <div className="flex gap-2">
          {presentation ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/sda">
                <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                Normal layout
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link to="/sda?presentation=1">
                <Presentation className="mr-1.5 h-3.5 w-3.5" />
                Cast / full room
              </Link>
            </Button>
          )}
        </div>
      </div>

      <TabsContent value="hud" className="m-0 flex-1 min-h-[600px]">
        <Card className="gauss-sda-primary h-full relative">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">SDA Visualization</CardTitle>
          </CardHeader>

          <div className="absolute top-14 left-4 z-10 w-80">
            <AgenticActionCards />
          </div>

          <CardContent className="h-[calc(100%-3rem)] p-0">
            {useLiteSdaScene ? (
              <LiteSdaScene reason={liteSdaReason} />
            ) : (
              <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading 3D scene…</div>}>
                <SpaceScene
                  layers={layers}
                  magnetopauseCompression={visual.magnetopauseCompression}
                  beltIntensity={visual.beltIntensity}
                  reconnectionStrength={visual.reconnectionStrength}
                  mmsVectors={mms.vectors}
                  canonicalPoint={latest}
                  vectorOverlay={vectorOverlay}
                  data={sceneData}
                  canvasRef={canvasRef}
                />
              </Suspense>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="metrics" className="m-0">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Physics Inputs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">compression {asPercent(visual.magnetopauseCompression)}</Badge>
                  <Badge variant="outline">belt {asPercent(visual.beltIntensity)}</Badge>
                  <Badge variant="outline">reconnection {asPercent(visual.reconnectionStrength)}</Badge>
                </div>
                <p>
                  IMF Bz: <span className="font-semibold">{latest ? `${latest.magneticField.z.toFixed(2)} nT` : "n/a"}</span>
                </p>
                <p>
                  Dynamic pressure: <span className="font-semibold">{latest ? `${latest.solarWind.dynamicPressure.toFixed(2)} nPa` : "n/a"}</span>
                </p>
                <p>
                  CME cone: <span className="font-semibold">{vectorOverlay?.cmeProxy.coneWidthDeg.toFixed(1) ?? "n/a"} deg</span>
                </p>
              </CardContent>
            </Card>

            <TriadPanel />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Feed State</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>auth: {canViewProtectedFeeds ? "ready" : "sign in required"}</p>
                <p>live data: {latest ? (mission.snapshot ? "dashboard" : "ops/command") : "none — sign in or start backend"}</p>
                <p>mms vectors: {mms.vectors.length}</p>
                <p>mms source: {mms.source}</p>
                {debrisEnabled && <p>debris points: {sceneData?.length ?? 0}</p>}
                {debrisEnabled && spaceDomainSummary && (
                  <>
                    <p>catalog objects: {spaceDomainSummary.counts.satelliteObjectCount}</p>
                    <p>high-value: {spaceDomainSummary.counts.highValueCount}</p>
                    <p>conjunctions tracked: {spaceDomainSummary.counts.conjunctionCount}</p>
                  </>
                )}
                {mms.error ? <p className="text-destructive">{mms.error}</p> : null}
              </CardContent>
            </Card>

            {debrisEnabled && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Satellite & object data</CardTitle>
                  <p className="text-xs text-muted-foreground font-normal">
                    High-value and unidentified objects from TLE catalog
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  {satelliteData ? (
                    <>
                      <div>
                        <p className="font-medium text-foreground mb-1.5">
                          High-value ({satelliteData.highValue.length})
                        </p>
                        <ul className="space-y-1 text-muted-foreground max-h-32 overflow-y-auto">
                          {(satelliteData.highValue.slice(0, 15)).map((o) => (
                            <li key={o.noradId} className="flex justify-between gap-2">
                              <span className="truncate" title={o.name}>{o.name}</span>
                              <span className="shrink-0">{o.orbitType} · {o.altitudeKm} km</span>
                            </li>
                          ))}
                          {satelliteData.highValue.length > 15 && (
                            <li className="text-muted-foreground/70">+{satelliteData.highValue.length - 15} more</li>
                          )}
                        </ul>
                      </div>
                      <div>
                        <p className="font-medium text-foreground mb-1.5">
                          Unidentified ({satelliteData.unidentified.length})
                        </p>
                        <ul className="space-y-1 text-muted-foreground max-h-32 overflow-y-auto">
                          {(satelliteData.unidentified.slice(0, 15)).map((o) => (
                            <li key={o.noradId} className="flex justify-between gap-2">
                              <span className="truncate" title={o.name}>{o.name}</span>
                              <span className="shrink-0">NORAD {o.noradId} · {o.orbitType}</span>
                            </li>
                          ))}
                          {satelliteData.unidentified.length > 15 && (
                            <li className="text-muted-foreground/70">+{satelliteData.unidentified.length - 15} more</li>
                          )}
                        </ul>
                      </div>
                      {spaceDomainSummary && (
                        <div>
                          <p className="font-medium text-foreground mb-1.5">SSA summary</p>
                          <ul className="space-y-1 text-muted-foreground">
                            <li>Max catalog risk: {Math.round(spaceDomainSummary.crowding.maxRiskScore * 100)}%</li>
                            <li>Unidentified ratio: {Math.round(spaceDomainSummary.crowding.unidentifiedRatio * 100)}%</li>
                            <li>
                              Learned SSA score: {Math.round(spaceDomainSummary.learnedLane.score * 100)}%
                              {spaceDomainSummary.learnedLane.trigger ? " · trigger" : " · monitor"}
                            </li>
                            <li>Learned SSA model: {spaceDomainSummary.learnedLane.modelVersion}</li>
                            <li>
                              Max conjunction probability: {spaceDomainSummary.conjunctionRisk.maxCollisionProbability != null
                                ? `${(spaceDomainSummary.conjunctionRisk.maxCollisionProbability * 100).toFixed(2)}%`
                                : "n/a"}
                            </li>
                            <li>
                              Min miss distance: {spaceDomainSummary.conjunctionRisk.minMissDistanceM != null
                                ? `${Math.round(spaceDomainSummary.conjunctionRisk.minMissDistanceM)} m`
                                : "n/a"}
                            </li>
                          </ul>
                        </div>
                      )}
                      <p className="text-muted-foreground/70">Updated {new Date(satelliteData.updatedAt).toLocaleTimeString()}</p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">No satellite catalog data yet. Backend ingest runs every 6 min.</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <LayerToggles
              layers={layers}
              disabledLayers={disabledLayers}
              onToggle={(layer) => {
                setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
                logOperatorAction("TOGGLE_LAYER", `Operator toggled visibility of ${layer}`);
              }}
            />
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

export default function SDAPage() {
  return (
    <AiContextProvider>
      <SDAPageContent />
    </AiContextProvider>
  );
}
