import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import type {
  PublicSpaceDomainSnapshot,
  SatelliteObjectsSnapshotResponse,
  SpaceDomainResponse,
  SpaceDomainSummary,
} from "@/lib/types/space-weather";
import type { RiskZonePoint } from "@/lib/types/radiation";
import { withVisualizationPriority } from "@/lib/visual-priority";

function toRiskZonePoint(
  zone: NonNullable<PublicSpaceDomainSnapshot["riskZones"]>["riskZones"][number],
): RiskZonePoint {
  return withVisualizationPriority({
    orbitType: zone.orbitType,
    altitude: zone.altitudeKm,
    latitude: zone.latitudeDeg,
    longitude: zone.longitudeDeg,
    riskScore: zone.riskScore,
    objectCount: zone.objectCount,
    timestamp: undefined,
  });
}

export function useSpaceDomainSnapshot(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const mission = useMissionSnapshot();
  const data = enabled ? mission.snapshot?.spaceDomain ?? null : null;
  const snapshot: PublicSpaceDomainSnapshot | null = data?.snapshot ?? null;
  const summary: SpaceDomainSummary | null = data?.summary ?? null;
  const riskZones = snapshot?.riskZones?.riskZones.map(toRiskZonePoint) ?? [];
  const satellites: SatelliteObjectsSnapshotResponse | null = snapshot?.satellites ?? null;
  const conjunctions = snapshot?.conjunctions ?? { updatedAt: null, count: 0 };

  return {
    data: data as SpaceDomainResponse | null,
    snapshot,
    summary,
    riskZones,
    satellites,
    conjunctions,
    loading: enabled ? mission.loading : false,
    error: enabled ? mission.error : null,
    refresh: enabled ? mission.refresh : async () => {},
  };
}
