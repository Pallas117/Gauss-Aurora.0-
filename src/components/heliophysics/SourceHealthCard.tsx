import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    formatCadenceLabel,
    formatMetric,
    sourceDecisionVariant
} from "@/lib/heliophysics-utils";

interface SourceHealthCardProps {
    sourceStatus: any[];
    canonicalAge: number | string;
    mmsAge: number | string;
    auroraAge: number | string;
}

export const SourceHealthCard = ({
    sourceStatus,
    canonicalAge,
    mmsAge,
    auroraAge,
}: SourceHealthCardProps) => {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Source Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2">
                    {sourceStatus.length === 0 && (
                        <Badge variant="outline">No source status yet</Badge>
                    )}
                    {sourceStatus.map((source) => (
                        <Badge key={source.source} variant={source.healthy ? "secondary" : "destructive"}>
                            {source.source} {source.healthy ? "healthy" : "degraded"}
                        </Badge>
                    ))}
                </div>
                <div className="space-y-2">
                    {sourceStatus.map((source) => (
                        <div
                            key={source.source}
                            className="rounded border border-border/70 bg-background/40 p-2"
                            data-testid={`source-policy-${source.source}`}
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{source.source}</span>
                                <Badge variant={source.healthy ? "secondary" : "destructive"}>
                                    {source.healthy ? "healthy" : "degraded"}
                                </Badge>
                                {source.powerDecision ? (
                                    <Badge variant={sourceDecisionVariant(source.powerDecision, source.healthy)}>
                                        {source.powerDecision}
                                    </Badge>
                                ) : null}
                                {(source.powerDecision || source.targetCadenceMs != null) && (
                                    <Badge variant="outline">cadence {formatCadenceLabel(source.targetCadenceMs)}</Badge>
                                )}
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-muted-foreground">
                                <span>utility {formatMetric(source.utilityScore, 2)}</span>
                                <span>cost {formatMetric(source.observedCostScore, 2)}</span>
                                <span>fetch {formatMetric(source.avgFetchDurationMs, 0)} ms</span>
                                <span>cpu {formatMetric(source.avgCpuMs, 0)} ms</span>
                                <span>payload {formatMetric(source.avgPayloadKb, 1)} kB</span>
                                <span>samples {source.sampleCount ?? 0}</span>
                            </div>
                            {source.policyReason ? (
                                <p className="mt-1 text-[11px] text-muted-foreground">{source.policyReason}</p>
                            ) : null}
                        </div>
                    ))}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground font-mono">
                    <p>Canonical age: {canonicalAge}s</p>
                    <p>MMS age: {mmsAge}s</p>
                    <p>Aurora age: {auroraAge}s</p>
                </div>
            </CardContent>
        </Card>
    );
};
