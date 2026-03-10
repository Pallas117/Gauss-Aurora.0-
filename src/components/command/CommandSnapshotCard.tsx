import { Link } from "react-router-dom";
import { AlertTriangle, LockKeyhole, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CanonicalSpaceWeatherPoint, ThreatSummaryResponse } from "@/lib/types/space-weather";

interface CommandSnapshotCardProps {
    canonical: CanonicalSpaceWeatherPoint | null;
    summary: ThreatSummaryResponse | null;
    canViewProtectedFeeds: boolean;
    hasOpsData: boolean;
    hasMissionSnapshot: boolean;
    onRefresh: () => void;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
    if (value == null || !Number.isFinite(value)) return "n/a";
    return value.toFixed(digits);
}

export function CommandSnapshotCard({
    canonical,
    summary,
    canViewProtectedFeeds,
    hasOpsData,
    hasMissionSnapshot,
    onRefresh,
}: CommandSnapshotCardProps) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Command Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                    <Badge variant={canViewProtectedFeeds ? "secondary" : "destructive"}>
                        {canViewProtectedFeeds ? "feed ready" : "auth required"}
                    </Badge>
                    <Badge variant="outline">storm {canonical?.alerts.stormTier ?? "unknown"}</Badge>
                    <Badge variant="outline">
                        source {hasOpsData ? "ops" : hasMissionSnapshot ? "dashboard" : "polling"}
                    </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded border border-border/70 bg-background/40 p-2">
                        <p className="text-muted-foreground">Solar wind speed</p>
                        <p className="text-lg font-semibold">{formatNumber(canonical?.solarWind.speed, 1)} km/s</p>
                    </div>
                    <div className="rounded border border-border/70 bg-background/40 p-2">
                        <p className="text-muted-foreground">IMF Bz</p>
                        <p className="text-lg font-semibold">{formatNumber(canonical?.magneticField.z, 2)} nT</p>
                    </div>
                    <div className="rounded border border-border/70 bg-background/40 p-2">
                        <p className="text-muted-foreground">Kp index</p>
                        <p className="text-lg font-semibold">{formatNumber(canonical?.indices.kp, 1)}</p>
                    </div>
                    <div className="rounded border border-border/70 bg-background/40 p-2">
                        <p className="text-muted-foreground">Threat gate</p>
                        <p className="text-sm font-semibold">{summary?.gate.action ?? "n/a"}</p>
                    </div>
                </div>

                {!canViewProtectedFeeds && (
                    <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        <div className="mb-2 flex items-center gap-2 font-medium">
                            <AlertTriangle className="h-4 w-4" />
                            Sign in required for protected mission feeds.
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" asChild>
                                <Link to="/heliophysics?auth=1">
                                    <LockKeyhole className="mr-2 h-4 w-4" />
                                    Open Login Portal
                                </Link>
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                                <Link to="/signup">Signup + SSO</Link>
                            </Button>
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={onRefresh}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Refresh snapshot
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                        <Link to="/heliophysics">Open full dashboard</Link>
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
