import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveRuntimeMemoryPressure } from "./memory-pressure.js";
import { recordRuntimeLimitContext } from "./limit-context-recorder.js";

function snapshotFor(freeMb: number) {
  return resolveRuntimeMemoryPressure({
    totalMemBytes: 8 * 1024 * 1024 * 1024,
    freeMemBytes: freeMb * 1024 * 1024,
    ceiling: {
      ceilingMb: 5800,
      overCeiling: false,
      checkedAt: new Date().toISOString(),
      cacheMs: 2000,
      lastError: null,
    },
  });
}

test("recordRuntimeLimitContext skips nominal snapshots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-limit-context-"));
  try {
    const result = recordRuntimeLimitContext(snapshotFor(2600), {
      source: "health",
      reportPath: path.join(root, "report.json"),
      ragDocPath: path.join(root, "doc.md"),
    });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, "nominal");
    assert.equal(fs.existsSync(path.join(root, "report.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recordRuntimeLimitContext writes report and RAG markdown for constrained snapshots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-limit-context-"));
  try {
    const reportPath = path.join(root, "report.json");
    const ragDocPath = path.join(root, "doc.md");
    const result = recordRuntimeLimitContext(snapshotFor(900), {
      source: "ops-control",
      detail: { route: "/api/ops/control/workers" },
      reportPath,
      ragDocPath,
      now: new Date("2026-03-12T00:00:00.000Z"),
    });
    assert.equal(result.recorded, true);

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
      eventCount: number;
      lastEvent: { source: string; level: string; detail: { route: string } };
    };
    assert.equal(report.eventCount, 1);
    assert.equal(report.lastEvent.source, "ops-control");
    assert.equal(report.lastEvent.level, "constrained");
    assert.equal(report.lastEvent.detail.route, "/api/ops/control/workers");

    const markdown = fs.readFileSync(ragDocPath, "utf8");
    assert.match(markdown, /Runtime Limit Context Log/);
    assert.match(markdown, /CONSTRAINED/);
    assert.match(markdown, /ops-control/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recordRuntimeLimitContext dedupes repeated identical events within cooldown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-limit-context-"));
  try {
    const reportPath = path.join(root, "report.json");
    const ragDocPath = path.join(root, "doc.md");
    const first = recordRuntimeLimitContext(snapshotFor(200), {
      source: "health",
      reportPath,
      ragDocPath,
      now: new Date("2026-03-12T00:00:00.000Z"),
    });
    const second = recordRuntimeLimitContext(snapshotFor(200), {
      source: "health",
      reportPath,
      ragDocPath,
      now: new Date("2026-03-12T00:05:00.000Z"),
    });
    assert.equal(first.recorded, true);
    assert.equal(second.recorded, false);
    assert.equal(second.reason, "deduped");

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as { eventCount: number };
    assert.equal(report.eventCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recordRuntimeLimitContext preserves non-memory limit kinds with memory context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-limit-context-"));
  try {
    const reportPath = path.join(root, "report.json");
    const ragDocPath = path.join(root, "doc.md");
    recordRuntimeLimitContext(snapshotFor(450), {
      kind: "security",
      source: "cybertiger",
      detail: { status: 429, reason: "rate-limit" },
      reportPath,
      ragDocPath,
      now: new Date("2026-03-12T00:10:00.000Z"),
    });

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
      lastEvent: { kind: string; source: string; detail: { reason: string } };
    };
    assert.equal(report.lastEvent.kind, "security");
    assert.equal(report.lastEvent.source, "cybertiger");
    assert.equal(report.lastEvent.detail.reason, "rate-limit");

    const markdown = fs.readFileSync(ragDocPath, "utf8");
    assert.match(markdown, /SECURITY/);
    assert.match(markdown, /cybertiger/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
