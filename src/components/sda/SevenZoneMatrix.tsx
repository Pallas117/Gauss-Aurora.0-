import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SevenZoneAssessment, SevenZoneState } from "@/lib/types/seven-zone";

const stateClass: Record<SevenZoneState, string> = {
  nominal: "border-[#CCFF00]/60 bg-[#CCFF00]/10 text-[#CCFF00]",
  degraded: "border-yellow-400/60 bg-yellow-400/10 text-yellow-300",
  unknown: "border-slate-400/60 bg-slate-400/10 text-slate-300",
  blocked: "border-[#FF4D00]/70 bg-[#FF4D00]/10 text-[#FF4D00]",
};

function label(state: SevenZoneState): string {
  return state.replace("_", " ");
}

export function SevenZoneMatrix({ assessment, loading, error }: {
  assessment: SevenZoneAssessment | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Card data-testid="seven-zone-matrix">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Seven-zone advisory</CardTitle>
            <p className="text-xs text-muted-foreground">Environmental screening · read-only · no qualification claim</p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {loading ? "awaiting node" : assessment ? `${label(assessment.aggregateState)} · ${assessment.decision}` : "unknown"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-xs text-[#FF4D00]">Advisory unavailable: {error}</p> : null}
        {loading && !assessment ? <p className="text-xs text-muted-foreground animate-pulse">Awaiting bounded advisory result…</p> : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Seven-zone state matrix">
          {(assessment?.zones ?? []).map((zone) => (
            <div key={zone.id} className={`rounded-md border px-2 py-2 ${stateClass[zone.state]}`}>
              <div className="flex items-center justify-between font-mono text-xs">
                <span>{zone.id} · {zone.name}</span>
                <span aria-label={`${zone.name} ${zone.state}`}>{zone.state === "nominal" ? "OK" : "!"}</span>
              </div>
              <div className="mt-1 text-[10px] uppercase opacity-80">{label(zone.state)} · {zone.applicability.replace("_", " ")}</div>
            </div>
          ))}
        </div>
        {assessment ? (
          <div className="grid gap-1 text-[10px] text-muted-foreground sm:grid-cols-2">
            <p>evidence: {assessment.zones.reduce((count, zone) => count + zone.evidence.length, 0)} records</p>
            <p>generated: {new Date(assessment.generatedAt).toLocaleTimeString()}</p>
            <p className="sm:col-span-2">limits: {assessment.limitations[assessment.limitations.length - 1]}</p>
            {assessment.blockers.length > 0 ? <p className="sm:col-span-2 text-[#FF4D00]">blockers: {assessment.blockers.join(", ")}</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
