/**
 * PROJECT GAUSS directive adherence check.
 * Runs Python directive checks (GC, lazy load) and optional pattern scans.
 * Exit 0 = PASS, 1 = FAIL. Use --json-out to write a report for the audit pipeline.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PYTHON_SCRIPT = "backend/scripts/check-directive-python.py";

function hasArg(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function argValue(flag: string): string | null {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  const v = argv[idx + 1];
  return typeof v === "string" && !v.startsWith("--") ? v : null;
}

function main(): number {
  const cwd = process.cwd();
  const pythonScript = join(cwd, PYTHON_SCRIPT);

  const proc = spawnSync("python3", [pythonScript], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });

  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
  const passed = proc.status === 0;

  const payload = {
    generated_at: new Date().toISOString(),
    name: "Directive adherence (Python GC + lazy load)",
    status: passed ? "PASS" : "FAIL",
    exit_code: proc.status ?? -1,
    detail: output.slice(0, 2000),
  };

  const jsonOut = argValue("--json-out");
  if (jsonOut) {
    const resolved = join(cwd, jsonOut);
    mkdirSync(join(resolved, ".."), { recursive: true });
    writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  if (!passed) {
    console.error("[FAIL] Directive adherence check");
    console.error(output);
  } else {
    console.log("[PASS] Directive adherence (Python GC + lazy load)");
  }

  return passed ? 0 : 1;
}

process.exit(main());
