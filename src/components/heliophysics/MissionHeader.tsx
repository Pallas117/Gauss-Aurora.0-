import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/orbit/GlassPanel";

interface MissionHeaderProps {
    pollingPaused: boolean;
    isOffline: boolean;
    usingCachedData: boolean;
    staleData: boolean;
    stormTier: string;
    lastSuccessfulSyncAt?: number | null;
}

function useLiveLagSeconds(lastSuccessfulSyncAt: number | null | undefined): number | null {
    const [lagSeconds, setLagSeconds] = useState<number | null>(null);

    useEffect(() => {
        if (!lastSuccessfulSyncAt) {
            setLagSeconds(null);
            return;
        }
        const tick = () => {
            setLagSeconds(Math.floor((Date.now() - lastSuccessfulSyncAt) / 1000));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [lastSuccessfulSyncAt]);

    return lagSeconds;
}

export const MissionHeader = ({
    pollingPaused,
    isOffline,
    usingCachedData,
    staleData,
    stormTier,
    lastSuccessfulSyncAt,
}: MissionHeaderProps) => {
    const lagSeconds = useLiveLagSeconds(lastSuccessfulSyncAt);

    const lagVariant =
        lagSeconds === null
            ? "outline"
            : lagSeconds > 90
                ? "destructive"
                : lagSeconds > 30
                    ? "secondary"
                    : "secondary";

    const lagLabel =
        lagSeconds === null
            ? "Awaiting sync…"
            : lagSeconds > 90
                ? `⚠ Lag ${lagSeconds}s`
                : lagSeconds > 30
                    ? `~${lagSeconds}s lag`
                    : `Live +${lagSeconds}s`;

    const lagClass =
        lagSeconds !== null && lagSeconds > 30 && lagSeconds <= 90
            ? "border-amber-500/70 text-amber-400"
            : undefined;

    return (
        <section className="px-4 pt-4 lg:px-6">
            <GlassPanel className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight">Gauss Aurora Mission Console</h1>
                    <p className="text-sm text-muted-foreground">
                        Unified heliophysics operations surface with protected feeds, reconnection analytics,
                        AI fusion, and operator actions in one screen.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">Route: /heliophysics</Badge>
                    <Badge variant={pollingPaused ? "destructive" : "secondary"}>
                        Feed {pollingPaused ? "paused" : "active"}
                    </Badge>
                    <Badge variant={isOffline ? "destructive" : "secondary"}>
                        {isOffline ? "Offline" : "Online"}
                    </Badge>
                    {usingCachedData && <Badge variant="outline">Cached snapshot</Badge>}
                    {staleData && <Badge variant="destructive">Stale data</Badge>}
                    <Badge variant="outline">Storm tier {stormTier}</Badge>
                    <Badge
                        variant={lagVariant}
                        className={lagClass}
                        title={lastSuccessfulSyncAt ? `Last sync: ${new Date(lastSuccessfulSyncAt).toISOString()}` : undefined}
                    >
                        {lagLabel}
                    </Badge>
                </div>
            </GlassPanel>
        </section>
    );
};
