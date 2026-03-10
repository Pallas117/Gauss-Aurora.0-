import assert from "node:assert/strict";
import test from "node:test";
import {
  IngestionWorker,
  resolveChargingFlowMultiplier,
  scaleCadenceForChargingFlow,
} from "./ingest-loop.js";

type WorkerInternals = {
  shouldFetch: (key: string, cadenceMs: number) => boolean;
  couplingWindow: number[];
  trimCouplingWindow: () => void;
  sourceStatus: () => Array<{
    source: string;
    observedCostScore?: number;
    avgFetchDurationMs?: number;
    avgCpuMs?: number;
    avgPayloadKb?: number;
    sampleCount?: number;
  }>;
  recordSourceObservation: (
    source: "noaa-swpc" | "esa-hapi" | "jaxa-erg" | "mms-cdaweb" | "mms-lasp",
    payload: unknown,
    durationMs: number,
    cpuMs: number,
  ) => void;
};

test("throttles NOAA fetches to once per 60s while worker ticks every 5s", () => {
  const worker = new IngestionWorker() as unknown as WorkerInternals;
  const realNow = Date.now;
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  Date.now = () => now;

  try {
    assert.equal(worker.shouldFetch("noaa", 60_000), true);

    for (let i = 0; i < 11; i += 1) {
      now += 5_000;
      assert.equal(
        worker.shouldFetch("noaa", 60_000),
        false,
        "NOAA should not refetch before cadence expires",
      );
    }

    now += 5_000;
    assert.equal(worker.shouldFetch("noaa", 60_000), true);
  } finally {
    Date.now = realNow;
  }
});

test("allows MMS survey fetch on each 5s cadence boundary", () => {
  const worker = new IngestionWorker() as unknown as WorkerInternals;
  const realNow = Date.now;
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  Date.now = () => now;

  try {
    assert.equal(worker.shouldFetch("mms", 5_000), true);
    assert.equal(worker.shouldFetch("mms", 5_000), false);

    now += 4_999;
    assert.equal(worker.shouldFetch("mms", 5_000), false);

    now += 1;
    assert.equal(worker.shouldFetch("mms", 5_000), true);
  } finally {
    Date.now = realNow;
  }
});

test("caps coupling window length to prevent unbounded memory growth", () => {
  const worker = new IngestionWorker() as unknown as WorkerInternals;
  worker.couplingWindow = Array.from({ length: 250 }, (_, i) => i);

  worker.trimCouplingWindow();

  assert.equal(worker.couplingWindow.length, 180);
  assert.equal(worker.couplingWindow[0], 70);
  assert.equal(worker.couplingWindow[179], 249);
});

test("uses low-power cadence profile when POWER_SAVE_MODE=true", () => {
  const original = process.env.POWER_SAVE_MODE;
  process.env.POWER_SAVE_MODE = "true";

  try {
    const worker = new IngestionWorker(undefined) as unknown as WorkerInternals & {
      cadence: { tickMs: number; noaaMs: number; auroraNside: number };
    };

    assert.equal(worker.cadence.tickMs, 10_000);
    assert.equal(worker.cadence.noaaMs, 120_000);
    assert.equal(worker.cadence.auroraNside, 32);
  } finally {
    if (original === undefined) {
      delete process.env.POWER_SAVE_MODE;
    } else {
      process.env.POWER_SAVE_MODE = original;
    }
  }
});

test("low-power powerProfile option sets cadence to LOW_POWER_CADENCE values", () => {
  const worker = new IngestionWorker(undefined, {
    powerProfile: "low-power",
  }) as unknown as WorkerInternals & {
    cadence: {
      tickMs: number;
      noaaMs: number;
      esaMs: number;
      mmsMs: number;
      cleanupMs: number;
      auroraNside: number;
    };
  };

  assert.equal(worker.cadence.tickMs, 10_000);
  assert.equal(worker.cadence.noaaMs, 120_000);
  assert.equal(worker.cadence.esaMs, 30_000);
  assert.equal(worker.cadence.mmsMs, 10_000);
  assert.equal(worker.cadence.cleanupMs, 20_000);
  assert.equal(worker.cadence.auroraNside, 32);
});

test("supports explicit cadence overrides for constrained deployments", () => {
  const worker = new IngestionWorker(undefined, {
    cadence: {
      tickMs: 15_000,
      auroraNside: 16,
    },
  }) as unknown as WorkerInternals & {
    cadence: { tickMs: number; auroraNside: number };
  };

  assert.equal(worker.cadence.tickMs, 15_000);
  assert.equal(worker.cadence.auroraNside, 16);
});

test("charging-flow multiplier increases when battery is discharging near 40%", () => {
  const multiplier = resolveChargingFlowMultiplier({
    percent: 40,
    charging: false,
    powerSource: "battery",
    status: "discharging",
  });
  assert.equal(multiplier, 2.5);
});

test("recharge-first mode is more conservative than balanced", () => {
  const balanced = resolveChargingFlowMultiplier(
    {
      percent: 40,
      charging: false,
      powerSource: "battery",
      status: "discharging",
    },
    "balanced",
  );
  const rechargeFirst = resolveChargingFlowMultiplier(
    {
      percent: 40,
      charging: false,
      powerSource: "battery",
      status: "discharging",
    },
    "recharge-first",
  );
  assert.ok(rechargeFirst > balanced);
  assert.equal(rechargeFirst, 3);
});

test("performance mode is less conservative than balanced", () => {
  const balanced = resolveChargingFlowMultiplier(
    {
      percent: 40,
      charging: false,
      powerSource: "battery",
      status: "discharging",
    },
    "balanced",
  );
  const performance = resolveChargingFlowMultiplier(
    {
      percent: 40,
      charging: false,
      powerSource: "battery",
      status: "discharging",
    },
    "performance",
  );
  assert.ok(performance < balanced);
  assert.equal(performance, 2);
});

test("charging-flow scaling widens cadence and lowers aurora nside under heavy drain", () => {
  const scaled = scaleCadenceForChargingFlow(
    {
      tickMs: 10_000,
      noaaMs: 120_000,
      esaMs: 30_000,
      jaxaMs: 120_000,
      mmsMs: 10_000,
      laspMs: 120_000,
      sourceHealthMs: 30_000,
      cleanupMs: 20_000,
      debrisMs: 6 * 60 * 60 * 1000,
      auroraNside: 32,
    },
    3
  );
  assert.equal(scaled.tickMs, 30_000);
  assert.equal(scaled.noaaMs, 360_000);
  assert.equal(scaled.auroraNside, 16);
});

test("records observed source runtime cost metrics for later policy decisions", () => {
  const worker = new IngestionWorker() as unknown as WorkerInternals;

  worker.recordSourceObservation(
    "esa-hapi",
    { rows: Array.from({ length: 8 }, (_, index) => ({ index, field: "x".repeat(80) })) },
    4200,
    88,
  );

  const esaStatus = worker.sourceStatus().find((entry) => entry.source === "esa-hapi");
  assert.ok(esaStatus);
  assert.equal(esaStatus?.sampleCount, 1);
  assert.equal(esaStatus?.avgFetchDurationMs, 4200);
  assert.equal(esaStatus?.avgCpuMs, 88);
  assert.ok((esaStatus?.avgPayloadKb ?? 0) > 0);
  assert.ok((esaStatus?.observedCostScore ?? 0) > 0);
});
