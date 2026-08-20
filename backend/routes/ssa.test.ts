import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import express from "express";
import { buildFleetCoverageVerdict, buildIdentityGapQueue, buildRiskActivity, buildSystemCoverage, countFreshRadiationFeeds, matchesExposureDimension, mountSsaRoutes, prioritizeScreeningAssessments, spaceWeatherState } from "./ssa.js";
import {
  resetSpaceDomainStore,
  setConjunctionRecords,
  setRiskZoneSnapshot,
  setSatelliteObjectsSnapshot,
} from "../ssa/space-domain-store.js";
import { getCanonicalFeed } from "../state.js";
import { resetSpaceDomainAnalysisState } from "../ssa/live-analysis.js";
import { resetSpacecraftSystemHealthEvidence, setSpacecraftSystemHealthEvidence } from "../ssa/spacecraft-system-health-store.js";
import { resetSpacecraftDesignEvidence, setSpacecraftDesignEvidence } from "../ssa/spacecraft-design-evidence-store.js";
import { resetSpacecraftSystemProfiles, setSpacecraftSystemProfile } from "../ssa/spacecraft-system-profile-store.js";
import { buildRadiationMonitoringCatalog } from "../ssa/radiation-monitoring-catalog.js";

async function listen(server: http.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

async function request(port: number, path: string) {
  return new Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    payload: unknown;
  }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            payload: raw ? String(res.headers["content-type"] ?? "").includes("json") ? JSON.parse(raw) : raw : null,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test.beforeEach(() => {
  getCanonicalFeed().length = 0;
  resetSpaceDomainStore();
  resetSpaceDomainAnalysisState();
  resetSpacecraftSystemHealthEvidence();
  resetSpacecraftDesignEvidence();
  resetSpacecraftSystemProfiles();
  delete process.env.ORCHESTRATOR_LOCAL_ENGINE_URL;
});

test("radiation readiness counts only fresh particle-flux feeds", () => {
  const now = Date.parse("2026-07-17T00:10:00.000Z");
  assert.equal(countFreshRadiationFeeds({ radiation: { observedAt: "2026-07-16T00:00:00.000Z" } }, now), 0);
  assert.equal(countFreshRadiationFeeds({ radiation: { observedAt: "2026-07-17T00:05:00.000Z" }, supplementalRadiation: [{ observedAt: "2026-07-17T00:06:00.000Z" }] }, now), 2);
});

test("exposure dimension filters keep radiation and electromagnetic queues distinct", () => {
  const assessment = { radiationExposure: 0.8, electromagneticExposure: 0.2 } as never;
  assert.equal(matchesExposureDimension(assessment, "radiation"), true);
  assert.equal(matchesExposureDimension(assessment, "electromagnetic"), false);
  assert.equal(matchesExposureDimension(assessment, "electromagnetic", 0.1), true);
});

test("screening queues prioritize critical and high exposure objects before the bounded response limit", () => {
  const assessment = (noradId: string, state: "critical" | "high" | "unknown", score: number | null) => ({
    satellite: { noradId }, state, score, radiationExposure: score, electromagneticExposure: null,
  } as never);
  const ordered = prioritizeScreeningAssessments([
    assessment("100", "unknown", null),
    assessment("200", "high", 0.7),
    assessment("300", "critical", 0.82),
  ]);
  assert.deepEqual(ordered.map((entry) => entry.satellite.noradId), ["300", "200", "100"]);
});

test("risk activity counts the full assessment set while bounding returned candidates", () => {
  const assessment = (noradId: string, state: "critical" | "high" | "nominal", systemId = `system-${noradId}`) => ({
    satellite: { noradId, name: `TEST ${noradId}`, orbitType: "LEO", altitudeKm: 500, observedAt: "2026-07-17T00:00:00.000Z" },
    profile: { systemId, missionType: "test" },
    state, score: state === "nominal" ? 0.1 : 0.9, radiationExposure: 0.8, electromagneticExposure: 0.7,
    vanAllenRegion: "leo_outside_belts", effects: [],
  } as never);
  const activity = buildRiskActivity([
    assessment("1", "critical"), assessment("2", "high", "system-high"), assessment("3", "high", "system-high"), assessment("4", "nominal"),
  ], 2);
  assert.equal(activity.monitoredObjects, 4);
  assert.deepEqual(activity.stateCounts, { nominal: 1, watch: 0, high: 2, critical: 1, unknown: 0 });
  assert.equal(activity.candidateCount, 3);
  assert.deepEqual(activity.systemCounts, { nominal: 1, watch: 0, high: 1, critical: 1, unknown: 0 });
  assert.equal(activity.criticalSystemCount, 1);
  assert.equal(activity.highSystemCount, 1);
  assert.equal(activity.candidates.length, 2);
  assert.equal(activity.admission, "observe_only");
});

test("global fleet coverage stays false until complete catalog and expected manifests reconcile", () => {
  const verdict = buildFleetCoverageVerdict({
    catalog: { available: true, complete: true, truncated: false, sourceFailures: [], fetchedAt: "2026-07-17T00:00:00.000Z" },
    nowMs: Date.parse("2026-07-17T00:05:00.000Z"),
    assessments: [],
    profiles: [{ systemId: "fleet", missionType: "unknown", expectedObjectCount: 1 }],
  });
  assert.equal(verdict.globalFleetCoverage, false);
  assert.ok(verdict.blockers.includes("expected_fleet_reconciliation_incomplete"));
});

test("global fleet coverage becomes true only after an expected manifest fully reconciles", () => {
  const verdict = buildFleetCoverageVerdict({
    catalog: { available: true, complete: true, truncated: false, sourceFailures: [], fetchedAt: "2026-07-17T00:00:00.000Z" },
    nowMs: Date.parse("2026-07-17T00:05:00.000Z"),
    assessments: [{
      profile: { systemId: "fleet", missionType: "unknown", completeness: "partial" },
      satellite: { noradId: "12345" },
      state: "unknown",
      score: null,
      radiationExposure: null,
      electromagneticExposure: null,
      effects: [],
      evidenceLedger: { orbit: "unknown", environment: "unknown", particleFlux: "unknown", spacecraftDesign: "partial", healthTelemetry: "unknown", damage: "unknown" },
    } as never],
    profiles: [{ systemId: "fleet", missionType: "unknown", expectedNoradIds: ["12345"], expectedObjectCount: 1 }],
  });
  assert.equal(verdict.globalFleetCoverage, true);
  assert.deepEqual(verdict.blockers, []);
  assert.equal(verdict.evidence.expectedFleetGaps, false);
});

test("identity gap queue remains bounded and unowned", () => {
  const gaps = buildIdentityGapQueue([
    { noradId: "1", name: "COSMOS 1", orbitType: "LEO", altitudeKm: 500, latitudeDeg: 0, longitudeDeg: 0, highValue: false, unidentified: false, objectClass: "spacecraft", observedAt: "2026-07-17T00:00:00.000Z" },
    { noradId: "2", name: "COSMOS 2", orbitType: "MEO", altitudeKm: 8000, latitudeDeg: 0, longitudeDeg: 0, highValue: false, unidentified: false, objectClass: "spacecraft", observedAt: "2026-07-17T00:00:00.000Z" },
    { noradId: "3", name: "DEB COSMOS", orbitType: "LEO", altitudeKm: 500, latitudeDeg: 0, longitudeDeg: 0, highValue: false, unidentified: false, objectClass: "debris", observedAt: "2026-07-17T00:00:00.000Z" },
    { noradId: "4", name: "OBJECT 12345", orbitType: "LEO", altitudeKm: 500, latitudeDeg: 0, longitudeDeg: 0, highValue: false, unidentified: true, objectClass: "spacecraft", observedAt: "2026-07-17T00:00:00.000Z" },
  ]);
  assert.deepEqual({ family: gaps[0]?.family, objectCount: gaps[0]?.objectCount, action: gaps[0]?.action }, { family: "COSMOS", objectCount: 2, action: "operator_profile_required" });
  assert.deepEqual(gaps[0]?.objects.map(({ verificationSources: _verificationSources, ...object }) => object), [
    { noradId: "1", name: "COSMOS 1", orbitType: "LEO", altitudeKm: 500, observedAt: "2026-07-17T00:00:00.000Z" },
    { noradId: "2", name: "COSMOS 2", orbitType: "MEO", altitudeKm: 8000, observedAt: "2026-07-17T00:00:00.000Z" },
  ]);
  assert.deepEqual(gaps[0]?.objects[0]?.verificationSources.map((source) => source.provider), ["SatNOGS DB", "CelesTrak GP"]);
  assert.equal(gaps[1]?.family, "UNKNOWN-PUBLIC-SYSTEM");
});

test("coverage marks conflicting space weather as conflicting rather than observed", () => {
  const now = Date.parse("2026-07-17T00:10:00.000Z");
  assert.equal(spaceWeatherState({ timestamp: "2026-07-17T00:05:00.000Z", quality: { stale: false, conflicting: true } }, now), "conflicting");
  assert.equal(spaceWeatherState({ timestamp: "2026-07-17T00:05:00.000Z", quality: { stale: false, conflicting: false } }, now), "observed");
});

test("monitoring API publishes OpenAPI 3.1 and docs entrypoints", async () => {
  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const specResponse = await request(port, "/api/openapi.json");
    assert.equal(specResponse.statusCode, 200);
    const spec = specResponse.payload as { openapi: string; paths: Record<string, any>; components: { schemas: Record<string, unknown> } };
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/api/ssa/exposure-screening"]);
    assert.ok(spec.paths["/api/ssa/radiation-monitoring-catalog"]);
    assert.ok(spec.paths["/api/ssa/seven-zone"]);
    assert.ok(spec.paths["/api/ops/turing/radiation/risk-activity"]);
    assert.ok(spec.components.schemas.SystemCoverage);
    assert.ok(spec.components.schemas.RadiationRiskActivity);
    assert.equal(spec.paths["/api/ssa/exposure-screening"].get["x-codeSamples"].length, 3);
    assert.equal(spec.paths["/api/ssa/system-profiles"].post["x-codeSamples"].length, 3);
    const docsResponse = await request(port, "/api/docs");
    assert.equal(docsResponse.statusCode, 200);
    assert.match(String(docsResponse.headers["content-type"]), /text\/html/);
    assert.match(String(docsResponse.payload), /redoc/i);
  } finally {
    server.close();
  }
});

