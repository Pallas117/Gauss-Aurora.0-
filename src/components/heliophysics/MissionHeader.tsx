import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/orbit/GlassPanel";

interface MissionHeaderProps {
    pollingPaused: boolean;
    isOffline: boolean;
    usingCachedData: boolean;
    staleData: boolean;
    stormTier: string;
}

export const MissionHeader = ({
    pollingPaused,
    isOffline,
    usingCachedData,
    staleData,
    stormTier,
}: MissionHeaderProps) => {
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
                </div>
            </GlassPanel>
        </section>
    );
};
