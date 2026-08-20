import assert from "node:assert/strict";
import test from "node:test";
import { buildSevenZoneAssessment, SEVEN_ZONE_IDS, type SevenZoneResult } from "./seven-zone";

function zone(id: SevenZoneResult["id"], state: SevenZoneResult["state"] = "nominal"): SevenZoneResult {
  return {
    id,
    name: id,
    applicability: "required",
    state,
    evidence: [{ source: "replay", observedAt: "2026-08-19T00:00:00Z", provenanceRefs: [`packet-${id}`] }],
    reasons: [],
    blockers: state === "nominal" ? [] : [`${id.toLowerCase()}_${state}`],
  };
}

function input(overrides: Partial<Parameters<typeof buildSevenZoneAssessment>[0]> = {}) {
  return {
    assessmentId: "assessment-1",
    generatedAt: "2026-08-19T00:00:00Z",
    missionId: "mission-1",
    deploymentScope: "simulator" as const,
    mode: "environmental_screening" as const,
    qualificationEvidence: false,
    zones: SEVEN_ZONE_IDS.map((id) => zone(id)),
    ...overrides,
  };
}

test("seven-zone assessment normalizes missing zones to unknown and fails closed", () => {
    const result = buildSevenZoneAssessment(input({ zones: [zone("A")] }));

    assert.equal(result.zones.length, 7);
    assert.equal(result.aggregateState, "unknown");
    assert.equal(result.decision, "unknown");
    assert.ok(result.blockers.includes("zone_B_missing"));
});

test("blocked evidence has precedence over unknown and degraded evidence", () => {
    const result = buildSevenZoneAssessment(input({
      zones: SEVEN_ZONE_IDS.map((id) => zone(id, id === "F" ? "blocked" : id === "E" ? "unknown" : "degraded")),
    }));

    assert.equal(result.aggregateState, "blocked");
    assert.equal(result.decision, "blocked");
});

test("environmental screening never claims qualification", () => {
    const result = buildSevenZoneAssessment(input({ qualificationEvidence: true }));

    assert.equal(result.aggregateState, "nominal");
    assert.equal(result.decision, "screened");
});

test("mission qualification requires explicit evidence and nominal required zones", () => {
    const result = buildSevenZoneAssessment(input({
      mode: "mission_qualification",
      deploymentScope: "flight_candidate",
      qualificationEvidence: true,
    }));

    assert.equal(result.decision, "qualified");
});

test("nominal zones without evidence are downgraded to unknown", () => {
  const result = buildSevenZoneAssessment(input({
    zones: SEVEN_ZONE_IDS.map((id) => ({ ...zone(id), evidence: [] })),
  }));

  assert.equal(result.aggregateState, "unknown");
  assert.ok(result.blockers.includes("zone_A_evidence_missing"));
});