test("monitor registry marks DSCOVR/ACE observed only with fresh non-conflicting space weather", () => {
  const environment = { timestamp: "2026-07-17T00:05:00.000Z", quality: { stale: false, conflicting: false } } as never;
  const payload = buildRadiationMonitoringCatalog(environment, Date.parse("2026-07-17T00:10:00.000Z"));
  assert.equal(payload.systems.find((system) => system.id === "dscovr-ace-rtsw")?.runtimeState, "observed");
  const conflicting = buildRadiationMonitoringCatalog({ ...environment, quality: { stale: false, conflicting: true } }, Date.parse("2026-07-17T00:10:00.000Z"));
  assert.equal(conflicting.systems.find((system) => system.id === "dscovr-ace-rtsw")?.runtimeState, "unknown");
});

test("public space-domain route returns analysis block on the compact envelope", async () => {
  setRiskZoneSnapshot([
    {
      orbitType: "GEO",
      altitudeKm: 35_786,
      latitudeDeg: 0,
      longitudeDeg: 80,
      riskScore: 0.72,
      objectCount: 24,
    },
  ]);
  setSatelliteObjectsSnapshot([
    {
      noradId: "25544",
      name: "ISS",
      orbitType: "LEO",
      altitudeKm: 420,
      latitudeDeg: 1,
      longitudeDeg: 2,
      highValue: true,
      unidentified: false,
      observedAt: new Date().toISOString(),
    },
  ]);
  setConjunctionRecords([
    {
      id: "event-1",
      ingestedAt: new Date("2026-03-11T12:00:00.000Z").toISOString(),
      format: "cdm_json",
      purpose: "collision_avoidance",
      source: "test",
      tca: new Date("2026-03-11T12:20:00.000Z").toISOString(),
      missDistanceM: 1_800,
      relativeSpeedMS: 7_200,
      probabilityOfCollision: 0.012,
      primary: { name: "SAT-A", objectId: "10001" },
      secondary: { name: "SAT-B", objectId: "10002" },
      warnings: [],
      rawExcerpt: "{}",
    },
  ]);

  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await request(port, "/api/ssa/space-domain");
    const payload = response.payload as {
      availability: { mode: string; projectionMethod: string | null };
      summary: { counts: { conjunctionCount: number } };
      analysis: { cadenceSeconds: number; severity: string; metrics: { conjunctionCount: number } };
    };

    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["cache-control"]), /max-age=5/);
    assert.equal(payload.availability.mode, "live");
    assert.equal(payload.availability.projectionMethod, null);
    assert.equal(payload.summary.counts.conjunctionCount, 1);
    assert.equal(payload.analysis.cadenceSeconds, 30);
    assert.equal(payload.analysis.severity, "critical");
    assert.equal(payload.analysis.metrics.conjunctionCount, 1);
  } finally {
    server.close();
  }
});

