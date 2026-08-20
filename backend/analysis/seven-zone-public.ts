import { buildSevenZoneAssessment, type SevenZoneAssessment } from "./seven-zone.js";
import type { SpaceDomainAvailability } from "../ssa/availability.js";
import type { SpaceDomainSummary } from "../ssa/ssa-features.js";
import type { PublicSpaceDomainSnapshot } from "../ssa/space-domain-public.js";

type MemoryLevel = "nominal" | "constrained" | "critical" | "unknown";

function evidence(source: string, observedAt: string | null, ...provenanceRefs: string[]) {
  return [{ source, observedAt, provenanceRefs, quality: observedAt ? "high" as const : "unknown" as const }];
}

export function buildPublicSevenZoneAssessment(input: {
  generatedAt: string;
  missionId?: string;
  availability: SpaceDomainAvailability;
  snapshot: PublicSpaceDomainSnapshot;
  summary: SpaceDomainSummary;
  memoryLevel: MemoryLevel;
}): SevenZoneAssessment {
  const { availability, snapshot, summary, memoryLevel } = input;
  const observedAt = snapshot.updatedAt ?? availability.lastLiveAt;
  const usable = availability.mode !== "warming";
  const projected = availability.mode === "projected";
  const feedState = usable ? (projected ? "degraded" : "nominal") : "unknown";
  const memoryState = memoryLevel === "critical" ? "degraded" : "nominal";
  const blockers = availability.reason === "ok" ? [] : [`space_domain_${availability.reason}`];

  return buildSevenZoneAssessment({
    assessmentId: `public-space-domain-${input.generatedAt}`,
    generatedAt: input.generatedAt,
    missionId: input.missionId ?? "public-space-domain",
    deploymentScope: "ground_only",
    mode: "environmental_screening",
    qualificationEvidence: false,
    zones: [
      {
        id: "A", name: "Sense", applicability: "required", state: feedState,
        evidence: usable ? evidence("space-domain-store", observedAt, "CCSDS/cFS boundary: not asserted", "space-domain.snapshot") : [],
        reasons: ["Public environmental observation boundary."], blockers,
      },
      {
        id: "B", name: "Interop", applicability: "not_applicable", state: "unknown",
        evidence: [], reasons: ["CCSDS/cFS packet interoperability is not asserted by the public browser feed."], blockers: ["ccsds_cfs_evidence_not_available"],
      },
      {
        id: "C", name: "Buffer", applicability: "required", state: feedState,
        evidence: usable ? evidence("space-domain-store", observedAt, "space-domain.snapshot", "bounded-public-envelope") : [],
        reasons: ["Bounded public snapshot is held or live."], blockers,
      },
      {
        id: "D", name: "Physics", applicability: "required", state: feedState,
        evidence: usable ? evidence("deterministic-space-domain-analysis", summary.updatedAt, "space-domain.summary", "van-allen-screening") : [],
        reasons: ["Physics state is an environmental screen, not a dose or damage result."], blockers,
      },
      {
        id: "E", name: "Analytics", applicability: "required", state: feedState,
        evidence: usable ? evidence("deterministic-space-domain-analysis", summary.updatedAt, "space-domain.analysis") : [],
        reasons: ["Analytics are bounded and deterministic for offline resilience."], blockers,
      },
      {
        id: "F", name: "Mesh", applicability: "not_applicable", state: "unknown",
        evidence: [], reasons: ["Mission mesh and transport health are outside the public environmental endpoint."], blockers: ["mission_mesh_evidence_not_available"],
      },
      {
        id: "G", name: "Ops", applicability: "required", state: memoryState,
        evidence: evidence("aurora-public-api", input.generatedAt, "read-only-advisory-endpoint"),
        reasons: memoryLevel === "critical" ? ["Runtime memory pressure is critical; polling and rendering must remain bounded."] : ["Endpoint is read-only and has no spacecraft command authority."],
        blockers: memoryLevel === "critical" ? ["runtime_memory_critical"] : [],
      },
    ],
  });
}
