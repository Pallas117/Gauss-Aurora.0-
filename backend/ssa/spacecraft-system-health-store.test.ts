import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersistedSpacecraftSystemHealthRow,
  getLatestSpacecraftSystemHealthEvidence,
  mapPersistedSpacecraftSystemHealthRow,
  resetSpacecraftSystemHealthEvidence,
  setSpacecraftSystemHealthEvidence,
  validateSpacecraftSystemHealthEvidence,
} from "./spacecraft-system-health-store.js";

test("system health evidence validates, replaces by system, expires, and round-trips", () => {
  resetSpacecraftSystemHealthEvidence();
  const parsed = validateSpacecraftSystemHealthEvidence({ systemId: "starlink", observedAt: "2026-07-17T00:00:00.000Z", source: "operator-status", telemetryStatus: "degraded", damageStatus: "suspected", evidenceTypes: ["fleet_link_alarm"] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  setSpacecraftSystemHealthEvidence(parsed.value);
  assert.deepEqual(mapPersistedSpacecraftSystemHealthRow(buildPersistedSpacecraftSystemHealthRow(parsed.value)), parsed.value);
  assert.equal(getLatestSpacecraftSystemHealthEvidence("starlink", 60 * 60 * 1000, Date.parse("2026-07-17T00:30:00.000Z"))?.damageStatus, "suspected");
  assert.equal(getLatestSpacecraftSystemHealthEvidence("starlink", 60 * 60 * 1000, Date.parse("2026-07-17T02:00:00.000Z")), null);
  resetSpacecraftSystemHealthEvidence();
});

test("system health evidence rejects unsafe identifiers", () => {
  assert.equal(validateSpacecraftSystemHealthEvidence({ systemId: "../starlink", observedAt: "2026-07-17T00:00:00Z", source: "x", telemetryStatus: "unknown", damageStatus: "unknown", evidenceTypes: [] }).ok, false);
});