test("public seven-zone route preserves explicit environmental-screening limits", async () => {
  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await request(port, "/api/ssa/seven-zone");
    const payload = response.payload as { mode: string; qualificationEvidence: boolean; zones: Array<{ id: string; state: string }>; decision: string; limitations: string[] };
    assert.equal(response.statusCode, 200);
    assert.equal(payload.mode, "environmental_screening");
    assert.equal(payload.qualificationEvidence, false);
    assert.equal(payload.zones.length, 7);
    assert.equal(payload.zones.find((zone) => zone.id === "B")?.state, "unknown");
    assert.notEqual(payload.decision, "qualified");
    assert.ok(payload.limitations.some((limitation) => limitation.includes("cannot produce a qualified decision")));
  } finally {
    server.close();
  }
});

test("radiation monitoring catalog exposes open-source systems and runtime state", async () => {
  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await request(port, "/api/ssa/radiation-monitoring-catalog");
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["cache-control"]), /max-age=3600/);
    const payload = response.payload as { scope: string; systems: Array<{ id: string; orbitContext: string[]; operationalEffects: string[]; dataAccess: Array<{ url: string }>; assetInventory?: string[]; runtimeState: string }>; limitations: string[] };
    assert.equal(payload.scope, "open_radiation_monitoring_catalog");
    assert.ok(payload.systems.length >= 9);
    const goes = payload.systems.find((system) => system.id === "goes-r-seiss");
    assert.ok(goes?.orbitContext.includes("outer_radiation_belt"));
    assert.ok(goes?.operationalEffects.includes("internal_charging"));
    assert.ok(goes?.dataAccess.some((source) => source.url.includes("services.swpc.noaa.gov/json/goes/primary")));
    assert.equal(goes?.runtimeState, "unknown");
    const esa = payload.systems.find((system) => system.id === "esa-d3s");
    assert.ok(esa?.assetInventory?.includes("Sentinel-6B/NGRM"));
    assert.ok(payload.limitations.some((limitation) => /damage/i.test(limitation)));
  } finally {
    server.close();
  }
});

