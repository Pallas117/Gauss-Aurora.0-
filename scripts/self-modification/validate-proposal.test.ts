import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
const repo = process.cwd();

async function validate(patchText: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gauss-self-modification-"));
  const patchPath = path.join(dir, "proposal.patch");
  const outputPath = path.join(dir, "validation.json");
  await writeFile(patchPath, patchText, "utf8");

  let exitCode = 0;
  try {
    await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      "scripts/self-modification/validate-proposal.ts",
      "--patch",
      patchPath,
      "--out",
      outputPath,
    ], { cwd: repo });
  } catch (error) {
    exitCode = (error as NodeJS.ErrnoException & { code?: number }).code as number;
  }
  return { exitCode, report: JSON.parse(await readFile(outputPath, "utf8")) };
}

test("accepts a small source-only proposal but never marks it apply-ready", async () => {
  const result = await validate([
    "diff --git a/backend/example.ts b/backend/example.ts",
    "--- a/backend/example.ts",
    "+++ b/backend/example.ts",
    "@@ -1 +1 @@",
    "-export const example = 1;",
    "+export const example = 2;",
    "",
  ].join("\n"));

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "candidate_validated");
  assert.equal(result.report.apply_ready, false);
  assert.deepEqual(result.report.changed_files, ["backend/example.ts"]);
});

test("rejects policy and deployment paths", async () => {
  const result = await validate([
    "diff --git a/config/self-modification-policy.json b/config/self-modification-policy.json",
    "--- a/config/self-modification-policy.json",
    "+++ b/config/self-modification-policy.json",
    "@@ -1 +1 @@",
    "-{\"mode\":\"proposal_only\"}",
    "+{\"mode\":\"runtime_apply\"}",
    "",
  ].join("\n"));

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "rejected");
  assert.equal(result.report.apply_ready, false);
  assert.match(result.report.findings.join(" "), /forbidden|outside/);
});

test("rejects traversal paths", async () => {
  const result = await validate([
    "diff --git a/backend/example.ts b/../.env",
    "--- a/backend/example.ts",
    "+++ b/../.env",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "",
  ].join("\n"));

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "rejected");
});
