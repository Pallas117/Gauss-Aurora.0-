import type { SpaceDomainSnapshot } from "./space-domain-store.js";
import type { SpaceDomainAvailability } from "./availability.js";
import type { SpaceDomainAnalysis } from "./live-analysis.js";
import type { SpaceDomainSummary } from "./ssa-features.js";

export interface PublicSpaceDomainSnapshot {
  updatedAt: string | null;
  riskZones: SpaceDomainSnapshot["riskZones"];
  satellites: SpaceDomainSnapshot["satellites"];
  conjunctions: {
    updatedAt: string | null;
    count: number;
  };
}

export interface PublicSpaceDomainEnvelope {
  snapshot: PublicSpaceDomainSnapshot;
  availability: SpaceDomainAvailability;
  summary: SpaceDomainSummary;
  analysis: SpaceDomainAnalysis;
}

export function toPublicSpaceDomainSnapshot(
  snapshot: SpaceDomainSnapshot,
): PublicSpaceDomainSnapshot {
  return {
    updatedAt: snapshot.updatedAt,
    riskZones: snapshot.riskZones,
    satellites: snapshot.satellites,
    conjunctions: {
      updatedAt: snapshot.conjunctions.updatedAt,
      count: snapshot.conjunctions.events.length,
    },
  };
}
