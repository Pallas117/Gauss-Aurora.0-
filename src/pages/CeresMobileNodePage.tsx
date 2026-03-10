import { useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Cpu, LockKeyhole, RefreshCw, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThreatActionCards } from "@/components/heliophysics/ThreatActionCards";
import { FeedbackPanel } from "@/components/heliophysics/FeedbackPanel";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useSolarWind5s } from "@/hooks/useSolarWind5s";
import { useThreatSummary } from "@/hooks/useThreatSummary";
import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";
import type { AuthClearance } from "@/lib/types/space-weather";

const BASE_URL = getApiBaseUrl();

function hasMissionClearance(clearance: AuthClearance | null | undefined): boolean {
  return clearance === "mission" || clearance === "restricted";
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(digits);
}

export default function CeresMobileNodePage() {
  const mission = useMissionSnapshot();
  const [inferenceState, setInferenceState] = useState<"loading" | "ready" | "disabled" | "error">("ready");
  const [inferenceMessage, setInferenceMessage] = useState<string | null>(null);

  const canViewProtectedFeeds = mission.session
    ? !mission.session.authRequired || mission.session.authenticated
    : false;

  const canRunInference =
    (mission.session?.role === "operator" || mission.session?.role === "admin") &&
    hasMissionClearance(mission.session?.clearance);

  const solarWind = useSolarWind5s({ enabled: canViewProtectedFeeds });
  const threats = useThreatSummary({ enabled: canViewProtectedFeeds });

  const latest = mission.snapshot?.canonicalLatest ?? solarWind.latest;
  const telemetryRows = solarWind.points.slice(-8).reverse();

  const runInference = async () => {
    if (!latest || !canRunInference) {
      setInferenceState("disabled");
      setInferenceMessage(
        "Manual inference requires operator/admin with mission or restricted clearance.",
      );
      return;
    }

    setInferenceState("loading");
    setInferenceMessage(null);
    try {
      const response = await fetch(`${BASE_URL}/api/ai/nowcast/infer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify({
          horizonMinutes: 30,
          sequence: [latest],
        }),
      });

      if (response.status === 401 || response.status === 403) {
        setInferenceState("disabled");
        setInferenceMessage("Insufficient permissions for /api/ai/nowcast/infer.");
        return;
      }

      if (!response.ok) {
        throw new Error(`Inference HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { predictions?: unknown[] };
      setInferenceState("ready");
      setInferenceMessage(
        `Nowcast response received (${payload.predictions?.length ?? 0} predictions).`,
      );
    } catch (error) {
      setInferenceState("error");
      setInferenceMessage(error instanceof Error ? error.message : "Manual inference failed.");
    }
  };

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-testid="ceres-mobile-node-page">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-primary" />
            Ceres Mobile Node (Unified Feed)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant={canViewProtectedFeeds ? "secondary" : "destructive"}>
              {canViewProtectedFeeds ? "protected feed active" : "auth required"}
            </Badge>
            <Badge variant="outline">backend {BASE_URL}</Badge>
            <Badge variant="outline">source {mission.snapshot?.source ?? "polling"}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded border border-border/70 bg-background/40 p-2">
              <p className="text-muted-foreground">Solar wind</p>
              <p className="text-lg font-semibold">{formatNumber(latest?.solarWind.speed, 1)} km/s</p>
            </div>
            <div className="rounded border border-border/70 bg-background/40 p-2">
              <p className="text-muted-foreground">IMF Bz</p>
              <p className="text-lg font-semibold">{formatNumber(latest?.magneticField.z, 2)} nT</p>
            </div>
            <div className="rounded border border-border/70 bg-background/40 p-2">
              <p className="text-muted-foreground">Kp index</p>
              <p className="text-lg font-semibold">{formatNumber(latest?.indices.kp, 1)}</p>
            </div>
            <div className="rounded border border-border/70 bg-background/40 p-2">
              <p className="text-muted-foreground">Threat gate</p>
              <p className="text-sm font-semibold">{threats.data?.gate.action ?? "n/a"}</p>
            </div>
          </div>

          <div className="rounded border border-border/70 bg-background/40 p-3 text-xs">
            <p className="mb-2 font-semibold text-foreground">Ceres backend parity</p>
            <p><code>/api/ops/command/latest</code> (session + snapshot)</p>
            <p><code>/api/feed/space-weather/5s</code> (stream)</p>
            <p><code>/api/feed/threats/latest</code> (fusion)</p>
            <p><code>/api/ai/nowcast/infer</code> (operator/admin)</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void mission.refresh()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runInference()} disabled={!canRunInference || inferenceState === "loading"}>
              <Bot className="mr-2 h-4 w-4" />
              {inferenceState === "loading" ? "Running nowcast…" : "Run nowcast"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/heliophysics">Open full ops</Link>
            </Button>
          </div>

          {!canViewProtectedFeeds ? (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <p className="mb-2 font-medium">Sign in required for protected mobile node feeds.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link to="/heliophysics?auth=1">
                    <LockKeyhole className="mr-2 h-4 w-4" />
                    Open login portal
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/signup">Signup + SSO</Link>
                </Button>
              </div>
            </div>
          ) : null}

          {inferenceMessage ? <p className="text-xs text-muted-foreground">{inferenceMessage}</p> : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Live mobile stream</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {solarWind.error ? <p className="text-destructive">{solarWind.error}</p> : null}
            {telemetryRows.length === 0 ? (
              <p className="text-muted-foreground">No telemetry points yet.</p>
            ) : (
              <div className="max-h-[220px] overflow-auto rounded border border-border/70">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b border-border/70">
                      <th className="px-2 py-1 text-left">Time</th>
                      <th className="px-2 py-1 text-right">Speed</th>
                      <th className="px-2 py-1 text-right">Bz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telemetryRows.map((point) => (
                      <tr key={point.timestamp} className="border-b border-border/40">
                        <td className="px-2 py-1">{new Date(point.timestamp).toLocaleTimeString()}</td>
                        <td className="px-2 py-1 text-right">{point.solarWind.speed.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{point.magneticField.z.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <ThreatActionCards
          threatSummary={threats.data}
          stormTier={latest?.alerts.stormTier ?? "unknown"}
          loading={threats.loading}
          error={threats.error}
          role={mission.session?.role ?? null}
          clearance={mission.session?.clearance ?? null}
          inferenceState={canRunInference ? inferenceState : "disabled"}
          onRunInference={canRunInference ? runInference : undefined}
        />

        <FeedbackPanel compact />

        <div className="rounded border border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
            <Cpu className="h-4 w-4" />
            Unified UI/UX profile
          </div>
          <p>Theme: Hard Sovereign (forced dark)</p>
          <p>Panels: shared Card/Badge/Button stack</p>
          <p>Feed + AI path: same backend as web shell</p>
        </div>
      </div>
    </section>
  );
}
