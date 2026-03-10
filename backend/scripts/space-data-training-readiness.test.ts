import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSpaceDataTrainingReadinessReport } from "./space-data-training-readiness.js";

test("training readiness reports ready_for_offload for a valid dataset and holdout", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-training-readiness-"));
  try {
    const datasetPath = path.join(rootDir, "train_dataset.jsonl");
    const holdoutPath = datasetPath.replace(/\.jsonl$/i, ".holdout.jsonl");
    const registryPath = path.join(rootDir, "registry.json");

    const rows = Array.from({ length: 300 }, (_, index) =>
      JSON.stringify({
        x: Array.from({ length: 24 }, () => Array.from({ length: 11 }, (__, featureIndex) => featureIndex + index)),
        y: [index * 0.1, 0.5],
        timestamp: new Date(Date.UTC(2026, 2, 7, 0, index)).toISOString(),
      }),
    ).join("\n");

    fs.writeFileSync(datasetPath, `${rows}\n`, "utf8");
    fs.writeFileSync(holdoutPath, `${rows.split("\n").slice(0, 24).join("\n")}\n`, "utf8");
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        {
          models: [
            {
              version: "unet-ready-v2",
              trained_at: "2026-03-07T12:00:00Z",
              status: "ready",
              dataset: datasetPath,
              metrics: { samples: 300 },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const report = buildSpaceDataTrainingReadinessReport(registryPath);
    assert.equal(report.readiness, "ready_for_offload");
    assert.equal(report.dataset.validRows, 300);
    assert.equal(report.dataset.holdoutExists, true);
    assert.equal(report.latestReadyModel.samples, 300);
    assert.equal(report.blockers.length, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("training readiness reports blocked when dataset is missing", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-training-readiness-missing-"));
  try {
    const registryPath = path.join(rootDir, "registry.json");
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        {
          models: [
            {
              version: "unet-baseline-v1",
              trained_at: "2026-03-07T12:00:00Z",
              status: "ready",
              dataset: path.join(rootDir, "missing.jsonl"),
              metrics: { samples: 0 },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const report = buildSpaceDataTrainingReadinessReport(registryPath);
    assert.equal(report.readiness, "blocked");
    assert.ok(report.blockers.includes("Training dataset is missing."));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
