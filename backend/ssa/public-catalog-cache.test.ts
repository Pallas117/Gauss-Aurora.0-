import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getSatelliteObjectsSnapshot, resetSpaceDomainStore, setSatelliteObjectsSnapshot } from "./space-domain-store.js";
import { hydratePublicCatalogSnapshot, persistPublicCatalogSnapshot } from "./public-catalog-cache.js";
import { resolveSpaceDomainAvailability } from "./availability.js";

const object = {
  noradId: "25544",
  name: "ISS (ZARYA)",
  orbitType: "LEO" as const,
  altitudeKm: 420,
  latitudeDeg: 1,
  longitudeDeg: 2,
  highValue: true,
  unidentified: false,
  objectClass: "spacecraft" as const,
  observedAt: new Date().toISOString(),
};

test("public catalog cache round-trips and marks restored coverage incomplete", () => {
  const directory = mkdtempSync(join(tmpdir(), "gauss-public-catalog-"));
  const previousPath = process.env.SSA_PUBLIC_CATALOG_CACHE_PATH;
  process.env.SSA_PUBLIC_CATALOG_CACHE_PATH = join(directory, "catalog.json");
  try {
    resetSpaceDomainStore();
    setSatelliteObjectsSnapshot([object], {
      catalogGroup: "active",
      sourceUrl: "https://example.test/tle",
      sourceUrls: ["https://example.test/tle"],
      sourceFailures: [],
      complete: true,
      catalogObjects: 1,
      parsedObjects: 1,
      propagatedObjects: 1,
      returnedObjects: 1,
      objectLimit: 12000,
      truncated: false,
      fetchedAt: object.observedAt,
      objectClassCounts: { spacecraft: 1, rocket_body: 0, debris: 0, unknown: 0 },
    });
    assert.deepEqual(persistPublicCatalogSnapshot(), { persisted: true });
    assert.ok(JSON.parse(readFileSync(process.env.SSA_PUBLIC_CATALOG_CACHE_PATH, "utf8")).objects);

    resetSpaceDomainStore();
    assert.deepEqual(hydratePublicCatalogSnapshot().loaded, true);
    assert.equal(getSatelliteObjectsSnapshot()?.objects[0]?.noradId, "25544");
    assert.equal(getSatelliteObjectsSnapshot()?.coverage.complete, false);
    assert.ok(getSatelliteObjectsSnapshot()?.coverage.sourceFailures.includes("local_public_catalog_cache"));
    const availability = resolveSpaceDomainAvailability(
      { updatedAt: object.observedAt, riskZones: null, satellites: getSatelliteObjectsSnapshot(), conjunctions: { updatedAt: null, events: [] } },
      { level: "nominal" } as never,
    ).availability;
    assert.equal(availability.mode, "projected");
    assert.equal(availability.projectionSource, "disk");
  } finally {
    resetSpaceDomainStore();
    if (previousPath === undefined) delete process.env.SSA_PUBLIC_CATALOG_CACHE_PATH;
    else process.env.SSA_PUBLIC_CATALOG_CACHE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expired public catalog cache does not become a live or projected signal", () => {
  const directory = mkdtempSync(join(tmpdir(), "gauss-expired-catalog-"));
  const previousPath = process.env.SSA_PUBLIC_CATALOG_CACHE_PATH;
  process.env.SSA_PUBLIC_CATALOG_CACHE_PATH = join(directory, "catalog.json");
  try {
    resetSpaceDomainStore();
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    setSatelliteObjectsSnapshot([object], {
      catalogGroup: "active", sourceUrl: "https://example.test/tle", sourceUrls: ["https://example.test/tle"],
      sourceFailures: [], complete: true, catalogObjects: 1, parsedObjects: 1, propagatedObjects: 1,
      returnedObjects: 1, objectLimit: 12000, truncated: false, fetchedAt: old,
      objectClassCounts: { spacecraft: 1, rocket_body: 0, debris: 0, unknown: 0 },
    });
    assert.deepEqual(persistPublicCatalogSnapshot(), { persisted: true });
    resetSpaceDomainStore();
    assert.equal(hydratePublicCatalogSnapshot().loaded, true);
    const availability = resolveSpaceDomainAvailability(
      { updatedAt: old, riskZones: null, satellites: getSatelliteObjectsSnapshot(), conjunctions: { updatedAt: null, events: [] } },
      { level: "nominal" } as never,
    ).availability;
    assert.equal(availability.mode, "warming");
  } finally {
    resetSpaceDomainStore();
    if (previousPath === undefined) delete process.env.SSA_PUBLIC_CATALOG_CACHE_PATH;
    else process.env.SSA_PUBLIC_CATALOG_CACHE_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
