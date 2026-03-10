import assert from "node:assert/strict";
import test from "node:test";
import {
  ProbabilityFusionEngine,
  SpaceProbabilityEngine,
  type ExternalDataBundle,
  type TelemetryBundle,
} from "./probability-fusion.js";

function sampleInputs(): { telemetry: TelemetryBundle; external: ExternalDataBundle } {
  return {
    telemetry: {
      orbital: {
        position: [7000, 0, 0],
        velocity: [0, 7.5, 0],
        position_uncertainty: 0.15,
      },
      network: {
        packet_rate: 350,
        connection_attempts: 23,
        entropy: 5.2,
      },
    },
    external: {
      space_track: {
        objects: [
          { position: [7010, 1.2, -0.5], velocity: [0.1, -7.3, 0.2] },
          { position: [6985, -2.1, 1.8], velocity: [-0.2, 7.0, 0.1] },
        ],
        historical_conjunction_rate: 0.08,
      },
      solar: {
        complexity: 4.2,
        magnetic_field: 320,
        history: 0.25,
      },
      debris: {
        objects: [
          { position: [7010, 1.2, -0.5] },
          { position: [6985, -2.1, 1.8] },
        ],
        density: 0.03,
      },
    },
  };
}

test("assessAllThreats returns modeled threats with confidence intervals", () => {
  const { telemetry, external } = sampleInputs();
  const engine = new ProbabilityFusionEngine();

  const threats = engine.assessAllThreats(telemetry, external);
  assert.equal(threats.length, 4);
  for (const threat of threats) {
    assert.ok(threat.probability >= 0.01 && threat.probability <= 0.99);
    assert.ok(threat.confidence_interval[0] >= 0 && threat.confidence_interval[1] <= 1);
    assert.ok(threat.factors.length > 0);
  }
});

test("fuseThreats sorts by descending composite score and includes actions", () => {
  const { telemetry, external } = sampleInputs();
  const engine = new ProbabilityFusionEngine();
  const threats = engine.assessAllThreats(telemetry, external);

  const fused = engine.fuseThreats(threats);
  assert.equal(fused.length, 4);
  for (let i = 1; i < fused.length; i += 1) {
    assert.ok(fused[i - 1].composite_score >= fused[i].composite_score);
  }
  assert.ok(fused[0].recommended_action.length > 0);
});

test("SpaceProbabilityEngine returns frontend-ready threat rows", () => {
  const { telemetry, external } = sampleInputs();
  const engine = new SpaceProbabilityEngine();

  const result = engine.processTelemetry(telemetry, external);
  assert.ok(Array.isArray(result.threats));
  assert.equal(result.threats.length, 4);
  const first = result.threats[0];
  assert.ok(typeof first.id === "string" && first.id.length > 0);
  assert.ok(typeof first.type === "string");
  assert.ok(Array.isArray(first.factors));
  assert.ok(typeof first.actionable === "boolean");
  assert.ok(typeof first.recommended_action === "string");
});

test("reported conjunction evidence increases collision risk", () => {
  const { telemetry, external } = sampleInputs();
  const engine = new ProbabilityFusionEngine();

  const baseline = engine.assessAllThreats(telemetry, external).find((threat) => threat.threat_type === "collision");
  const elevated = engine
    .assessAllThreats(telemetry, {
      ...external,
      space_track: {
        ...external.space_track,
        max_probability_of_collision: 0.02,
        min_miss_distance_m: 250,
      },
    })
    .find((threat) => threat.threat_type === "collision");

  assert.ok(baseline);
  assert.ok(elevated);
  assert.ok((elevated?.probability ?? 0) > (baseline?.probability ?? 0));
});
