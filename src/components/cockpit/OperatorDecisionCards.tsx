import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ThreatSummaryResponse } from "@/lib/types/space-weather";

interface OperatorDecisionCardsProps {
  threatSummary: ThreatSummaryResponse | null;
  stormTier: string;
  loading: boolean;
  error: string | null;
}

export function OperatorDecisionCards({
  threatSummary,
  stormTier,
  loading,
  error,
}: OperatorDecisionCardsProps) {
  const gate = threatSummary?.gate;
  const topThreat = threatSummary?.threats[0] ?? null;
  const topThree = threatSummary?.threats.slice(0, 3) ?? [];
  const recommendedNext = threatSummary?.summary?.top_recommended_action ?? gate?.reason ?? null;

  return (
    <Card className="border-primary/30 bg-card" data-testid="operator-decision-cards">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">One-screen decision summary</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Storm: {stormTier}</Badge>
            {gate ? (
              <Badge
                variant={gate.action === "TRIGGER_LLM" ? "default" : "secondary"}
                data-testid="gate-badge"
              >
                Gate: {gate.action}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading && <p className="text-muted-foreground">Loading threat fusion…</p>}
        {error && (
          <p className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {!loading && !error && (
          <>
            <div className=" border-2 border-primary/40 bg-primary/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Top action
              </p>
              <p className="font-semibold" data-testid="top-action">
                {topThreat?.recommended_action ?? recommendedNext ?? "Monitor. No immediate action."}
              </p>
              {topThreat ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {topThreat.type} · p={topThreat.probability.toFixed(2)} · CI [
                  {(topThreat.confidence_interval?.[0] ?? 0).toFixed(2)}–
                  {(topThreat.confidence_interval?.[1] ?? 0).toFixed(2)}]
                </p>
              ) : null}
            </div>

            {topThree.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Top 3 threats (confidence + factors)
                </p>
                <ul className="space-y-2">
                  {topThree.map((threat) => (
                    <li
                      key={threat.id}
                      className="rounded border border-border/70 bg-background/40 p-2"
                      data-testid={`decision-threat-${threat.id}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{threat.type}</span>
                        <span className="text-xs text-muted-foreground">
                          p={threat.probability.toFixed(2)} · CI [
                          {(threat.confidence_interval?.[0] ?? 0).toFixed(2)}–
                          {(threat.confidence_interval?.[1] ?? 0).toFixed(2)}]
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{threat.recommended_action}</p>
                      {(threat.factors?.length ?? 0) > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground/90">
                          Factors:{" "}
                          {threat.factors
                            .slice(0, 3)
                            .map((f) => `${f.name} (${(f.contribution ?? 0).toFixed(2)})`)
                            .join("; ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {recommendedNext && (
              <div className="rounded border border-border/70 bg-background/30 p-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recommended next step
                </p>
                <p data-testid="recommended-next">{recommendedNext}</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