test("historical scenario API exposes all seven replay cases and individual lookup", async () => {
  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const collection = await request(port, "/api/physics/scenarios");
    assert.equal(collection.statusCode, 200);
    const payload = collection.payload as { count: number; scenarios: Array<{ id: string; kpIndex: number; tidDoseKrad: number | null; eventDurationHours: number; affectedSystems: string[] }> };
    assert.equal(payload.count, 7);
    assert.equal(payload.scenarios.length, 7);
    for (const scenario of payload.scenarios) {
      assert.equal(typeof scenario.id, "string");
      assert.equal(typeof scenario.kpIndex, "number");
      assert.equal(scenario.tidDoseKrad, null);
      assert.equal(typeof scenario.eventDurationHours, "number");
      assert.ok(scenario.affectedSystems.length > 0);
    }
    const detail = await request(port, "/api/physics/scenarios/gannon-g5-2024");
    assert.equal(detail.statusCode, 200);
    assert.equal((detail.payload as { id: string }).id, "gannon-g5-2024");
    const missing = await request(port, "/api/physics/scenarios/not-a-scenario");
    assert.equal(missing.statusCode, 404);
  } finally {
    server.close();
  }
});

test("monitoring coverage route reports inventory boundaries and freshness state", async () => {
  const fetchedAt = new Date().toISOString();
  setSatelliteObjectsSnapshot([
    {
      noradId: "25544",
      name: "ISS",
      orbitType: "LEO",
      altitudeKm: 420,
      latitudeDeg: 1,
      longitudeDeg: 2,
      highValue: true,
      unidentified: false,
      objectClass: "spacecraft",
      observedAt: fetchedAt,
    },
    {
      noradId: "40000",
      name: "DEB TEST",
      orbitType: "LEO",
      altitudeKm: 500,
      latitudeDeg: 1,
      longitudeDeg: 2,
      highValue: false,
      unidentified: true,
      objectClass: "debris",
      observedAt: fetchedAt,
    },
    {
      noradId: "50000",
      name: "COSMOS 1234",
      orbitType: "LEO",
      altitudeKm: 600,
      latitudeDeg: 1,
      longitudeDeg: 2,
      highValue: false,
      unidentified: false,
      objectClass: "spacecraft",
      observedAt: fetchedAt,
    },
  ], {
    catalogObjects: 2,
    parsedObjects: 2,
    propagatedObjects: 2,
    objectClassCounts: { spacecraft: 2, rocket_body: 0, debris: 1, unknown: 0 },
    fetchedAt,
    sourceUrls: ["https://catalog.test/active"],
    sourceFailures: ["https://catalog.test/secondary"],
    complete: false,
  });

  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await request(port, "/api/ssa/monitoring-coverage");
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["cache-control"]), /max-age=60/);
    const payload = response.payload as {
      scope: string;
      catalog: { state: string; provenance: string; complete: boolean; sourceFailures: string[] };
      inventory: { spacecraftObjects: number; excludedDebrisObjects: number; monitoredSatelliteObjects: number; identityGapObjectCount: number; identityGapFamilies: Array<{ family: string; objects: number }> };
      environment: { state: string };
      radiation: { availableFeedCount: number; configuredFeeds: string[]; feeds: Array<{ state: string }> };
      assessment: { damageConclusionAvailable: boolean; missionHealthEvidenceRequired: boolean };
      readiness: { operationalScreening: boolean; globalFleetCoverage: boolean; confirmedDamageAssessment: boolean; blockers: string[]; fleetEvidence: { expectedFleetProfiles: number } };
      identityVerificationSources: Array<{ provider: string; trust: string }>;
      systemCoverage: Array<{ systemId: string; monitoringState: string; objectCount: number }>;
      topExposures: Array<{ satellite: { noradId: string }; state: string }>;
      topElectromagneticExposures: Array<{ satellite: { noradId: string }; electromagneticExposure: number | null }>;
      topRadiationExposures: Array<{ satellite: { noradId: string }; radiationExposure: number | null }>;
    };
    assert.equal(payload.scope, "public_catalog_screening");
    assert.equal(payload.catalog.state, "observed");
    assert.equal(payload.catalog.provenance, "live_ingest");
    assert.equal(payload.catalog.complete, false);
    assert.equal(payload.catalog.sourceFailures.length, 1);
    assert.equal(payload.inventory.spacecraftObjects, 2);
    assert.equal(payload.inventory.excludedDebrisObjects, 1);
    assert.equal(payload.inventory.monitoredSatelliteObjects, 2);
    assert.equal(payload.inventory.identityGapObjectCount, 1);
    assert.deepEqual(payload.identityVerificationSources.map((source) => [source.provider, source.trust]), [["SatNOGS DB", "cross_check_only"], ["CelesTrak GP", "cross_check_only"]]);
    assert.deepEqual(payload.inventory.identityGapFamilies, [{ family: "COSMOS", objects: 1 }]);
    assert.equal(payload.environment.state, "unknown");
    assert.equal(payload.radiation.availableFeedCount, 0);
    assert.deepEqual(payload.radiation.configuredFeeds, ["noaa-goes-seiss-primary", "noaa-goes-seiss-secondary"]);
    assert.equal(payload.radiation.feeds[0]?.state, "unknown");
    assert.equal(payload.assessment.damageConclusionAvailable, false);
    assert.equal(payload.assessment.missionHealthEvidenceRequired, true);
    assert.equal(payload.readiness.operationalScreening, false);
    assert.equal(payload.readiness.globalFleetCoverage, false);
    assert.equal(payload.readiness.fleetEvidence.expectedFleetProfiles, 0);
    assert.ok(payload.readiness.blockers.includes("expected_fleet_manifests_missing"));
    assert.equal(payload.readiness.confirmedDamageAssessment, false);
    assert.ok(payload.readiness.blockers.includes("space_weather_missing_or_stale"));
    assert.ok(payload.readiness.blockers.includes("unprofiled_systems_present"));
    const issPublicCoverage = payload.systemCoverage.find((system) => system.systemId === "iss");
    assert.equal(issPublicCoverage?.monitoringState, "unknown");
    assert.equal(issPublicCoverage?.objectCount, 1);
    assert.ok(payload.systemCoverage.some((system) => system.systemId === "unprofiled-cosmos"));
    assert.equal(payload.topExposures.length, 2);
    assert.ok(payload.topExposures.every((exposure) => typeof exposure.satellite.noradId === "string"));
    assert.equal(payload.topElectromagneticExposures.length, 0);
    assert.equal(payload.topRadiationExposures.length, 0);
    const identityGapResponse = await request(port, "/api/ssa/identity-gaps?limit=1");
    assert.equal(identityGapResponse.statusCode, 200);
    const identityGapPayload = identityGapResponse.payload as { scope: string; count: number; gaps: Array<{ family: string; objectCount: number; action: string; objects: Array<{ verificationSources: Array<{ provider: string; url: string }> }> }> };
    assert.equal(identityGapPayload.scope, "public_identity_gap_queue");
    assert.equal(identityGapPayload.count, 1);
    assert.equal(identityGapPayload.gaps[0]?.family, "COSMOS");
    assert.equal(identityGapPayload.gaps[0]?.objectCount, 1);
    assert.equal(identityGapPayload.gaps[0]?.action, "operator_profile_required");
    assert.deepEqual(identityGapPayload.gaps[0]?.objects[0]?.verificationSources.map((source) => source.provider), ["SatNOGS DB", "CelesTrak GP"]);
    const identityVerification = await request(port, "/api/ssa/identity-verification/50000");
    assert.equal(identityVerification.statusCode, 200);
    const verificationPayload = identityVerification.payload as { scope: string; status: string; object: { noradId: string; name: string } | null; nextAction: string; verificationSources: Array<{ trust: string }> };
    assert.deepEqual([verificationPayload.scope, verificationPayload.status, verificationPayload.object?.noradId, verificationPayload.object?.name, verificationPayload.nextAction], ["public_identity_verification", "candidate_match", "50000", "COSMOS 1234", "operator_profile_required"]);
    assert.ok(verificationPayload.verificationSources.every((source) => source.trust === "cross_check_only"));
    assert.equal((await request(port, "/api/ssa/identity-verification/invalid")).statusCode, 400);
    const absentVerification = await request(port, "/api/ssa/identity-verification/99999");
    assert.equal(absentVerification.statusCode, 200);
    assert.equal((absentVerification.payload as { status: string; object: null }).status, "not_in_current_catalog");
    const previousAuthRequired = process.env.AUTH_REQUIRED;
    process.env.AUTH_REQUIRED = "false";
    try {
      const screeningResponse = await request(port, "/api/ssa/exposure-screening");
      assert.equal(screeningResponse.statusCode, 200);
      const screening = screeningResponse.payload as { scope: string; assessments: unknown[]; summary: { total: number; unknown: number }; systemCoverage: Array<{ systemId: string; objectCount: number; monitoringState: string }>; readiness: { globalFleetCoverage: boolean; blockers: string[] } };
      assert.equal(screening.scope, "authenticated_fleet_exposure_screening");
      assert.equal(screening.assessments.length, 2);
      assert.equal(screening.summary.total, 2);
      assert.equal(screening.summary.unknown, 2);
      assert.equal(screening.readiness.globalFleetCoverage, false);
      assert.ok(screening.readiness.blockers.includes("expected_fleet_manifests_missing"));
      const issCoverage = screening.systemCoverage.find((system) => system.systemId === "iss");
      const starlinkCoverage = screening.systemCoverage.find((system) => system.systemId === "starlink");
      const cosmosCoverage = screening.systemCoverage.find((system) => system.systemId === "unprofiled-cosmos");
      assert.deepEqual([issCoverage?.objectCount, issCoverage?.monitoringState], [1, "unknown"]);
      assert.deepEqual([starlinkCoverage?.objectCount, starlinkCoverage?.monitoringState], [0, "not_observed"]);
      assert.deepEqual([cosmosCoverage?.objectCount, cosmosCoverage?.monitoringState], [1, "unknown"]);
    } finally {
      if (previousAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
      else process.env.AUTH_REQUIRED = previousAuthRequired;
    }
  } finally {
    server.close();
  }
});

