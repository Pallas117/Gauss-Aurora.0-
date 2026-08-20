import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readKaliSupervisorReport } from "./kali-supervisor.js";

test("reads and bounds a valid Kali supervisor report", () => {
  const root = mkdtempSync(join(tmpdir(), "gauss-kali-report-"));
  const file = join(root, "latest.json");
  writeFileSync(file, JSON.stringify({
    schema: "gauss-kali-supervisor-v1",
    generated_at: "2026-07-18T00:00:00Z",
    node: { hostname: "kali", tailscale_ip: "100.107.156.105" },
    overall: "blocked",
    policy: { network_only_backend: true, public_ingress_allowed: true, spacecraft_actions_allowed: true, safe_action_mode: "bounded", secrets_in_report: true },
    checks: [{ check: "backend-env", status: "blocked", detail: "secret_token=should-not-be-in-report" }],
    metrics: { memory_available_mb: 1024 },
    actions: [{ action: "restart-service", status: "skipped" }],
    blockers: ["backend-env"],
  }));
  chmodSync(file, 0o600);
  const report = readKaliSupervisorReport(file);
  assert.equal(report?.schema, "gauss-kali-supervisor-v1");
  assert.equal(report?.overall, "blocked");
  assert.equal(report?.policy.public_ingress_allowed, false);
  assert.equal(report?.policy.spacecraft_actions_allowed, false);
  assert.equal(report?.policy.secrets_in_report, false);
  assert.equal(report?.checks.length, 1);
});

test("rejects missing, malformed, and oversized reports", () => {
  const root = mkdtempSync(join(tmpdir(), "gauss-kali-report-invalid-"));
  assert.equal(readKaliSupervisorReport(join(root, "missing.json")), null);
  const malformed = join(root, "malformed.json");
  writeFileSync(malformed, "not-json");
  assert.equal(readKaliSupervisorReport(malformed), null);
  const wrongSchema = join(root, "wrong-schema.json");
  writeFileSync(wrongSchema, JSON.stringify({ schema: "wrong" }));
  assert.equal(readKaliSupervisorReport(wrongSchema), null);
});
