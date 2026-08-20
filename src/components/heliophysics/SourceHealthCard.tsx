import { useEffect, useRef, useState } from "react";
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

function AgeDisplay({ ageSeconds, label }: { ageSeconds: number | string; label: string }) {
    const baseAge = typeof ageSeconds === "number"
        ? ageSeconds
        : parseFloat(ageSeconds as string);

    // Tick up from the base age in real-time
    const [displayAge, setDisplayAge] = useState<number | null>(
        Number.isFinite(baseAge) ? baseAge : null,
    );
    const startRef = useRef<{ wall: number; base: number } | null>(null);

    useEffect(() => {
        if (!Number.isFinite(baseAge)) {
            setDisplayAge(null);
            return;
        }
        startRef.current = { wall: Date.now(), base: baseAge };
        setDisplayAge(baseAge);
        const id = setInterval(() => {
            if (!startRef.current) return;
            const elapsed = (Date.now() - startRef.current.wall) / 1000;
            setDisplayAge(Math.round(startRef.current.base + elapsed));
        }, 1000);
        return () => clearInterval(id);
    }, [baseAge]);

    const age = displayAge;
    const stale = age !== null && age > 90;
    const warning = age !== null && age > 30 && age <= 90;
    const colorClass = stale
        ? "text-destructive"
        : warning
            ? "text-amber-400"
            : "text-muted-foreground";

    return (
        <p className={`font-mono text-xs ${colorClass} flex items-center gap-1`}>
            <span>{label}:</span>
            <span>
                {age !== null ? `${age}s` : "n/a"}
            </span>
            {stale && <span title="Data is stale (>90s)">⚠</span>}
        </p>
    );
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
                <div className="space-y-1 rounded border border-border/40 bg-background/30 p-2">
                    <AgeDisplay ageSeconds={canonicalAge} label="Canonical age" />
                    <AgeDisplay ageSeconds={mmsAge} label="MMS age" />
                    <AgeDisplay ageSeconds={auroraAge} label="Aurora age" />
                </div>
            </CardContent>
        </Card>
    );
};
