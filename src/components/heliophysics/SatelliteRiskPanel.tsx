import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CanonicalSpaceWeatherPoint } from "@/lib/types/space-weather";

export function SatelliteRiskPanel({ canonicalPoint }: { canonicalPoint: CanonicalSpaceWeatherPoint | null }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Satellite risk</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{canonicalPoint ? "Environmental inputs available; screening remains advisory." : "Awaiting environmental inputs."}</CardContent></Card>;
}
