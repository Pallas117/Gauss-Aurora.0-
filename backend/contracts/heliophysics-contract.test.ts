import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSourceStatusResponseContract,
  sourceStatusResponseContract,
} from "./heliophysics-contract.js";

test("source status response contract accepts valid payload", () => {
  const payload = {
    timestamp: "2026-02-22T00:00:00.000Z",
    sources: [
      {
        source: "noaa-swpc",
        lastSeen: "2026-02-22T00:00:00.000Z",
        latencySeconds: 5,
        healthy: true,
        overrideDecision: "primary",
        overrideTargetCadenceMs: 15000,
        overrideReason: "incident pin",
        overrideUpdatedAt: "2026-02-22T00:01:00.000Z",
        overrideUpdatedBy: "operator-1",
      },
    ],
    auth: {
      userId: "abc123",
      role: "viewer",
    },
  };

  const parsed = assertSourceStatusResponseContract(payload);
  assert.equal(parsed.sources[0]?.source, "noaa-swpc");
  assert.equal(parsed.sources[0]?.overrideDecision, "primary");
});

test("source status response contract rejects malformed payload", () => {
  const malformed = {
    timestamp: "2026-02-22T00:00:00.000Z",
    sources: [
      {
        source: "noaa-swpc",
        lastSeen: "2026-02-22T00:00:00.000Z",
        latencySeconds: "slow",
        healthy: true,
      },
    ],
    auth: {
      userId: null,
      role: null,
    },
  };

  const result = sourceStatusResponseContract.safeParse(malformed);
  assert.equal(result.success, false);
});
