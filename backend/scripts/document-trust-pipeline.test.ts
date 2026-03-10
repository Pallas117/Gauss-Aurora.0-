import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTrustManifest } from "./document-trust-pipeline.js";

test("document trust manifest only index-allows explicitly approved safe docs", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "gauss-doc-trust-"));
  try {
    fs.mkdirSync(path.join(rootDir, "spacecraft-ops-probability"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "Gauss Mainframe", ".obsidian"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "page_files"), { recursive: true });

    fs.writeFileSync(
      path.join(rootDir, "spacecraft-ops-probability", "mission-ethics-and-voice.md"),
      "# ethics\ntrusted content\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "Gauss Mainframe", ".obsidian", "workspace.json"),
      "{\"workspace\":true}\n",
      "utf8",
    );
    fs.writeFileSync(path.join(rootDir, "Vulnerability Assesment of GPS.pdf"), "pdf placeholder", "utf8");
    fs.writeFileSync(path.join(rootDir, "page_files", "asset.js"), "console.log('asset');\n", "utf8");

    fs.writeFileSync(
      path.join(rootDir, ".gauss-doc-trust-overrides.json"),
      JSON.stringify(
        {
          documents: {
            "spacecraft-ops-probability/mission-ethics-and-voice.md": {
              approvalStatus: "approved",
              redactionStatus: "ready",
              sensitivity: "public",
              owner: "gauss",
              retentionPolicy: "living_reference",
              reasons: ["Approved curated ethics reference."],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const manifest = buildTrustManifest(rootDir);
    const approved = manifest.documents.find(
      (document) => document.path === "spacecraft-ops-probability/mission-ethics-and-voice.md",
    );
    const obsidian = manifest.documents.find(
      (document) => document.path === "Gauss Mainframe/.obsidian/workspace.json",
    );
    const sensitivePdf = manifest.documents.find(
      (document) => document.path === "Vulnerability Assesment of GPS.pdf",
    );

    assert.ok(approved);
    assert.equal(approved?.indexAllowed, true);
    assert.equal(approved?.approvalStatus, "approved");

    assert.ok(obsidian);
    assert.equal(obsidian?.indexAllowed, false);
    assert.equal(obsidian?.indexDecision, "skip");

    assert.ok(sensitivePdf);
    assert.equal(sensitivePdf?.supported, true);
    assert.equal(sensitivePdf?.indexAllowed, false);
    assert.equal(sensitivePdf?.approvalStatus, "needs_review");

    assert.equal(manifest.totals.indexAllowed, 1);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
