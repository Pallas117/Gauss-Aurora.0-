import test from "node:test";
import assert from "node:assert/strict";
import {
  assertMissionCoreSnapshotContract,
  missionCoreSnapshotContract,
} from "./mission-core-contract.js";

test("mission core snapshot contract accepts valid payload", () => {
  const payload = {
    timestamp: "2026-02-22T00:00:00.000Z",
    source: "memory",
    observation: {
      refs: [
        {
          id: "obs-1",
          kind: "space-weather",
          timestamp: "2026-02-22T00:00:00.000Z",
          source: "fusion",
          confidence: 0.9,
          stale: false,
        },
      ],
      canonicalLatest: {
        timestamp: "2026-02-22T00:00:00.000Z",
        source: "fusion",
        alerts: { stormTier: "watch" },
        quality: { stale: false, lowConfidence: false },
      },
      mmsLatest: null,
      auroraLatest: null,
      sourceStatus: [],
      freshness: {
        canonicalAgeSeconds: 4.2,
        mmsAgeSeconds: null,
        auroraAgeSeconds: null,
      },
    },
    tracks: [
      {
        id: "trk-sw",
        type: "space-weather-driver",
        state: "confirmed",
        confidence: 0.85,
        observationIds: ["obs-1"],
        summary: "Solar-wind driver is stable",
      },
    ],
    threats: [
      {
        id: "thr-1",
        type: "solar_flare",
        probability: 0.4,
        confidence_interval: [0.2, 0.5],
        composite_score: 0.32,
        actionable: false,
        recommended_action: "MONITOR SOLAR_FLARE CLOSELY",
      },
    ],
    passes: [
      {
        passId: "pass-1",
        target: "DSCOVR",
        station: "GAUSS-GS-1",
        aos: "2026-02-22T00:05:00.000Z",
        los: "2026-02-22T00:17:00.000Z",
        status: "planned",
        mode: "placeholder",
        priority: 3,
      },
    ],
    commands: [
      {
        commandId: "cmd-1",
        commandType: "trigger-nowcast",
        status: "ready",
        requiresRole: "operator",
        reason: "storm watch",
      },
    ],
    actions: {
      gateAction: "TRIGGER_LLM",
      stormTier: "watch",
      primaryAction: "PREPARE SOLAR_FLARE COUNTERMEASURES",
    },
    auth: {
      role: "operator",
      userId: "abc123",
    },
  };

  const parsed = assertMissionCoreSnapshotContract(payload);
  assert.equal(parsed.observation.refs[0]?.kind, "space-weather");
  assert.equal(parsed.actions.gateAction, "TRIGGER_LLM");
});

test("mission core snapshot contract rejects malformed payload", () => {
  const malformed = {
    timestamp: "2026-02-22T00:00:00.000Z",
    source: "memory",
    observation: {
      refs: [
        {
          id: "obs-1",
          kind: "space-weather",
          timestamp: "2026-02-22T00:00:00.000Z",
          source: "fusion",
          confidence: 1.2,
          stale: false,
        },
      ],
      canonicalLatest: {
        timestamp: "2026-02-22T00:00:00.000Z",
        source: "fusion",
        alerts: { stormTier: "quiet" },
        quality: { stale: false, lowConfidence: false },
      },
      mmsLatest: null,
      auroraLatest: null,
      sourceStatus: [],
      freshness: {
        canonicalAgeSeconds: 2,
        mmsAgeSeconds: null,
        auroraAgeSeconds: null,
      },
    },
    tracks: [],
    threats: [],
    passes: [],
    commands: [],
    actions: {
      gateAction: "TRIGGER_LLM",
      stormTier: "quiet",
      primaryAction: "MONITOR",
    },
    auth: {
      role: null,
      userId: null,
    },
  };

  const result = missionCoreSnapshotContract.safeParse(malformed);
  assert.equal(result.success, false);
});
