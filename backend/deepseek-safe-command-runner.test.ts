import assert from "node:assert/strict";
import test from "node:test";
import {
  SafeCommandApprovalVault,
  parseDeepSeekSafeCommandPlan,
  resolveSafeCommandAllowlist,
  runSafeCommand,
  validateSafeCommandPlan,
} from "./deepseek-safe-command-runner.js";

test("parseDeepSeekSafeCommandPlan extracts safe command JSON", () => {
  const raw = [
    "Use this command:",
    "```json",
    '{"executable":"pmset","args":["-g","batt"],"reason":"inspect battery","confidence":0.82,"risk":"low"}',
    "```",
  ].join("\n");
  const plan = parseDeepSeekSafeCommandPlan(raw);
  assert.ok(plan);
  assert.equal(plan.executable, "pmset");
  assert.deepEqual(plan.args, ["-g", "batt"]);
  assert.equal(plan.risk, "low");
});

test("validateSafeCommandPlan enforces strict executable allowlist", () => {
  const allowlist = resolveSafeCommandAllowlist({
    ORCHESTRATOR_SAFE_COMMAND_ALLOWLIST: "pmset,uptime",
  } as NodeJS.ProcessEnv);
  const blocked = validateSafeCommandPlan(
    {
      executable: "rm",
      args: ["-rf", "/"],
      reason: "unsafe",
      confidence: 1,
      risk: "high",
    },
    allowlist,
  );
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.reason), /allowlist/i);
});

test("SafeCommandApprovalVault issues one-time approval tokens", () => {
  const now = new Date("2026-03-06T00:00:00.000Z");
  let offsetMs = 0;
  const vault = new SafeCommandApprovalVault({
    ttlMs: 30_000,
    now: () => new Date(now.getTime() + offsetMs),
  });

  const approval = vault.issue({
    proposalId: "proposal-1",
    requestedBy: "operator-1",
    promptDigest: "abc",
    createdAt: new Date(now.getTime()).toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    commandPreview: "pmset -g batt",
    plan: {
      executable: "pmset",
      args: ["-g", "batt"],
      reason: "inspect battery state",
      confidence: 0.8,
      risk: "low",
    },
  });

  const consumed = vault.consume(approval.approvalToken, "operator-1");
  assert.ok(consumed);
  const second = vault.consume(approval.approvalToken, "operator-1");
  assert.equal(second, null);

  const approval2 = vault.issue({
    proposalId: "proposal-2",
    requestedBy: "operator-1",
    promptDigest: "def",
    createdAt: new Date(now.getTime()).toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    commandPreview: "pmset -g batt",
    plan: {
      executable: "pmset",
      args: ["-g", "batt"],
      reason: "inspect battery state",
      confidence: 0.8,
      risk: "low",
    },
  });
  offsetMs = 60_000;
  const expired = vault.consume(approval2.approvalToken, "operator-1");
  assert.equal(expired, null);
});

test("runSafeCommand executes with timeout guard", async () => {
  const result = await runSafeCommand(
    {
      executable: process.execPath,
      args: ["-e", "setTimeout(() => console.log('done'), 2000)"],
      reason: "test timeout",
      confidence: 1,
      risk: "low",
    },
    {
      timeoutMs: 200,
      maxOutputBytes: 4096,
    },
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
});