test("public monitoring coverage exposes a dedicated highest electromagnetic queue", async () => {
  const observedAt = new Date().toISOString();
  setSatelliteObjectsSnapshot([
    { noradId: "25544", name: "ISS", orbitType: "LEO", altitudeKm: 420, latitudeDeg: 1, longitudeDeg: 2, highValue: true, unidentified: false, objectClass: "spacecraft", observedAt },
    { noradId: "40000", name: "GOES TEST", orbitType: "GEO", altitudeKm: 35_786, latitudeDeg: 1, longitudeDeg: 2, highValue: true, unidentified: false, objectClass: "spacecraft", observedAt },
  ], { catalogObjects: 2, parsedObjects: 2, propagatedObjects: 2, objectClassCounts: { spacecraft: 2, rocket_body: 0, debris: 0, unknown: 0 }, fetchedAt: observedAt, sourceUrls: ["https://catalog.test/active"], sourceFailures: [], complete: true });
  getCanonicalFeed().push({
    timestamp: observedAt, source: "fusion", rho: 1,
    velocity: { x: -450, y: 0, z: 0, magnitude: 450 }, magneticField: { x: 0, y: 0, z: -12, bt: 12 }, electricField: { x: 0, y: 0, z: 0, ey: 0 },
    solarWind: { speed: 450, density: 7, dynamicPressure: 7 }, indices: { kp: 8, dst: -150 }, coupling: { newell: 1, epsilon: 1 }, propagation: { l1DelaySeconds: 1500, etaEarthArrival: observedAt }, alerts: { stormTier: "severe", reason: "test" }, quality: { outlier: false, stale: false, interpolated: false, extrapolated: false, lowConfidence: false }, uncertainty: { speed: { lower: 400, upper: 500, sigma: 10 }, density: { lower: 5, upper: 9, sigma: 1 }, bz: { lower: -14, upper: -10, sigma: 1 } },
  } as never);
  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await request(port, "/api/ssa/monitoring-coverage");
    assert.equal(response.statusCode, 200);
    const payload = response.payload as { topElectromagneticExposures: Array<{ satellite: { noradId: string }; electromagneticExposure: number | null }>; topRadiationExposures: Array<{ radiationExposure: number | null }> };
    assert.equal(payload.topElectromagneticExposures.length, 2);
    assert.equal(payload.topRadiationExposures.length, 2);
    assert.ok(payload.topElectromagneticExposures.every((exposure) => (exposure.electromagneticExposure ?? -1) >= 0));
  } finally {
    server.close();
  }
});

