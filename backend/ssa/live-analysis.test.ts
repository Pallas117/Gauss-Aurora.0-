import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeMemoryPressureSnapshot } from "../runtime/memory-pressure.js";
import {
  buildDeterministicSpaceDomainAnalysis,
  determineSpaceDomainSeverity,
  getSpaceDomainAnalysis,
  primeSpaceDomainHybridBriefForTests,
  resetSpaceDomainAnalysisState,
} from "./live-analysis.js";
import type { SpaceDomainSummary } from "./ssa-features.js";

function nominalMemory(): RuntimeMemoryPressureSnapshot {
  return {
    level: "nominal",
    freeMb: 4096,
    suspendedSubsystems: [],
    svgLiteForced: false,
    signals: ["headroom-healthy"],
    totalRamGb: 8,
    freeRamGb: 4,
    usedRamGb: 4,
    freeRatio: 0.5,
    thresholds: {
      nominalMinFreeMb: 1500,
      criticalMaxFreeMb: 500,
    },
    publicPollMs: 5000,
    protectedPollMs: 10000,
    hiddenPollMs: 30000,
    ceiling: {
      ceilingMb: 5800,
      overCeiling: false,
      checkedAt: new Date("2026-03-11T12:00:00.000Z").toISOString(),
      cacheMs: 2000,
      lastError: null,
    },
  };
}

function constrainedMemory(): RuntimeMemoryPressureSnapshot {
  return {
    ...nominalMemory(),
    level: "constrained",
    freeMb: 900,
    suspendedSubsystems: ["rag-refresh", "optional-enrichers"],
    svgLiteForced: true,
    signals: ["free-mb-constrained"],
  };
}

interface BuildSummaryOverrides {
  updatedAt?: string | null;
  freshness?: Partial<SpaceDomainSummary["freshness"]>;
  availability?: Partial<SpaceDomainSummary["availability"]>;
  counts?: Partial<SpaceDomainSummary["counts"]>;
  crowding?: Partial<SpaceDomainSummary["crowding"]>;
  conjunctionRisk?: Partial<SpaceDomainSummary["conjunctionRisk"]>;
  learnedLane?: Partial<SpaceDomainSummary["learnedLane"]> & {
    features?: Partial<SpaceDomainSummary["learnedLane"]["features"]>;
  };
}

function buildSummary(overrides?: BuildSummaryOverrides): SpaceDomainSummary {
  const base: SpaceDomainSummary = {
    updatedAt: new Date("2026-03-11T12:00:00.000Z").toISOString(),
    freshness: {
      riskZonesAgeSeconds: 8,
      satellitesAgeSeconds: 12,
      conjunctionsAgeSeconds: 18,
    },
    availability: {
      riskZones: true,
      satellites: true,
      conjunctions: true,
    },
    counts: {
      riskZoneCount: 2,
      satelliteObjectCount: 2,
      highValueCount: 1,
      unidentifiedCount: 1,
      conjunctionCount: 1,
    },
    crowding: {
      maxRiskScore: 0.22,
      avgRiskScore: 0.18,
      geoMaxRiskScore: 0.22,
      meoMaxRiskScore: 0.16,
      weightedObjectDensity: 0.14,
      unidentifiedRatio: 0.25,
    },
    conjunctionRisk: {
      maxCollisionProbability: 0.0008,
      minMissDistanceM: 8_400,
      recentCriticalCount: 0,
    },
    learnedLane: {
      modelVersion: "ssa-lane-logreg-v1",
      score: 0.22,
      confidence: 0.76,
      trigger: false,
      threshold: 0.58,
      blend: 0.5,
      features: {
        conjunctionCount: 1,
        maxCollisionProbability: 0.0008,
        inverseMissDistance: 1 / 8_400,
        debrisDensity: 0.14,
        highValueNeighborDensity: 0.31,
        unidentifiedRatio: 0.25,
        geoCrowdingScore: 0.22,
        meoCrowdingScore: 0.16,
        leoCrowdingScore: 0.08,
        tleFreshnessScore: 0.94,
        conjunctionFreshnessScore: 0.91,
        availabilityScore: 1,
      },
      topContributors: [
        { name: "geoCrowdingScore", weight: 0.24, value: 0.22, contribution: 0.05 },
      ],
    },
  };

  return {
    ...base,
    ...overrides,
    freshness: { ...base.freshness, ...(overrides?.freshness ?? {}) },
    availability: { ...base.availability, ...(overrides?.availability ?? {}) },
    counts: { ...base.counts, ...(overrides?.counts ?? {}) },
    crowding: { ...base.crowding, ...(overrides?.crowding ?? {}) },
    conjunctionRisk: {
      ...base.conjunctionRisk,
      ...(overrides?.conjunctionRisk ?? {}),
    },
    learnedLane: {
      ...base.learnedLane,
      ...(overrides?.learnedLane ?? {}),
      features: {
        ...base.learnedLane.features,
        ...(overrides?.learnedLane?.features ?? {}),
      },
      topContributors:
        overrides?.learnedLane?.topContributors ?? base.learnedLane.topContributors,
    },
  };
}

