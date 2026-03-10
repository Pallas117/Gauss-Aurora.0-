import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CanonicalSpaceWeatherPoint } from "@/lib/types/space-weather";

interface TelemetryStreamCardProps {
    telemetryRows: CanonicalSpaceWeatherPoint[];
    error?: string | null;
}

export function TelemetryStreamCard({ telemetryRows, error }: TelemetryStreamCardProps) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Live 5s Telemetry Stream</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
                {error ? <p className="text-destructive">{error}</p> : null}
                {telemetryRows.length === 0 ? (
                    <p className="text-muted-foreground">No stream data yet.</p>
                ) : (
                    <div className="max-h-[340px] overflow-auto rounded border border-border/70">
                        <table className="w-full border-collapse">
                            <thead className="sticky top-0 bg-background text-[11px]">
                                <tr className="border-b border-border/70">
                                    <th className="px-2 py-1 text-left">Time</th>
                                    <th className="px-2 py-1 text-right">Speed</th>
                                    <th className="px-2 py-1 text-right">Density</th>
                                    <th className="px-2 py-1 text-right">Bz</th>
                                </tr>
                            </thead>
                            <tbody>
                                {telemetryRows.map((point) => (
                                    <tr key={point.timestamp} className="border-b border-border/40">
                                        <td className="px-2 py-1">{new Date(point.timestamp).toLocaleTimeString()}</td>
                                        <td className="px-2 py-1 text-right">{point.solarWind.speed.toFixed(1)}</td>
                                        <td className="px-2 py-1 text-right">{point.solarWind.density.toFixed(2)}</td>
                                        <td className="px-2 py-1 text-right">{point.magneticField.z.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
