import assert from "node:assert/strict";
import test from "node:test";
import { getMeshPolicyErrors, getMeshStatus, getMeshValidators } from "./config.js";

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("mesh is disabled and cloud-independent by default", () => {
  withEnv({ GAUSS_MESH_ENABLED: undefined, GAUSS_MESH_VALIDATORS: undefined }, () => {
    const status = getMeshStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.payloads_on_ledger, false);
    assert.equal(status.command_authority, false);
    assert.deepEqual(getMeshPolicyErrors(), []);
  });
});

test("enabled mesh requires three known validators and a local node", () => {
  withEnv({
    GAUSS_MESH_ENABLED: "true",
    GAUSS_MESH_NODE_ID: "validator-a",
    GAUSS_MESH_VALIDATORS: "validator-a,validator-b,validator-c",
    GAUSS_MESH_TRANSPORT: "dtn",
  }, () => {
    assert.deepEqual(getMeshValidators(), ["validator-a", "validator-b", "validator-c"]);
    const status = getMeshStatus();
    assert.equal(status.policy_valid, true);
    assert.equal(status.quorum, 3);
    assert.equal(status.transport, "dtn");
  });
});

test("enabled mesh reports invalid quorum configuration without exposing secrets", () => {
  withEnv({ GAUSS_MESH_ENABLED: "true", GAUSS_MESH_NODE_ID: "validator-a", GAUSS_MESH_VALIDATORS: "validator-a" }, () => {
    const status = getMeshStatus();
    assert.equal(status.policy_valid, false);
    assert.ok(status.errors.some((error) => error.includes("at least three")));
    assert.equal("signature" in status, false);
  });
});
