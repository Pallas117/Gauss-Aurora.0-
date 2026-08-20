import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDataResidencyPolicy,
  getDataResidencyStatus,
  isNetworkOnlySensitiveData,
} from "./data-residency.js";

const keys = [
  "GAUSS_SENSITIVE_DATA_MODE",
  "GAUSS_DEPLOYMENT_ROLE",
  "GAUSS_NETWORK_PROCESSING_URL",
  "GAUSS_SENSITIVE_STORE_URL",
  "GAUSS_SENSITIVE_STORE_PQC_REQUIRED",
  "GAUSS_SENSITIVE_STORE_PQC_PROFILE",
  "STAFF_AUTH_PQC_GATEWAY_REQUIRED",
  "STAFF_AUTH_CRYPTO_PROFILE",
  "GAUSS_PROCESSING_ALLOW_LOCAL_FALLBACK",
  "GAUSS_LOCAL_SENSITIVE_WRITES",
];

function withEnvironment(values: Record<string, string | undefined>, callback: () => void): void {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("local mode remains observable without claiming network-only readiness", () => {
  withEnvironment({ GAUSS_SENSITIVE_DATA_MODE: "local" }, () => {
    const status = getDataResidencyStatus();
    assert.equal(isNetworkOnlySensitiveData(), false);
    assert.equal(status.mode, "local");
    assert.equal(status.state, "degraded");
    assert.deepEqual(status.blockers, []);
  });
});

test("network-only mode fails closed when gateways and local-write controls are missing", () => {
  withEnvironment({ GAUSS_SENSITIVE_DATA_MODE: "network_only" }, () => {
    const status = getDataResidencyStatus();
    assert.equal(isNetworkOnlySensitiveData(), true);
    assert.equal(status.state, "blocked");
    assert.ok(status.blockers.length >= 8);
    assert.throws(() => assertDataResidencyPolicy(), /Data-residency policy blocked startup/);
  });
});

test("network-only mode passes with HTTPS, PQC, and no-local-fallback evidence", () => {
  withEnvironment(
    {
      GAUSS_SENSITIVE_DATA_MODE: "network_only",
      GAUSS_DEPLOYMENT_ROLE: "kali",
      GAUSS_NETWORK_PROCESSING_URL: "https://processing.example.test",
      GAUSS_SENSITIVE_STORE_URL: "https://store.example.test",
      GAUSS_SENSITIVE_STORE_PQC_REQUIRED: "true",
      GAUSS_SENSITIVE_STORE_PQC_PROFILE: "hybrid-pqc-v1",
      STAFF_AUTH_PQC_GATEWAY_REQUIRED: "true",
      STAFF_AUTH_CRYPTO_PROFILE: "hybrid-pqc-v1",
      GAUSS_PROCESSING_ALLOW_LOCAL_FALLBACK: "false",
      GAUSS_LOCAL_SENSITIVE_WRITES: "false",
    },
    () => {
      const status = getDataResidencyStatus();
      assert.equal(status.state, "nominal");
      assert.deepEqual(status.blockers, []);
      assert.doesNotThrow(() => assertDataResidencyPolicy());
    },
  );
});
