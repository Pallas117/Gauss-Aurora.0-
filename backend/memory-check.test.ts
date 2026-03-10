import assert from "node:assert/strict";
import test from "node:test";
import {
  getMemoryCeilingStatus,
  isMemoryOverCeiling,
  setMemoryCheckSpawnSyncForTests,
} from "./memory-check.js";

test("isMemoryOverCeiling returns true only for an actual ceiling breach", () => {
  try {
    setMemoryCheckSpawnSyncForTests(
      (() =>
        ({
          status: 1,
          stdout: "",
          stderr: "Memory ceiling exceeded: 6000 MB > 5800 MB",
        })) as typeof import("node:child_process").spawnSync,
    );
    assert.equal(isMemoryOverCeiling(5800), true);
  } finally {
    setMemoryCheckSpawnSyncForTests(null);
  }
});

test("isMemoryOverCeiling ignores script permission failures and other non-ceiling errors", () => {
  try {
    setMemoryCheckSpawnSyncForTests(
      (() =>
        ({
          status: 1,
          stdout: "",
          stderr: "PermissionError: [Errno 1] Operation not permitted",
        })) as typeof import("node:child_process").spawnSync,
    );
    assert.equal(isMemoryOverCeiling(5800), false);
  } finally {
    setMemoryCheckSpawnSyncForTests(null);
  }
});

test("getMemoryCeilingStatus reports last non-ceiling error without tripping the guard", () => {
  try {
    setMemoryCheckSpawnSyncForTests(
      (() =>
        ({
          status: 1,
          stdout: "",
          stderr: "PermissionError: [Errno 1] Operation not permitted",
        })) as typeof import("node:child_process").spawnSync,
    );
    const status = getMemoryCeilingStatus(5800);
    assert.equal(status.overCeiling, false);
    assert.equal(status.ceilingMb, 5800);
    assert.equal(typeof status.checkedAt, "string");
    assert.match(status.lastError ?? "", /operation not permitted/i);
  } finally {
    setMemoryCheckSpawnSyncForTests(null);
  }
});