test("spacecraft health evidence route is protected by mission operator auth", async () => {
  const previousAuthRequired = process.env.AUTH_REQUIRED;
  process.env.AUTH_REQUIRED = "true";
  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await request(port, "/api/ssa/spacecraft-health");
    assert.equal(response.statusCode, 401);
    const systemResponse = await request(port, "/api/ssa/system-health");
    assert.equal(systemResponse.statusCode, 401);
    const designResponse = await request(port, "/api/ssa/spacecraft-design");
    assert.equal(designResponse.statusCode, 401);
    const profileResponse = await request(port, "/api/ssa/system-profiles");
    assert.equal(profileResponse.statusCode, 401);
    const screeningResponse = await request(port, "/api/ssa/exposure-screening");
    assert.equal(screeningResponse.statusCode, 401);
  } finally {
    if (previousAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previousAuthRequired;
    server.close();
  }
});

test("exposure screening expands system evidence to matched catalog objects", async () => {
  const observedAt = new Date().toISOString();
  setSatelliteObjectsSnapshot([{
    noradId: "25544",
    name: "ISS TEST OBJECT",
    orbitType: "LEO",
    altitudeKm: 420,
    latitudeDeg: 1,
    longitudeDeg: 2,
    highValue: true,
    unidentified: false,
    objectClass: "spacecraft",
    observedAt,
  }, {
    noradId: "25545",
    name: "ISS TEST OBJECT 2",
    orbitType: "LEO",
    altitudeKm: 420,
    latitudeDeg: 1,
    longitudeDeg: 2,
    highValue: true,
    unidentified: false,
    objectClass: "spacecraft",
    observedAt: "2026-07-10T00:00:00.000Z",
  }]);
  setSpacecraftSystemProfile({ systemId: "iss-test", aliases: ["ISS TEST OBJECT"], namePatterns: ["ISS"], missionType: "crewed_leo", operator: "test", source: "test", observedAt, expectedNoradIds: ["25544", "99999"], expectedObjectCount: 2 });
  setSpacecraftSystemHealthEvidence({ systemId: "iss-test", observedAt, source: "test", telemetryStatus: "nominal", damageStatus: "confirmed", evidenceTypes: ["telemetry"] });
  setSpacecraftDesignEvidence({ systemId: "iss-test", observedAt, source: "test", shieldingArealDensityGcm2: 20, doseLimitKradSi: 50, seeQualificationUrl: "https://example.test/see", evidenceTypes: ["design"] });

  const previousAuthRequired = process.env.AUTH_REQUIRED;
  process.env.AUTH_REQUIRED = "false";
  const app = express();
  mountSsaRoutes(app);
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const response = await request(port, "/api/ssa/exposure-screening");
    assert.equal(response.statusCode, 200);
    const assessment = (response.payload as { assessments: Array<{ profile: { systemId: string; completeness: string }; provenance: { orbit: { source: string; observedAt: string }; environment: { source: string | null; observedAt: string | null } }; evidenceLedger: { healthTelemetry: string; damage: string; spacecraftDesign: string } }> }).assessments[0];
    assert.equal(assessment.profile.systemId, "iss-test");
    assert.equal(assessment.profile.completeness, "complete");
    assert.equal(assessment.evidenceLedger.healthTelemetry, "observed");
    assert.equal(assessment.evidenceLedger.damage, "observed");
    assert.equal(assessment.evidenceLedger.spacecraftDesign, "observed");
    assert.equal(assessment.provenance.orbit.source, "configured_tle_catalog");
    assert.equal(assessment.provenance.orbit.observedAt, observedAt);
    assert.equal(assessment.provenance.environment.source, null);
    assert.equal(assessment.provenance.environment.observedAt, null);
    const system = (response.payload as { systemCoverage: Array<{ systemId: string; objectCount: number; unknownObjects: number; expectedObjectCount?: number; observedExpectedObjectCount?: number; missingExpectedObjectCount?: number; missingExpectedNoradIds?: string[]; coverageRatio?: number; monitoringState: string }> }).systemCoverage.find((entry) => entry.systemId === "iss-test");
    assert.deepEqual([system?.objectCount, system?.unknownObjects, system?.monitoringState], [2, 2, "unknown"]);
    assert.deepEqual([system?.expectedObjectCount, system?.observedExpectedObjectCount, system?.missingExpectedObjectCount, system?.coverageRatio], [2, 1, 1, 0.5]);
    assert.deepEqual(system?.missingExpectedNoradIds, ["99999"]);
    const filteredResponse = await request(port, "/api/ssa/exposure-screening?systemId=iss-test&limit=1");
    assert.equal(filteredResponse.statusCode, 200);
    const filtered = filteredResponse.payload as { assessments: unknown[]; matchedAssessments: number; returnedAssessments: number; query: { systemId: string; limit: number } };
    assert.equal(filtered.query.systemId, "iss-test");
    assert.equal(filtered.query.limit, 1);
    assert.equal(filtered.matchedAssessments, 2);
    assert.equal(filtered.returnedAssessments, 1);
    assert.equal(filtered.assessments.length, 1);
    const invalidResponse = await request(port, "/api/ssa/exposure-screening?state=damage");
    assert.equal(invalidResponse.statusCode, 400);
  } finally {
    if (previousAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previousAuthRequired;
    server.close();
  }
});

