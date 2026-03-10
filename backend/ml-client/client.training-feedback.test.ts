import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inferNowcast } from "./client.js";
import type { CanonicalSpaceWeatherPoint, NowcastInferenceRequest } from "../types.js";

function point(
  timestamp: string,
  overrides: Partial<CanonicalSpaceWeatherPoint> = {},
): CanonicalSpaceWeatherPoint {
  return {
    timestamp,
    source: "fusion",
    rho: 7,
    velocity: { x: -610, y: 21, z: -4, magnitude: 610 },
    magneticField: { x: 2.2, y: -1.7, z: -13.8, bt: 14.4 },
    electricField: { x: 0.1, y: 4.8, z: 0.3, ey: 4.8 },
    solarWind: { speed: 690, density: 13, dynamicPressure: 6.8 },
    indices: { kp: 7, dst: -120 },
    coupling: { newell: 12800, epsilon: 9.0e11 },
    propagation: {
      l1DelaySeconds: 1600,
      etaEarthArrival: new Date(Date.parse(timestamp) + 1_600_000).toISOString(),
    },
    alerts: { stormTier: "severe", reason: "regression-test" },
    quality: {
      outlier: false,
      stale: false,
      interpolated: false,
      extrapolated: false,
      lowConfidence: false,
    },
    uncertainty: {
      speed: { lower: 650, upper: 720, sigma: 18 },
      density: { lower: 11, upper: 15, sigma: 0.8 },
      bz: { lower: -15.2, upper: -12.7, sigma: 0.7 },
    },
    ...overrides,
  };
}

function req(sequence: CanonicalSpaceWeatherPoint[]): NowcastInferenceRequest {
  return {
    horizonMinutes: 60,
    sequence,
  };
}

test("train_unet output updates nowcast inference behavior via model registry", async (t) => {
  const pyCheck = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (pyCheck.status !== 0) {
    t.skip("python3 is required for training-feedback regression");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-train-feedback-"));
  const datasetPath = path.join(tmpDir, "train_dataset.jsonl");
  const registryPath = path.join(tmpDir, "registry.json");
  const learnedVersion = "unet-learning-regression-v1";

  const syntheticRows = [
    { x: [[1, 2, 3]], y: [420, 0.91], timestamp: "2026-03-05T00:00:00Z" },
    { x: [[2, 3, 4]], y: [460, 0.94], timestamp: "2026-03-05T00:05:00Z" },
    { x: [[3, 4, 5]], y: [510, 0.97], timestamp: "2026-03-05T00:10:00Z" },
    { x: [[4, 5, 6]], y: [470, 0.93], timestamp: "2026-03-05T00:15:00Z" },
  ];
  fs.writeFileSync(datasetPath, syntheticRows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");

  const originalInferUrl = process.env.LOCAL_INFER_URL;
  const originalGate = process.env.GAUSS_PREINFERENCE_GATE_ENABLED;
  const originalRegistryPath = process.env.NOWCAST_MODEL_REGISTRY_PATH;

  try {
    delete process.env.LOCAL_INFER_URL;
    process.env.GAUSS_PREINFERENCE_GATE_ENABLED = "true";
    delete process.env.NOWCAST_MODEL_REGISTRY_PATH;

    const sequence = [point("2026-03-05T00:00:00.000Z")];
    const baseline = await inferNowcast(req(sequence));
    assert.equal(baseline.modelVersion, "unet-baseline-v1");

    const train = spawnSync(
      "python3",
      [
        "ml/train/train_unet.py",
        "--dataset",
        datasetPath,
        "--registry",
        registryPath,
        "--model-version",
        learnedVersion,
        "--epochs",
        "2",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    assert.equal(train.status, 0, train.stderr || train.stdout);

    process.env.NOWCAST_MODEL_REGISTRY_PATH = registryPath;
    const learned = await inferNowcast(req(sequence));
    assert.equal(learned.modelVersion, learnedVersion);
    assert.equal(learned.predictions.length, baseline.predictions.length);

    const perturbationDelta = Math.abs(
      learned.predictions[0].geomagneticPerturbation - baseline.predictions[0].geomagneticPerturbation,
    );
    const auroraDelta = Math.abs(
      learned.predictions[0].auroraIntensity - baseline.predictions[0].auroraIntensity,
    );

    assert.ok(
      perturbationDelta > 1e-3 || auroraDelta > 1e-4,
      `expected learned inference to change output, got perturbationDelta=${perturbationDelta}, auroraDelta=${auroraDelta}`,
    );
  } finally {
    process.env.LOCAL_INFER_URL = originalInferUrl;
    process.env.GAUSS_PREINFERENCE_GATE_ENABLED = originalGate;
    process.env.NOWCAST_MODEL_REGISTRY_PATH = originalRegistryPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

