import { RadioTower } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CanonicalSpaceWeatherPoint, SourceStatus, ThreatSummaryResponse } from "@/lib/types/space-weather";

interface CommandHealthThreatsProps {
    sourceStatus: SourceStatus[];
    threatSummary: ThreatSummaryResponse | null;
    threatError?: string | null;
    canonical: CanonicalSpaceWeatherPoint | null;
}

export function CommandHealthThreats({
    sourceStatus,
    threatSummary,
    threatError,
    canonical,
}: CommandHealthThreatsProps) {
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Source Health</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                    {sourceStatus.length === 0 ? (
                        <p className="text-muted-foreground">No source diagnostics available.</p>
                    ) : (
                        sourceStatus.map((source) => (
                            <div key={source.source} className="rounded border border-border/70 bg-background/40 p-2">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium uppercase tracking-wide">{source.source}</span>
                                    <Badge variant={source.healthy ? "secondary" : "destructive"}>
                                        {source.healthy ? "healthy" : "degraded"}
                                    </Badge>
                                </div>
                                <p className="text-muted-foreground">
                                    latency: {source.latencySeconds == null ? "n/a" : `${source.latencySeconds} s`}
                                </p>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Threat Priority</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                    {threatError ? <p className="text-destructive">{threatError}</p> : null}
                    {threatSummary?.threats.slice(0, 3).map((threat) => (
                        <div key={threat.id} className="rounded border border-border/70 bg-background/40 p-2">
                            <p className="font-semibold">{threat.type}</p>
                            <p className="text-muted-foreground">{threat.recommended_action}</p>
                            <p className="text-muted-foreground">
                                score {threat.composite_score.toFixed(2)} | p {threat.probability.toFixed(2)}
                            </p>
                        </div>
                    ))}
                    {!threatSummary && !threatError && <p className="text-muted-foreground">Threat summary unavailable.</p>}
                </CardContent>
            </Card>

            <div className="rounded border border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
                    <RadioTower className="h-4 w-4" />
                    Packet inspector (canonical)
                </div>
                <p>source: {canonical?.source ?? "n/a"}</p>
                <p>eta earth arrival: {canonical?.propagation.etaEarthArrival ?? "n/a"}</p>
                <p>l1 delay: {canonical?.propagation.l1DelaySeconds ?? "n/a"} s</p>
            </div>
        </div>
    );
}