test("system coverage marks mixed object freshness as partial", () => {
  const profile = { systemId: "mixed-system", missionType: "test" };
  const observed = { profile: { ...profile, completeness: "partial" as const }, state: "watch" as const, score: 0.5, radiationExposure: 0.4, electromagneticExposure: 0.5, effects: ["communications/navigation disturbance"], evidenceLedger: { orbit: "observed" as const, environment: "observed" as const, particleFlux: "unknown" as const, spacecraftDesign: "partial" as const, healthTelemetry: "unknown" as const, damage: "unknown" as const } };
  const unknown = { profile: { ...profile, completeness: "partial" as const }, state: "unknown" as const, score: null, evidenceLedger: { orbit: "stale" as const, environment: "unknown" as const, particleFlux: "unknown" as const, spacecraftDesign: "partial" as const, healthTelemetry: "unknown" as const, damage: "unknown" as const } };
  const coverage = buildSystemCoverage([observed, unknown] as never, [profile]);
  assert.deepEqual(coverage[0] && [coverage[0].objectCount, coverage[0].unknownObjects, coverage[0].monitoringState], [2, 1, "partial"]);
  assert.equal(coverage[0]?.maxRadiationExposure, 0.4);
  assert.equal(coverage[0]?.maxElectromagneticExposure, 0.5);
  assert.deepEqual(coverage[0]?.effects, ["communications/navigation disturbance"]);
});
