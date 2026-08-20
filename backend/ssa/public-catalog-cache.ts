import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getSatelliteObjectsSnapshot, setSatelliteObjectsSnapshot } from "./space-domain-store.js";
import { markSpaceDomainSnapshotFromDisk } from "./availability.js";
import type { SatelliteCatalogCoverage, SatelliteObject } from "./open-catalog-client.js";

const DEFAULT_CACHE_PATH = "reports/monitoring/ssa-public-catalog-cache.json";
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_OBJECTS = 12_000;

interface PublicCatalogCacheFile {
  version: 1;
  cachedAt: string;
  objects: SatelliteObject[];
  coverage: SatelliteCatalogCoverage;
}

function cachePath(): string {
  return process.env.SSA_PUBLIC_CATALOG_CACHE_PATH?.trim() || DEFAULT_CACHE_PATH;
}

function validObject(value: unknown): value is SatelliteObject {
  if (!value || typeof value !== "object") return false;
  const object = value as Partial<SatelliteObject>;
  return typeof object.noradId === "string" &&
    typeof object.name === "string" &&
    typeof object.orbitType === "string" &&
    typeof object.observedAt === "string";
}

function validCoverage(value: unknown): value is SatelliteCatalogCoverage {
  if (!value || typeof value !== "object") return false;
  const coverage = value as Partial<SatelliteCatalogCoverage>;
  return typeof coverage.fetchedAt === "string" &&
    typeof coverage.returnedObjects === "number" &&
    Array.isArray(coverage.sourceUrls) &&
    Array.isArray(coverage.sourceFailures);
}

/** Loads only public, TLE-derived catalog state. Never persist mission evidence here. */
export function hydratePublicCatalogSnapshot(): { loaded: boolean; cachedAt: string | null } {
  try {
    const raw = readFileSync(cachePath(), "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_CACHE_BYTES) return { loaded: false, cachedAt: null };
    const parsed = JSON.parse(raw) as Partial<PublicCatalogCacheFile>;
    const objects = Array.isArray(parsed.objects) ? parsed.objects.filter(validObject).slice(0, MAX_CACHE_OBJECTS) : [];
    if (parsed.version !== 1 || typeof parsed.cachedAt !== "string" || objects.length === 0 || !validCoverage(parsed.coverage)) {
      return { loaded: false, cachedAt: null };
    }
    setSatelliteObjectsSnapshot(objects, {
      ...parsed.coverage,
      sourceFailures: [...parsed.coverage.sourceFailures, "local_public_catalog_cache"],
      complete: false,
      fetchedAt: parsed.coverage.fetchedAt,
    });
    markSpaceDomainSnapshotFromDisk();
    return { loaded: true, cachedAt: parsed.cachedAt };
  } catch {
    return { loaded: false, cachedAt: null };
  }
}

export function persistPublicCatalogSnapshot(): { persisted: boolean; reason?: string } {
  const snapshot = getSatelliteObjectsSnapshot();
  if (!snapshot || snapshot.objects.length === 0) return { persisted: false, reason: "empty_catalog" };
  const payload: PublicCatalogCacheFile = {
    version: 1,
    cachedAt: new Date().toISOString(),
    objects: snapshot.objects.slice(0, MAX_CACHE_OBJECTS),
    coverage: snapshot.coverage,
  };
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CACHE_BYTES) return { persisted: false, reason: "cache_size_limit" };
  const path = cachePath();
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporaryPath, serialized, "utf8");
    renameSync(temporaryPath, path);
    return { persisted: true };
  } catch {
    return { persisted: false, reason: "cache_write_failed" };
  }
}
