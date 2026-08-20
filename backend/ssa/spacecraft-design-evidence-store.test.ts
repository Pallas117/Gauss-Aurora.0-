import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersistedSpacecraftDesignRow,
  getSpacecraftDesignEvidence,
  mapPersistedSpacecraftDesignRow,
  resetSpacecraftDesignEvidence,
  setSpacecraftDesignEvidence,
  validateSpacecraftDesignEvidence,
} from "./spacecraft-design-evidence-store.js";

test.beforeEach(() => resetSpacecraftDesignEvidence());

test("design evidence validates one target and bounded engineering fields", () => {
  const parsed = validateSpacecraftDesignEvidence({
    systemId: "starlink",
    observedAt: "2026-07-17T00:00:00Z",
    source: "mission radiation qualification report",
    shieldingArealDensityGcm2: 2.5,
    doseLimitKradSi: 30,
    seeQualificationUrl: "https://example.test/see",
    evidenceTypes: ["shielding", "tid_limit", "see_test"],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.systemId, "starlink");
  assert.equal(validateSpacecraftDesignEvidence({ ...parsed.value, noradId: "25544" }).ok, false);
  assert.equal(validateSpacecraftDesignEvidence({ ...parsed.value, shieldingArealDensityGcm2: 1001 }).ok, false);
});

test("design evidence keeps the newest record per NORAD/system target and round-trips persistence", () => {
  setSpacecraftDesignEvidence({ systemId: "gps-navstar", observedAt: "2026-07-16T00:00:00Z", source: "old", evidenceTypes: ["shielding"] });
  setSpacecraftDesignEvidence({ systemId: "gps-navstar", observedAt: "2026-07-17T00:00:00Z", source: "new", shieldingArealDensityGcm2: 4, evidenceTypes: ["shielding"] });
  const current = getSpacecraftDesignEvidence();
  assert.equal(current.length, 1);
  assert.equal(current[0]?.source, "new");
  const row = buildPersistedSpacecraftDesignRow(current[0]!);
  const mapped = mapPersistedSpacecraftDesignRow(row);
  assert.equal(mapped?.systemId, "gps-navstar");
  assert.equal(mapped?.shieldingArealDensityGcm2, 4);
});
