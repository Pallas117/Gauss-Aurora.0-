import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildSevenZoneAssessment, SEVEN_ZONE_IDS, SEVEN_ZONE_NAMES, type SevenZoneState } from "./seven-zone.js";

type ReplayManifest = {
  schema: string;
  cases: Array<{
    id: string;
    rustFixture: string | null;
    zoneStates: Record<string, SevenZoneState>;
    expectedAggregate: SevenZoneState;
    expectedDecision: string;
  }>;
};

const manifestPath = resolve(process.cwd(), "services/yamcs-replay/fixtures/gauss-seven-zone-replay.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReplayManifest;

test("offline seven-zone replay fixtures fail closed and preserve expected decisions", () => {
  assert.equal(manifest.schema, "gauss-seven-zone-replay-v1");
  assert.equal(manifest.cases.length, 8);

  for (const replayCase of manifest.cases) {
    const assessment = buildSevenZoneAssessment({
      assessmentId: replayCase.id,
      generatedAt: "2026-08-19T00:00:00Z",
      missionId: "GAUSS-TEST-01",
      deploymentScope: "simulator",
      mode: "environmental_screening",
      qualificationEvidence: false,
      zones: SEVEN_ZONE_IDS.map((id) => ({
        id,
        name: SEVEN_ZONE_NAMES[id],
        applicability: id === "B" || id === "F" ? "not_applicable" as const : "required" as const,
        state: replayCase.zoneStates[id] ?? "unknown",
        evidence: [{ source: "offline-replay", observedAt: "2026-08-19T00:00:00Z", provenanceRefs: [`replay:${replayCase.id}`] }],
        reasons: [replayCase.id],
        blockers: replayCase.expectedDecision === "blocked" ? [`replay_${replayCase.id}`] : [],
      })),
    });

    assert.equal(assessment.aggregateState, replayCase.expectedAggregate, replayCase.id);
    assert.equal(assessment.decision, replayCase.expectedDecision, replayCase.id);
    if (replayCase.expectedDecision !== "screened") {
      assert.notEqual(assessment.decision, "qualified", replayCase.id);
    }
  }
});
