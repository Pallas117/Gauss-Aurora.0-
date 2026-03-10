import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeMemoryPressure } from "./memory-pressure.js";

test("resolveRuntimeMemoryPressure marks healthy headroom as nominal", () => {
  const snapshot = resolveRuntimeMemoryPressure({
    totalMemBytes: 8 * 1024 * 1024 * 1024,
    freeMemBytes: 4 * 1024 * 1024 * 1024,
    ceiling: {
      ceilingMb: 5800,
      overCeiling: false,
      checkedAt: "2026-03-10T00:00:00.000Z",
      cacheMs: 2000,
      lastError: null,
    },
  });

  assert.equal(snapshot.level, "nominal");
  assert.match(snapshot.signals[0] ?? "", /headroom-healthy/);
});

test("resolveRuntimeMemoryPressure marks low free memory as constrained before ceiling breach", () => {
  const snapshot = resolveRuntimeMemoryPressure({
    totalMemBytes: 8 * 1024 * 1024 * 1024,
    freeMemBytes: Math.round(2.1 * 1024 * 1024 * 1024),
    ceiling: {
      ceilingMb: 5800,
      overCeiling: false,
      checkedAt: "2026-03-10T00:00:00.000Z",
      cacheMs: 2000,
      lastError: null,
    },
  });

  assert.equal(snapshot.level, "constrained");
  assert.ok(
    snapshot.signals.includes("free-mb-constrained") ||
      snapshot.signals.includes("free-ratio-constrained"),
  );
});

test("resolveRuntimeMemoryPressure marks ceiling breach as critical", () => {
  const snapshot = resolveRuntimeMemoryPressure({
    totalMemBytes: 8 * 1024 * 1024 * 1024,
    freeMemBytes: Math.round(2.6 * 1024 * 1024 * 1024),
    ceiling: {
      ceilingMb: 5800,
      overCeiling: true,
      checkedAt: "2026-03-10T00:00:00.000Z",
      cacheMs: 2000,
      lastError: null,
    },
  });

  assert.equal(snapshot.level, "critical");
  assert.ok(snapshot.signals.includes("ceiling-overrun"));
});
