export type SevenZoneId = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type SevenZoneState = "nominal" | "degraded" | "unknown" | "blocked";
export type SevenZoneDecision = "qualified" | "screened" | "unknown" | "blocked";
export type SevenZoneApplicability = "required" | "advisory" | "not_applicable";

export interface SevenZoneEvidence {
  source: string;
  observedAt: string | null;
  provenanceRefs: string[];
  quality?: "unknown" | "low" | "high";
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

export interface SevenZoneAssessment {
  schema: "gauss-seven-zone-v1";
  assessmentId: string;
  generatedAt: string;
  missionId: string;
  deploymentScope: "ground_only" | "simulator" | "hosted_payload" | "flight_candidate";
  mode: "environmental_screening" | "mission_qualification";
  qualificationEvidence: boolean;
  zones: SevenZoneResult[];
  aggregateState: SevenZoneState;
  decision: SevenZoneDecision;
  blockers: string[];
  limitations: string[];
}
