export const SEVEN_ZONE_SCHEMA = "gauss-seven-zone-v1" as const;

export const SEVEN_ZONE_IDS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type SevenZoneId = (typeof SEVEN_ZONE_IDS)[number];

export const SEVEN_ZONE_STATES = ["nominal", "degraded", "unknown", "blocked"] as const;
export type SevenZoneState = (typeof SEVEN_ZONE_STATES)[number];

export const SEVEN_ZONE_DECISIONS = ["qualified", "screened", "unknown", "blocked"] as const;
export type SevenZoneDecision = (typeof SEVEN_ZONE_DECISIONS)[number];

export type SevenZoneApplicability = "required" | "advisory" | "not_applicable";
export type SevenZoneMode = "environmental_screening" | "mission_qualification";

export interface SevenZoneEvidence {
  source: string;
  observedAt: string | null;
  provenanceRefs: string[];
  rawPacketId?: string;
  apid?: number;
  sequence?: number;
  quality?: "unknown" | "low" | "high";
  uncertainty?: Record<string, number>;
}

export interface SevenZoneResult {
  id: SevenZoneId;
  name: string;
  applicability: SevenZoneApplicability;
  state: SevenZoneState;
  evidence: SevenZoneEvidence[];
  reasons: string[];
  blockers: string[];
}

export interface SevenZoneAssessmentInput {
  assessmentId: string;
  generatedAt: string;
  missionId: string;
  deploymentScope: "ground_only" | "simulator" | "hosted_payload" | "flight_candidate";
  mode: SevenZoneMode;
  qualificationEvidence: boolean;
  zones: SevenZoneResult[];
}

export interface SevenZoneAssessment extends SevenZoneAssessmentInput {
  schema: typeof SEVEN_ZONE_SCHEMA;
  aggregateState: SevenZoneState;
  decision: SevenZoneDecision;
  blockers: string[];
  limitations: string[];
}

export const SEVEN_ZONE_NAMES: Record<SevenZoneId, string> = {
  A: "Sense",
  B: "Interop",
  C: "Buffer",
  D: "Physics",
  E: "Analytics",
  F: "Mesh",
  G: "Ops",
};

const STATE_RANK: Record<SevenZoneState, number> = {
  nominal: 0,
  degraded: 1,
  unknown: 2,
  blocked: 3,
};

function requiredZones(zones: SevenZoneResult[]): SevenZoneResult[] {
  return zones.filter((zone) => zone.applicability === "required");
}

function aggregateState(zones: SevenZoneResult[]): SevenZoneState {
  return zones.reduce<SevenZoneState>(
    (current, zone) => (STATE_RANK[zone.state] > STATE_RANK[current] ? zone.state : current),
    "nominal",
  );
}

function normalizeZones(zones: SevenZoneResult[]): SevenZoneResult[] {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  return SEVEN_ZONE_IDS.map((id) => {
    const zone = byId.get(id);
    if (zone) return zone;
    return {
      id,
      name: SEVEN_ZONE_NAMES[id],
      applicability: "required",
      state: "unknown",
      evidence: [],
      reasons: ["Zone result was not provided."],
      blockers: [`zone_${id}_missing`],
    };
  }).map((zone) => {
    if (zone.applicability === "not_applicable" || zone.evidence.length > 0 || zone.state !== "nominal") {
      return zone;
    }
    return {
      ...zone,
      state: "unknown" as const,
      reasons: [...zone.reasons, "Nominal state requires at least one evidence record."],
      blockers: [...zone.blockers, `zone_${zone.id}_evidence_missing`],
    };
  });
}

export function buildSevenZoneAssessment(input: SevenZoneAssessmentInput): SevenZoneAssessment {
  const zones = normalizeZones(input.zones);
  const applicable = requiredZones(zones).concat(
    zones.filter((zone) => zone.applicability === "advisory"),
  );
  const state = aggregateState(applicable);
  const blockers = applicable.flatMap((zone) => zone.blockers);
  const decision: SevenZoneDecision =
    state === "blocked"
      ? "blocked"
      : state === "unknown"
        ? "unknown"
        : input.mode === "mission_qualification" && input.qualificationEvidence && state === "nominal"
          ? "qualified"
          : "screened";

  const limitations = [
    "Environmental screening is not a dose, damage, or failure probability.",
    "Qualification requires mission-specific hardware, radiation, and target-boundary evidence.",
  ];
  if (input.mode === "environmental_screening") {
    limitations.push("This assessment cannot produce a qualified decision in environmental-screening mode.");
  }

  return {
    ...input,
    schema: SEVEN_ZONE_SCHEMA,
    zones,
    aggregateState: state,
    decision,
    blockers,
    limitations,
  };
}
