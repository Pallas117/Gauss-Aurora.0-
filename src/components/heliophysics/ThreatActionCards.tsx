import { useMemo } from "react";
import { AlertTriangle, ShieldAlert, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuthClearance, ThreatSummaryResponse } from "@/lib/types/space-weather";

type StormTier = "quiet" | "watch" | "warning" | "severe" | "unknown";
type ActionState = "loading" | "ready" | "disabled" | "error";
type AuthRole = "viewer" | "operator" | "admin" | null;

interface ThreatActionCardsProps {
  threatSummary: ThreatSummaryResponse | null;
  stormTier: StormTier;
  loading: boolean;
  error: string | null;
  role: AuthRole;
  clearance?: AuthClearance | null;
  inferenceState: ActionState;
  onRunInference?: () => Promise<void>;
}

const quickActionsByTier: Record<StormTier, string[]> = {
  unknown: [
    "Verify data source health before operational decisions.",
    "Confirm auth/session and feed freshness.",
  ],
  quiet: [
    "Monitor canonical feed continuity and source latency.",
    "Keep operator escalation channels on standby.",
  ],
  watch: [
    "Increase monitoring cadence for IMF Bz and coupling.",
    "Pre-brief operator team on potential warning escalation.",
  ],
  warning: [
    "Issue operator alert and prepare mitigation runbook.",
    "Trigger nowcast inference and monitor reconnection confidence.",
  ],
  severe: [
    "Execute severe-storm countermeasures immediately.",
    "Escalate to incident command with live threat summary.",
  ],
};

function actionStateLabel(state: ActionState): string {
  if (state === "loading") return "Running…";
  if (state === "disabled") return "Unavailable";
  if (state === "error") return "Retry";
  return "Run 30m nowcast";
}

function tierIcon(tier: StormTier) {
  if (tier === "severe") return <Siren className="h-4 w-4 text-destructive" />;
  if (tier === "warning") return <ShieldAlert className="h-4 w-4 text-amber-500" />;
  return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
}

export function ThreatActionCards({
  threatSummary,
  stormTier,
  loading,
  error,
  role,
  clearance = null,
  inferenceState,
  onRunInference,
}: ThreatActionCardsProps) {
  const topThreat = threatSummary?.threats[0] ?? null;
  const quickActions = quickActionsByTier[stormTier] ?? quickActionsByTier.unknown;
  const inferenceEnabled =
    (role === "operator" || role === "admin") &&
    (clearance === "mission" || clearance === "restricted");

  const actionBadge = useMemo(() => {
    if (!threatSummary) {
      return null;
    }
    return `${threatSummary.gate.action} (${threatSummary.gate.confidence.toFixed(1)}%)`;
  }, [threatSummary]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Threat Action Center</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          {tierIcon(stormTier)}
          <span>
            Storm tier: <span className="font-semibold uppercase">{stormTier}</span>
          </span>
          {actionBadge ? <Badge variant="outline">{actionBadge}</Badge> : null}
        </div>

        {loading && <p>Loading threat fusion output…</p>}
        {error && <p className="text-destructive">{error}</p>}

        {!loading && !error && topThreat && (
          <div className=" border border-border/70 bg-background/40 p-3">
            <p className="font-semibold">
              Top action: {topThreat.recommended_action}
            </p>
            <p className="text-xs text-muted-foreground">
              {topThreat.type} | p={topThreat.probability.toFixed(2)} | score=
              {topThreat.composite_score.toFixed(2)} | CI{" "}
              {topThreat.confidence_interval[0].toFixed(2)}-
              {topThreat.confidence_interval[1].toFixed(2)}
            </p>
          </div>
        )}

        {!loading && !error && threatSummary && threatSummary.threats.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top threats (confidence + factors)
            </p>
            <ul className="space-y-1">
              {threatSummary.threats.slice(0, 3).map((threat) => (
                <li key={threat.id} className="rounded border border-border/70 bg-background/30 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{threat.type}</span>
                    <span className="text-xs text-muted-foreground">
                      p={threat.probability.toFixed(2)} · CI [
                      {threat.confidence_interval[0].toFixed(2)}–
                      {threat.confidence_interval[1].toFixed(2)}]
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {threat.recommended_action}
                  </p>
                  {threat.factors.length > 0 ? (
                    <p className="text-xs text-muted-foreground/80">
                      Factors:{" "}
                      {threat.factors
                        .slice(0, 5)
                        .map((f) => `${f.name} (${(f.contribution ?? 0).toFixed(2)})`)
                        .join("; ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quick actions
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {quickActions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <Button
          className="w-full"
          disabled={
            !inferenceEnabled ||
            !onRunInference ||
            inferenceState === "disabled" ||
            inferenceState === "loading"
          }
          variant={inferenceState === "error" ? "destructive" : "default"}
          onClick={() => onRunInference && void onRunInference()}
        >
          {actionStateLabel(inferenceState)}
        </Button>
        {!inferenceEnabled && (
          <p className="text-xs text-muted-foreground">
            Operator/admin role with mission or restricted clearance is required for manual inference.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
