import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LayerToggles } from "@/components/ui/LayerToggles";
import { TriadPanel } from "@/components/heliophysics/TriadPanel";
import type { LayerVisibility } from "@/components/types";
import type { VisualizationPoint } from "@/lib/types/radiation";

function asPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

interface SdaMetricsProps {
  visual: {
    magnetopauseCompression: number;
    beltIntensity: number;
    reconnectionStrength: number;
  };
  latest: any;
  vectorOverlay: any;
  canViewProtectedFeeds: boolean;
  missionSnapshot: any;
  mms: {
    vectors: any[];
    source: string;
    error: string | null;
  };
  debrisEnabled: boolean;
  sceneData?: VisualizationPoint[];
  satelliteData: any;
  layers: LayerVisibility;
  disabledLayers: Partial<Record<keyof LayerVisibility, string>>;
  onToggleLayer: (layer: keyof LayerVisibility) => void;
}

export function SdaMetrics({
  visual,
  latest,
  vectorOverlay,
  canViewProtectedFeeds,
  missionSnapshot,
  mms,
  debrisEnabled,
  sceneData,
  satelliteData,
  layers,
  disabledLayers,
  onToggleLayer,
}: SdaMetricsProps) {
  return (
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
            <p>live data: {latest ? (missionSnapshot ? "dashboard" : "ops/command") : "none — sign in or start backend"}</p>
            <p>mms vectors: {mms.vectors.length}</p>
            <p>mms source: {mms.source}</p>
            {debrisEnabled && <p>debris points: {sceneData?.length ?? 0}</p>}
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
                      {(satelliteData.highValue.slice(0, 15)).map((o: any) => (
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
                      {(satelliteData.unidentified.slice(0, 15)).map((o: any) => (
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
          onToggle={onToggleLayer}
        />
      </div>
    </div>
  );
}
