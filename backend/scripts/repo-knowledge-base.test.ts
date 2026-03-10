import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRepoKnowledgeBaseReport, buildRepoKnowledgeDigest } from "./repo-knowledge-base.js";

test("repo knowledge base prioritizes trusted docs and flags missing datasets", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-repo-knowledge-"));
  try {
    fs.mkdirSync(path.join(rootDir, "research/documentation-rag/foundational-axioms"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "reports/network"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "backend"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "ml/models"), { recursive: true });

    fs.writeFileSync(
      path.join(rootDir, "research/documentation-rag/foundational-axioms", "gauss-steward-identity.md"),
      "# identity\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "research/documentation-rag", ".gauss-doc-trust-overrides.json"),
      JSON.stringify(
        {
          documents: {
            "foundational-axioms/gauss-steward-identity.md": {
              approvalStatus: "approved",
              redactionStatus: "ready",
              sensitivity: "public",
              owner: "gauss",
              retentionPolicy: "living_reference",
              reasons: ["Approved foundational identity reference."],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(path.join(rootDir, "reports/network", "connectivity-feed.jsonl"), "{}\n", "utf8");
    fs.writeFileSync(path.join(rootDir, "backend", "server.ts"), "export const ok = true;\n", "utf8");
    fs.writeFileSync(
      path.join(rootDir, "ml/models", "registry.json"),
      JSON.stringify(
        {
          models: [
            {
              dataset: "ml/data/train_dataset.jsonl",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const report = buildRepoKnowledgeBaseReport(rootDir);
    const digest = buildRepoKnowledgeDigest(report);

    assert.ok(report.prioritySources.some((file) => file.path.endsWith("gauss-steward-identity.md") && file.indexAllowed));
    assert.ok(report.prioritySources.some((file) => file.path.endsWith("connectivity-feed.jsonl") && file.kind === "dataset"));
    assert.ok(report.missingAssets.some((asset) => asset.path === "ml/data/train_dataset.jsonl"));
    assert.match(digest, /Trusted Foundational and Mission Documents/);
    assert.match(digest, /Connected Datasets and Telemetry Artifacts/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
