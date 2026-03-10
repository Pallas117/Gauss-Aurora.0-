/**
 * Scan backend/frontend for lint (tsc) issues and write a JSON report for the
 * orchestrator work-queue merge. Run from repo root. Exit 0 so caller can always
 * read the output file (empty array when no issues).
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPORT_DIR = "reports/progress";
const OUTPUT_JSON = path.join(REPORT_DIR, "backend-lint-issues.json");

export type LintIssue = {
  file: string;
  line: number;
  column?: number;
  message: string;
  severity: "error" | "warning";
};

// tsc --noEmit typically: "file(line,col): error TSxxxx: message" or "file: line: col - error TSxxxx: message"
const TSC_LINE =
  /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+TS\d+:\s*(.+)$/;
const TSC_LINE_ALT = /^(.+?):\s*(\d+):\s*(\d+)\s*-\s*(error|warning)\s+TS\d+:\s*(.+)$/;

function parseTscStderr(stderr: string): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const line of stderr.split("\n")) {
    const t = line.trim();
    let m = TSC_LINE.exec(t);
    if (m) {
      issues.push({
        file: m[1].trim(),
        line: parseInt(m[2], 10),
        column: parseInt(m[3], 10),
        message: m[5].trim(),
        severity: m[4] === "error" ? "error" : "warning",
      });
      continue;
    }
    m = TSC_LINE_ALT.exec(t);
    if (m) {
      issues.push({
        file: m[1].trim(),
        line: parseInt(m[2], 10),
        column: parseInt(m[3], 10),
        message: m[5].trim(),
        severity: m[4] === "error" ? "error" : "warning",
      });
    }
  }
  return issues;
}

function main(): void {
  let stderr = "";
  try {
    execSync("npx tsc --noEmit", {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    stderr = (e.stderr ?? e.stdout ?? String(e)) || "";
  }

  const issues = parseTscStderr(stderr);
  const payload = { generated_at: new Date().toISOString(), issues };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  if (issues.length > 0) {
    console.log(`Backend lint scan: ${issues.length} issue(s) -> ${OUTPUT_JSON}`);
  }
}

main();
