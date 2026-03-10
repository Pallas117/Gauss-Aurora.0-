import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpsLaneLinks } from "@/components/ops/OpsLaneLinks";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";

export default function ChronosPage() {
  const mission = useMissionSnapshot();
  const { health, error: healthError } = useBackendHealth();

  const diagnostics = useMemo(() => {
    const latest = mission.snapshot?.canonicalLatest;
    if (!latest) {
      return [] as Array<{ label: string; value: string }>;
    }
    return [
      { label: "Dynamic pressure", value: `${latest.solarWind.dynamicPressure.toFixed(2)} nPa` },
      { label: "Coupling (Newell)", value: latest.coupling.newell.toFixed(0) },
      { label: "Alfven speed", value: `${latest.diagnostics?.alfvenSpeedKmS?.toFixed(1) ?? "n/a"} km/s` },
      { label: "Clock angle", value: `${latest.diagnostics?.clockAngleRad?.toFixed(2) ?? "n/a"} rad` },
    ];
  }, [mission.snapshot?.canonicalLatest]);

  return (
    <div className="space-y-4">
      <OpsLaneLinks compact showHub />
      <section className="grid gap-4 lg:grid-cols-2" data-testid="chronos-page">
        <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Runtime Diagnostics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant={health?.ok ? "secondary" : "destructive"}>
              backend {health?.ok ? "healthy" : "degraded"}
            </Badge>
            {health?.memory && (
              <Badge variant={health.memory.level === "nominal" ? "outline" : "destructive"}>
                RAM {health.memory.level}
              </Badge>
            )}
            <Badge variant={mission.pollingPaused ? "destructive" : "secondary"}>
              mission polling {mission.pollingPaused ? "paused" : "active"}
            </Badge>
          </div>
          {healthError ? <p className="text-destructive">{healthError}</p> : null}
          <p className="text-muted-foreground">
            Last health ping: {health?.timestamp ? new Date(health.timestamp).toLocaleString() : "n/a"}
          </p>
          <p className="text-muted-foreground">
            Session: {mission.session?.authenticated ? `${mission.session.role ?? "viewer"} (${mission.session.clearance ?? "public"})` : "signed out"}
          </p>
          {health?.memory && (
            <p className="text-muted-foreground">
              Memory headroom: {health.memory.freeRamGb.toFixed(2)} GB free of {health.memory.totalRamGb.toFixed(2)} GB
              {health.memory.ceiling.overCeiling ? " · ceiling breached" : ""}
            </p>
          )}
        </CardContent>
        </Card>

        <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Mission Timeline Inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {diagnostics.length === 0 ? (
            <p className="text-muted-foreground">Live diagnostics will appear once the canonical feed is available.</p>
          ) : (
            diagnostics.map((entry) => (
              <div key={entry.label} className="flex items-center justify-between rounded border border-border/70 bg-background/40 px-3 py-2">
                <span className="text-muted-foreground">{entry.label}</span>
                <span className="font-medium">{entry.value}</span>
              </div>
            ))
          )}

          <div className="rounded border border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
            Synthetic retro widgets remain labeled as simulation until dedicated live sources are available.
          </div>
        </CardContent>
        </Card>
      </section>
    </div>
  );
}
