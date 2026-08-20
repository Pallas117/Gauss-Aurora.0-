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
  assert.equal(snapshot.svgLiteForced, false);
  assert.equal(snapshot.freeMb > 1500, true);
  assert.match(snapshot.signals[0] ?? "", /headroom-healthy/);
});

test("resolveRuntimeMemoryPressure marks 500MB-1.5GB headroom as constrained", () => {
  const snapshot = resolveRuntimeMemoryPressure({
    totalMemBytes: 8 * 1024 * 1024 * 1024,
    freeMemBytes: 900 * 1024 * 1024,
    ceiling: {
      ceilingMb: 5800,
      overCeiling: false,
      checkedAt: "2026-03-10T00:00:00.000Z",
      cacheMs: 2000,
      lastError: null,
    },
  });

  assert.equal(snapshot.level, "constrained");
  assert.equal(snapshot.svgLiteForced, true);
  assert.ok(snapshot.signals.includes("free-mb-constrained"));
});

test("resolveRuntimeMemoryPressure marks sub-500MB free headroom as critical", () => {
  const snapshot = resolveRuntimeMemoryPressure({
    totalMemBytes: 8 * 1024 * 1024 * 1024,
    freeMemBytes: 420 * 1024 * 1024,
    ceiling: {
      ceilingMb: 5800,
      overCeiling: false,
      checkedAt: "2026-03-10T00:00:00.000Z",
      cacheMs: 2000,
      lastError: null,
    },
  });

  assert.equal(snapshot.level, "critical");
  assert.ok(snapshot.signals.includes("free-mb-critical"));
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
