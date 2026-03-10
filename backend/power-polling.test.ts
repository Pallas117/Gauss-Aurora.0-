/**
 * Power directive: no high-frequency polling in backend.
 * setInterval with literal ms < MIN_CADENCE_MS indicates a spin-like pattern (8GB M1).
 * Allowlist: add "ALLOW_LOW_CADENCE" on the same line or next line with reason.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIN_CADENCE_MS = 1000;
const BACKEND_DIR = join(process.cwd(), "backend");

function* walkTsFiles(dir: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      yield* walkTsFiles(full);
    } else if (e.isFile() && (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts"))) {
      yield full;
    }
  }
}

test("backend has no setInterval with literal ms below MIN_CADENCE_MS unless allowlisted", () => {
  const violations: { file: string; line: number; match: string }[] = [];

  for (const file of walkTsFiles(BACKEND_DIR)) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (line.includes("ALLOW_LOW_CADENCE")) continue;
      const nextLine = lines[i + 1];
      if (nextLine?.includes("ALLOW_LOW_CADENCE")) continue;

      const setIntervalMatch = line.match(/setInterval\s*\(\s*[^,]+,\s*(\d+)/);
      if (setIntervalMatch) {
        const ms = parseInt(setIntervalMatch[1]!, 10);
        if (ms < MIN_CADENCE_MS) {
          violations.push({ file, line: i + 1, match: setIntervalMatch[0]! });
        }
      }
    }
  }

  assert.ok(
    violations.length === 0,
    `Backend setInterval cadence must be >= ${MIN_CADENCE_MS}ms (power directive). Violations:\n${violations.map((v) => `  ${v.file}:${v.line}  ${v.match}`).join("\n")}`,
  );
});
