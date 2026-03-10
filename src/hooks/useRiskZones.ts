import { useSpaceDomainSnapshot } from "@/hooks/useSpaceDomainSnapshot";
import type { RiskZonePoint } from "@/lib/types/radiation";

export function useRiskZones(options?: { enabled?: boolean }) {
  const state = useSpaceDomainSnapshot(options);
  return {
    riskZones: state.riskZones as RiskZonePoint[],
    loading: state.loading,
    error: state.error,
    refresh: state.refresh,
  };
}