test.beforeEach(() => {
  resetSpaceDomainAnalysisState();
  delete process.env.ORCHESTRATOR_LOCAL_ENGINE_URL;
  delete process.env.GAUSS_BRAIN_URL;
  delete process.env.ORCHESTRATOR_CHAT_MODEL;
});

test("deterministic severity classification follows quiet/watch/warning/critical thresholds", () => {
  assert.equal(determineSpaceDomainSeverity(buildSummary()), "quiet");
  assert.equal(
    determineSpaceDomainSeverity(
      buildSummary({
        crowding: { maxRiskScore: 0.61 },
        learnedLane: { score: 0.47 },
      }),
    ),
    "watch",
  );
  assert.equal(
    determineSpaceDomainSeverity(
      buildSummary({
        conjunctionRisk: { maxCollisionProbability: 0.006 },
        learnedLane: { trigger: true, score: 0.64 },
      }),
    ),
    "warning",
  );
  assert.equal(
    determineSpaceDomainSeverity(
      buildSummary({
        conjunctionRisk: {
          maxCollisionProbability: 0.014,
          recentCriticalCount: 1,
        },
      }),
    ),
    "critical",
  );
});

test("deterministic analysis marks material changes when thresholds are crossed", () => {
  const previous = buildDeterministicSpaceDomainAnalysis(
    buildSummary({
      crowding: { maxRiskScore: 0.42 },
      conjunctionRisk: {
        maxCollisionProbability: 0.001,
        minMissDistanceM: 6_200,
      },
      learnedLane: { score: 0.32 },
    }),
  );

  const next = buildDeterministicSpaceDomainAnalysis(
    buildSummary({
      counts: { conjunctionCount: 3 },
      crowding: { maxRiskScore: 0.62 },
      conjunctionRisk: {
        maxCollisionProbability: 0.0036,
        minMissDistanceM: 4_800,
      },
      learnedLane: { score: 0.44 },
    }),
    previous,
  );

  assert.equal(next.changed, true);
  assert.deepEqual(next.changedSignals.sort(), [
    "collision-probability",
    "conjunction-count",
    "learned-lane-score",
    "miss-distance",
    "severity-bucket",
  ]);
});

test("hybrid model refresh is suppressed when memory pressure is not nominal", async () => {
  let fetchCount = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response("{}");
  }) as typeof fetch;
  process.env.ORCHESTRATOR_LOCAL_ENGINE_URL = "http://127.0.0.1:8088";

  try {
    const analysis = getSpaceDomainAnalysis(
      buildSummary({
        conjunctionRisk: { maxCollisionProbability: 0.008 },
        learnedLane: { trigger: true, score: 0.72 },
      }),
      {
        nowMs: Date.parse("2026-03-11T12:00:00.000Z"),
        memorySnapshot: constrainedMemory(),
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(analysis.source, "deterministic");
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("hybrid brief cache is reused without another model fetch", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response("{}");
  }) as typeof fetch;
  process.env.ORCHESTRATOR_LOCAL_ENGINE_URL = "http://127.0.0.1:8088";
  process.env.ORCHESTRATOR_CHAT_MODEL = "gauss-local";

  try {
    const summary = buildSummary({
      crowding: { maxRiskScore: 0.72 },
      conjunctionRisk: { maxCollisionProbability: 0.0124, recentCriticalCount: 1 },
      learnedLane: { trigger: true, score: 0.84 },
    });
    const deterministic = buildDeterministicSpaceDomainAnalysis(summary);
    primeSpaceDomainHybridBriefForTests({
      analysis: deterministic,
      headline: "Conjunction watch elevated over the public lane",
      summary:
        "Local model confirms an elevated conjunction watch with concentrated crowding near high-value shells.",
      confidence: 0.88,
      nowMs: Date.parse("2026-03-11T12:00:00.000Z"),
    });

    const first = getSpaceDomainAnalysis(summary, {
      nowMs: Date.parse("2026-03-11T12:00:05.000Z"),
      memorySnapshot: nominalMemory(),
      availability: {
        mode: "live",
        lastLiveAt: new Date("2026-03-11T12:00:00.000Z").toISOString(),
        dataAgeSeconds: 5,
        reason: "ok",
        projectionMethod: null,
      },
    });
    assert.equal(first.source, "hybrid");
    assert.equal(first.model.used, true);
    assert.equal(first.model.modelId, "gauss-local");
    assert.match(first.summary, /elevated conjunction watch/i);

    const warmedFetchCount = fetchCount;
    const second = getSpaceDomainAnalysis(summary, {
      nowMs: Date.parse("2026-03-11T12:00:10.000Z"),
      memorySnapshot: nominalMemory(),
      availability: {
        mode: "live",
        lastLiveAt: new Date("2026-03-11T12:00:00.000Z").toISOString(),
        dataAgeSeconds: 10,
        reason: "ok",
        projectionMethod: null,
      },
    });
    assert.equal(second.source, "hybrid");
    assert.equal(fetchCount, warmedFetchCount);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
