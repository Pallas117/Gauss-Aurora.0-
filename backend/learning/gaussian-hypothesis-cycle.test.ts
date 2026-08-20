import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  bayesPosterior,
  runGaussianHypothesisCycle,
  writeGaussianHypothesisReport,
} from "./gaussian-hypothesis-cycle.js";

test("bayesPosterior increases when evidence favors the hypothesis", () => {
  const posterior = bayesPosterior(0.3, 0.8, 0.2);
  assert.ok(posterior > 0.3);
});

test("bayesPosterior decreases when evidence disfavors the hypothesis", () => {
  const posterior = bayesPosterior(0.7, 0.2, 0.8);
  assert.ok(posterior < 0.7);
});

test("gaussian hypothesis cycle falls back deterministically when RAG is unavailable", async () => {
  const report = await runGaussianHypothesisCycle({
    question: "Why did the anomaly score rise?",
    ragUrl: "http://127.0.0.1:9",
  });

  assert.equal(report.mode, "unavailable");
  assert.equal(report.verdict, "need-more-data");
  assert.equal(report.hypotheses.length, 1);
  assert.match(report.nextStep, /Collect more bounded evidence/i);
});

test("writeGaussianHypothesisReport persists the report", () => {
  const dir = mkdtempSync(join(tmpdir(), "gaussian-cycle-"));
  const output = join(dir, "report.json");
  writeGaussianHypothesisReport(
    {
      generatedAt: "2026-03-12T00:00:00.000Z",
      mode: "rag-deterministic",
      question: "Test",
      rag: { ok: true, sourceCount: 1, answer: "Answer", sources: [{ label: "doc", score: 0.9 }] },
      hypotheses: [],
      selectedHypothesisId: null,
      verdict: "need-more-data",
      nextStep: "Observe",
      mathProtocol: [],
      constraints: [],
    },
    output,
  );
  const raw = readFileSync(output, "utf8");
  assert.match(raw, /"question": "Test"/);
});
