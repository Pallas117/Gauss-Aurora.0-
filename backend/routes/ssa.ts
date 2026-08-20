import { Router, type Response } from "express";
import { requireClearance, requireRole } from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import {
    getRiskZones,
    getSatelliteObjects,
    getLatestCanonical,
} from "../state.js";
import { getTrackedRuntimeMemoryPressureSnapshot } from "../runtime/limit-context-recorder.js";
import { resolveSpaceDomainAvailability } from "../ssa/availability.js";
import { getSpaceDomainAnalysis } from "../ssa/live-analysis.js";
import { getSpaceDomainSnapshot } from "../ssa/space-domain-store.js";
import { buildSpaceDomainSummary } from "../ssa/ssa-features.js";
import { toPublicSpaceDomainSnapshot } from "../ssa/space-domain-public.js";
import {
    getSpacecraftHealthEvidence,
    hydratePersistedSpacecraftHealthEvidence,
    persistSpacecraftHealthEvidence,
    setSpacecraftHealthEvidence,
    validateSpacecraftHealthEvidence,
} from "../ssa/spacecraft-health-store.js";
import {
    getSpacecraftSystemHealthEvidence,
    hydratePersistedSpacecraftSystemHealthEvidence,
    persistSpacecraftSystemHealthEvidence,
    setSpacecraftSystemHealthEvidence,
    validateSpacecraftSystemHealthEvidence,
} from "../ssa/spacecraft-system-health-store.js";
import {
    getSpacecraftDesignEvidence,
    hydratePersistedSpacecraftDesignEvidence,
    persistSpacecraftDesignEvidence,
    setSpacecraftDesignEvidence,
    validateSpacecraftDesignEvidence,
} from "../ssa/spacecraft-design-evidence-store.js";
import {
    getSpacecraftSystemProfiles,
    hydratePersistedSpacecraftSystemProfiles,
    persistSpacecraftSystemProfile,
    setSpacecraftSystemProfile,
    validateSpacecraftSystemProfile,
} from "../ssa/spacecraft-system-profile-store.js";
import { assessSatellite, PUBLIC_SCREENING_SYSTEMS, resolveScreeningProfile, summarizeScreening, type ScreeningAssessment } from "../ssa/spacecraft-risk-screening.js";
import { buildRadiationMonitoringCatalog } from "../ssa/radiation-monitoring-catalog.js";
import { getApiDocsHtml, getOpenApiDocument } from "../openapi.js";
import type { SatelliteObject } from "../ssa/open-catalog-client.js";
import { buildPublicSevenZoneAssessment } from "../analysis/seven-zone-public.js";

type HistoricalScenario = {
    id: string;
    name: string;
    eventDate: string;
    kpIndex: number;
    tidDoseKrad: number | null;
    tidDoseStatus: "not_observed" | "scenario_proxy";
    eventDurationHours: number;
    affectedSystems: string[];
    provenance: string[];
};

type SystemCoverageRecord = {
    systemId: string;
    missionType: string;
    operator?: string;
    objectCount: number;
    highestState: ScreeningAssessment["state"];
    maxScore: number | null;
    maxRadiationExposure: number | null;
    maxElectromagneticExposure: number | null;
    effects: string[];
    profileCompleteness: "complete" | "partial" | "missing";
    monitoringState: "observed" | "partial" | "unknown" | "not_observed";
    unknownObjects: number;
    expectedObjectCount?: number;
    observedExpectedObjectCount?: number;
    missingExpectedObjectCount?: number;
    coverageRatio?: number;
    missingExpectedNoradIds?: string[];
    expectedNoradIds?: string[];
    observedExpectedNoradIds?: Set<string>;
    freshOrbitObjects: number;
    freshEnvironmentObjects: number;
    freshParticleFluxObjects: number;
    freshHealthObjects: number;
    confirmedDamageObjects: number;
    suspectedDamageObjects: number;
    damageUnknownObjects: number;
    designObservedObjects: number;
};

export function buildSystemCoverage(
    assessments: ScreeningAssessment[],
    profiles: Array<{ systemId: string; missionType: string; operator?: string; expectedNoradIds?: string[]; expectedObjectCount?: number }>,
): SystemCoverageRecord[] {
    const records = new Map<string, SystemCoverageRecord>();
    const ensure = (systemId: string, missionType: string, operator?: string, profileCompleteness: SystemCoverageRecord["profileCompleteness"] = "missing") => {
        const existing = records.get(systemId);
        if (existing) {
            if (existing.profileCompleteness === "missing" && profileCompleteness !== "missing") existing.profileCompleteness = profileCompleteness;
            if (!existing.operator && operator) existing.operator = operator;
            return existing;
        }
        const record: SystemCoverageRecord = { systemId, missionType, ...(operator ? { operator } : {}), objectCount: 0, highestState: "unknown", maxScore: null, maxRadiationExposure: null, maxElectromagneticExposure: null, effects: [], profileCompleteness, monitoringState: "not_observed", unknownObjects: 0, freshOrbitObjects: 0, freshEnvironmentObjects: 0, freshParticleFluxObjects: 0, freshHealthObjects: 0, confirmedDamageObjects: 0, suspectedDamageObjects: 0, damageUnknownObjects: 0, designObservedObjects: 0 };
        records.set(systemId, record);
        return record;
    };
    for (const profile of profiles) {
        const record = ensure(profile.systemId, profile.missionType, profile.operator, "partial");
        const expectedCount = profile.expectedObjectCount ?? profile.expectedNoradIds?.length;
        if (expectedCount !== undefined) {
            record.expectedObjectCount = expectedCount;
            record.expectedNoradIds = profile.expectedNoradIds;
            record.observedExpectedNoradIds = new Set<string>();
            record.observedExpectedObjectCount = 0;
            record.missingExpectedObjectCount = expectedCount;
            record.coverageRatio = 0;
        }
    }
    for (const assessment of assessments) {
        const record = ensure(assessment.profile.systemId, assessment.profile.missionType, assessment.profile.operator, assessment.profile.completeness);
        record.objectCount += 1;
        if (record.highestState === "unknown" || ({ nominal: 0, watch: 1, high: 2, critical: 3, unknown: -1 }[assessment.state] ?? -1) > ({ nominal: 0, watch: 1, high: 2, critical: 3, unknown: -1 }[record.highestState] ?? -1)) record.highestState = assessment.state;
        if (assessment.score !== null && (record.maxScore === null || assessment.score > record.maxScore)) record.maxScore = assessment.score;
        if (assessment.radiationExposure !== null && (record.maxRadiationExposure === null || assessment.radiationExposure > record.maxRadiationExposure)) record.maxRadiationExposure = assessment.radiationExposure;
        if (assessment.electromagneticExposure !== null && (record.maxElectromagneticExposure === null || assessment.electromagneticExposure > record.maxElectromagneticExposure)) record.maxElectromagneticExposure = assessment.electromagneticExposure;
        for (const effect of assessment.effects ?? []) if (!record.effects.includes(effect) && record.effects.length < 12) record.effects.push(effect);
        if (assessment.evidenceLedger.orbit === "observed") record.freshOrbitObjects += 1;
        if (assessment.evidenceLedger.environment === "observed") record.freshEnvironmentObjects += 1;
        if (assessment.evidenceLedger.particleFlux === "observed") record.freshParticleFluxObjects += 1;
        if (assessment.evidenceLedger.healthTelemetry === "observed") record.freshHealthObjects += 1;
        if (assessment.evidenceLedger.damage === "observed") record.confirmedDamageObjects += 1;
        if (assessment.damageStatus === "suspected") record.suspectedDamageObjects += 1;
        if (assessment.damageStatus === "unknown") record.damageUnknownObjects += 1;
        if (assessment.evidenceLedger.spacecraftDesign === "observed") record.designObservedObjects += 1;
        if (record.expectedObjectCount !== undefined) {
            const isExpected = record.expectedNoradIds ? record.expectedNoradIds.includes(assessment.satellite.noradId) : true;
            if (isExpected && (!record.observedExpectedNoradIds || !record.observedExpectedNoradIds.has(assessment.satellite.noradId))) {
                record.observedExpectedNoradIds?.add(assessment.satellite.noradId);
                record.observedExpectedObjectCount = Math.min(record.expectedObjectCount, (record.observedExpectedObjectCount ?? 0) + 1);
            }
        }
        if (assessment.state === "unknown") record.unknownObjects += 1;
    }
    for (const record of records.values()) {
        if (record.objectCount === 0) record.monitoringState = "not_observed";
        else if (record.unknownObjects === record.objectCount) record.monitoringState = "unknown";
        else if (record.unknownObjects > 0) record.monitoringState = "partial";
        else record.monitoringState = "observed";
        if (record.expectedObjectCount !== undefined) {
            record.missingExpectedObjectCount = Math.max(record.expectedObjectCount - (record.observedExpectedObjectCount ?? 0), 0);
            record.coverageRatio = record.expectedObjectCount === 0 ? 0 : Math.min(1, (record.observedExpectedObjectCount ?? 0) / record.expectedObjectCount);
            if (record.expectedNoradIds && record.observedExpectedNoradIds) record.missingExpectedNoradIds = record.expectedNoradIds.filter((noradId) => !record.observedExpectedNoradIds!.has(noradId));
        }
    }
    return [...records.values()].sort((a, b) => a.systemId.localeCompare(b.systemId)).map(({ expectedNoradIds: _expectedNoradIds, observedExpectedNoradIds: _observedExpectedNoradIds, ...record }) => record);
}

type FleetCoverageCatalog = {
    available: boolean;
    complete: boolean;
    truncated: boolean;
    sourceFailures: string[];
    fetchedAt: string | null;
};

export function buildFleetCoverageVerdict(options: {
    catalog: FleetCoverageCatalog;
    assessments: ScreeningAssessment[];
    profiles: Array<{ systemId: string; missionType: string; operator?: string; expectedNoradIds?: string[]; expectedObjectCount?: number }>;
    nowMs?: number;
}) {
    const nowMs = options.nowMs ?? Date.now();
    const systemCoverage = buildSystemCoverage(options.assessments, options.profiles);
    const expectedProfiles = options.profiles.filter((profile) => profile.expectedObjectCount !== undefined || profile.expectedNoradIds?.length);
    const identityGaps = options.assessments.filter((assessment) => assessment.profile.completeness === "missing").length;
    const expectedFleetGaps = systemCoverage.some((record) => record.expectedObjectCount !== undefined && (record.missingExpectedObjectCount ?? 0) > 0);
    const catalogFresh = Boolean(options.catalog.available && options.catalog.fetchedAt && freshnessState(options.catalog.fetchedAt, 24 * 60 * 60 * 1000, nowMs) === "observed");
    const blockers: string[] = [];
    if (!catalogFresh) blockers.push("catalog_missing_or_stale");
    if (!options.catalog.complete || options.catalog.truncated || options.catalog.sourceFailures.length > 0) blockers.push("catalog_partial");
    if (identityGaps > 0) blockers.push("unprofiled_systems_present");
    if (expectedProfiles.length === 0) blockers.push("expected_fleet_manifests_missing");
    if (expectedFleetGaps) blockers.push("expected_fleet_reconciliation_incomplete");
    return {
        globalFleetCoverage: blockers.length === 0,
        blockers,
        evidence: {
            catalogFresh,
            catalogComplete: options.catalog.complete && !options.catalog.truncated && options.catalog.sourceFailures.length === 0,
            identityGaps,
            expectedFleetProfiles: expectedProfiles.length,
            expectedFleetGaps,
        },
    };
}

export type ExposureDimension = "radiation" | "electromagnetic";

export function matchesExposureDimension(
    assessment: ScreeningAssessment,
    dimension: ExposureDimension | null,
    minimumExposure = 0.38,
): boolean {
    if (!dimension) return true;
    const exposure = dimension === "radiation" ? assessment.radiationExposure : assessment.electromagneticExposure;
    return exposure !== null && exposure >= minimumExposure;
}

export function prioritizeScreeningAssessments(assessments: ScreeningAssessment[]): ScreeningAssessment[] {
    const stateRank: Record<ScreeningAssessment["state"], number> = { critical: 4, high: 3, watch: 2, nominal: 1, unknown: 0 };
    return [...assessments].sort((left, right) =>
        (stateRank[right.state] - stateRank[left.state]) ||
        ((right.score ?? -1) - (left.score ?? -1)) ||
        ((right.radiationExposure ?? -1) - (left.radiationExposure ?? -1)) ||
        left.satellite.noradId.localeCompare(right.satellite.noradId),
    );
}

export function toPublicScreeningExposure(assessment: ScreeningAssessment) {
    return {
        satellite: {
            noradId: assessment.satellite.noradId,
            name: assessment.satellite.name,
            orbitType: assessment.satellite.orbitType,
            altitudeKm: assessment.satellite.altitudeKm,
        },
        systemId: assessment.profile.systemId,
        state: assessment.state,
        score: assessment.score,
        radiationExposure: assessment.radiationExposure,
        electromagneticExposure: assessment.electromagneticExposure,
        vanAllenRegion: assessment.vanAllenRegion,
        effects: assessment.effects,
        observedAt: assessment.satellite.observedAt,
    };
}

export function buildRiskActivity(assessments: ScreeningAssessment[], candidateLimit = 25) {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(candidateLimit)));
    const stateCounts = assessments.reduce<Record<ScreeningAssessment["state"], number>>((counts, assessment) => {
        counts[assessment.state] += 1;
        return counts;
    }, { nominal: 0, watch: 0, high: 0, critical: 0, unknown: 0 });
    const candidates = prioritizeScreeningAssessments(assessments)
        .filter((assessment) => assessment.state === "high" || assessment.state === "critical")
        .slice(0, boundedLimit)
        .map(toPublicScreeningExposure);
    const systemRanks: Record<ScreeningAssessment["state"], number> = { nominal: 1, watch: 2, high: 3, critical: 4, unknown: 0 };
    const highestBySystem = new Map<string, ScreeningAssessment["state"]>();
    for (const assessment of assessments) {
        const systemId = assessment.profile.systemId;
        const previous = highestBySystem.get(systemId);
        if (!previous || systemRanks[assessment.state] > systemRanks[previous]) highestBySystem.set(systemId, assessment.state);
    }
    const systemCounts = [...highestBySystem.values()].reduce<Record<ScreeningAssessment["state"], number>>((counts, state) => {
        counts[state] += 1;
        return counts;
    }, { nominal: 0, watch: 0, high: 0, critical: 0, unknown: 0 });
    return {
        protocol: "gauss-radiation-risk-v1" as const,
        monitoredObjects: assessments.length,
        stateCounts,
        candidateCount: stateCounts.high + stateCounts.critical,
        candidateLimit: boundedLimit,
        systemCounts,
        criticalSystemCount: systemCounts.critical,
        highSystemCount: systemCounts.high,
        candidates,
        admission: "observe_only" as const,
        note: "Candidates are bounded environmental screening signals; they are not spacecraft commands, dose measurements, or damage conclusions.",
    };
}

function freshnessState(observedAt: string | null, maxAgeMs: number, nowMs = Date.now()): "observed" | "stale" | "unknown" {
    if (!observedAt) return "unknown";
    const observedMs = Date.parse(observedAt);
    if (!Number.isFinite(observedMs)) return "unknown";
    const ageMs = nowMs - observedMs;
    return ageMs >= 0 && ageMs <= maxAgeMs ? "observed" : "stale";
}

export function countFreshRadiationFeeds(environment: { radiation?: { observedAt: string }; supplementalRadiation?: Array<{ observedAt: string }> } | null, nowMs = Date.now()): number {
    const goes = environment?.radiation && freshnessState(environment.radiation.observedAt, 15 * 60 * 1000, nowMs) === "observed" ? 1 : 0;
    const supplemental = environment?.supplementalRadiation?.filter((feed) => freshnessState(feed.observedAt, 15 * 60 * 1000, nowMs) === "observed").length ?? 0;
    return goes + supplemental;
}

export function spaceWeatherState(environment: { timestamp: string; quality?: { stale?: boolean; conflicting?: boolean } } | null, nowMs = Date.now()): "observed" | "stale" | "conflicting" | "unknown" {
    if (!environment) return "unknown";
    if (environment.quality?.conflicting) return "conflicting";
    if (environment.quality?.stale) return "stale";
    return freshnessState(environment.timestamp, 15 * 60 * 1000, nowMs);
}

const KNOWN_PUBLIC_FAMILY = /\b(ISS|ZARYA|UNITY|HARMONY|TIANHE|GPS|NAVSTAR|STARLINK|IRIDIUM|GALILEO|BEIDOU|BDS|ONEWEB|SENTINEL|LANDSAT|GOES)\b/i;

const IDENTITY_VERIFICATION_SOURCES = [
    { provider: "SatNOGS DB", url: "https://db.satnogs.org/satellites/", access: "public_link", trust: "cross_check_only", note: "Crowdsourced metadata requires operator verification." },
    { provider: "CelesTrak GP", urlTemplate: "https://celestrak.org/NORAD/elements/gp.php?CATNR=<noradId>&FORMAT=json", access: "public_machine_readable", trust: "cross_check_only", note: "Public GP identity/orbit record; not ownership or mission qualification." },
] as const;

function identityVerificationSourcesFor(noradId: string) {
    return [
        { provider: IDENTITY_VERIFICATION_SOURCES[0].provider, url: IDENTITY_VERIFICATION_SOURCES[0].url, action: IDENTITY_VERIFICATION_SOURCES[0].note, trust: IDENTITY_VERIFICATION_SOURCES[0].trust },
        { provider: IDENTITY_VERIFICATION_SOURCES[1].provider, url: IDENTITY_VERIFICATION_SOURCES[1].urlTemplate.replace("<noradId>", encodeURIComponent(noradId)), action: IDENTITY_VERIFICATION_SOURCES[1].note, trust: IDENTITY_VERIFICATION_SOURCES[1].trust },
    ];
}

function identityGapFamily(name: string, unidentified = false): string | null {
    const normalized = name.trim().replace(/[^A-Za-z0-9]+/g, " ");
    if (!normalized || KNOWN_PUBLIC_FAMILY.test(normalized)) return null;
    if (unidentified || /^(OBJECT|UNKNOWN|DEB|TBA|SAT)(\s|$)/i.test(normalized)) return "UNKNOWN-PUBLIC-SYSTEM";
    const token = normalized.split(/\s+/)[0] ?? "";
    return token.length >= 3 ? token.toUpperCase().slice(0, 48) : null;
}

export function buildIdentityGapQueue(objects: SatelliteObject[], maxFamilies = 50, samplesPerFamily = 20) {
    const grouped = new Map<string, { count: number; samples: SatelliteObject[] }>();
    for (const object of objects) {
        if (object.objectClass === "debris" || object.objectClass === "rocket_body") continue;
        const family = identityGapFamily(object.name, object.unidentified);
        if (!family) continue;
        const group = grouped.get(family) ?? { count: 0, samples: [] };
        group.count += 1;
        if (group.samples.length < samplesPerFamily) group.samples.push(object);
        grouped.set(family, group);
    }
    return [...grouped.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .slice(0, Math.max(1, Math.min(maxFamilies, 100)))
        .map(([family, entries]) => ({
            family,
            objectCount: entries.count,
            action: "operator_profile_required" as const,
            objects: entries.samples.map((object) => ({
                noradId: object.noradId,
                name: object.name,
                orbitType: object.orbitType,
                altitudeKm: object.altitudeKm,
                observedAt: object.observedAt,
                verificationSources: identityVerificationSourcesFor(object.noradId),
            })),
        }));
}

export function buildMonitoringCoverage() {
    const snapshot = getSatelliteObjects();
    const domainAvailability = snapshot
        ? resolveSpaceDomainAvailability(getSpaceDomainSnapshot(), getTrackedRuntimeMemoryPressureSnapshot()).availability
        : null;
    const latestEnvironment = getLatestCanonical();
    const coverage = snapshot?.coverage ?? null;
    const objects = snapshot?.objects ?? [];
    const objectClassCounts = coverage?.objectClassCounts ?? { spacecraft: 0, rocket_body: 0, debris: 0, unknown: 0 };
    const catalogState = freshnessState(coverage?.fetchedAt ?? null, 24 * 60 * 60 * 1000);
    const environmentState = spaceWeatherState(latestEnvironment);
    const excludedObjects = objectClassCounts.rocket_body + objectClassCounts.debris;
    const identityGapCounts = new Map<string, number>();
    for (const object of objects) {
        if (object.objectClass === "debris" || object.objectClass === "rocket_body") continue;
        const family = identityGapFamily(object.name, object.unidentified);
        if (family) identityGapCounts.set(family, (identityGapCounts.get(family) ?? 0) + 1);
    }
    const identityGapFamilies = [...identityGapCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 50)
        .map(([family, objectsCount]) => ({ family, objects: objectsCount }));
    const identityGapObjectCount = [...identityGapCounts.values()].reduce((sum, count) => sum + count, 0);
    const publicAssessments = objects
        .filter((object) => object.objectClass !== "debris" && object.objectClass !== "rocket_body")
        .map((object) => assessSatellite(object, latestEnvironment, Date.now(), undefined, undefined, []));
    const publicSystemCoverage = buildSystemCoverage(publicAssessments, PUBLIC_SCREENING_SYSTEMS);
    const publicFleetCoverage = buildFleetCoverageVerdict({
        catalog: {
            available: snapshot !== null,
            complete: coverage?.complete ?? false,
            truncated: coverage?.truncated ?? true,
            sourceFailures: coverage?.sourceFailures ?? [],
            fetchedAt: coverage?.fetchedAt ?? null,
        },
        assessments: publicAssessments,
        profiles: PUBLIC_SCREENING_SYSTEMS,
    });
    const topExposures = prioritizeScreeningAssessments(publicAssessments).slice(0, 25).map(toPublicScreeningExposure);
    const topElectromagneticExposures = publicAssessments
        .filter((assessment) => assessment.electromagneticExposure !== null)
        .sort((a, b) => (b.electromagneticExposure ?? -1) - (a.electromagneticExposure ?? -1) || (b.score ?? -1) - (a.score ?? -1))
        .slice(0, 25)
        .map(toPublicScreeningExposure);
    const topRadiationExposures = publicAssessments
        .filter((assessment) => assessment.radiationExposure !== null)
        .sort((a, b) => (b.radiationExposure ?? -1) - (a.radiationExposure ?? -1) || (b.score ?? -1) - (a.score ?? -1))
        .slice(0, 25)
        .map(toPublicScreeningExposure);
    const riskActivity = buildRiskActivity(publicAssessments);
    const supplementalRadiationFeeds = (latestEnvironment?.supplementalRadiation ?? []).map((feed) => ({
        id: feed.source,
        measurements: [feed.protonEnergy, feed.electronEnergy],
        state: latestEnvironment?.quality.conflicting ? "conflicting" : freshnessState(feed.observedAt, 15 * 60 * 1000),
        observedAt: feed.observedAt,
        dataset: feed.dataset,
    }));
    const esaConfigured = Boolean(
        process.env.ESA_SWE_HAPI_TOKEN &&
        process.env.ESA_SWE_HAPI_DATASET &&
        process.env.ESA_SWE_HAPI_TIME_PARAMETER &&
        process.env.ESA_SWE_HAPI_PROTON_PARAMETER &&
        process.env.ESA_SWE_HAPI_ELECTRON_PARAMETER,
    );
    const radiationFeedCount = countFreshRadiationFeeds(latestEnvironment);
    const readinessBlockers: string[] = [];
    if (catalogState !== "observed") readinessBlockers.push("catalog_missing_or_stale");
    if (coverage?.complete !== true || coverage?.truncated || (coverage?.sourceFailures?.length ?? 0) > 0) readinessBlockers.push("catalog_partial");
    if (environmentState !== "observed") readinessBlockers.push("space_weather_missing_or_stale");
    if (radiationFeedCount === 0) readinessBlockers.push("particle_flux_missing_or_stale");
    if (identityGapObjectCount > 0) readinessBlockers.push("unprofiled_systems_present");
    const operationalBlockers = readinessBlockers.filter((blocker) => blocker !== "unprofiled_systems_present");
    const allReadinessBlockers = [...new Set([...readinessBlockers, ...publicFleetCoverage.blockers])];

    return {
        scope: "public_catalog_screening",
        generatedAt: new Date().toISOString(),
        catalog: {
            state: catalogState,
            provenance: !snapshot ? "none" : domainAvailability?.mode === "live" ? "live_ingest" : domainAvailability?.projectionSource === "disk" ? "disk_projection" : domainAvailability?.mode === "projected" ? "memory_projection" : "stale_or_warming",
            available: snapshot !== null,
            complete: coverage?.complete ?? false,
            truncated: coverage?.truncated ?? false,
            catalogGroup: coverage?.catalogGroup ?? null,
            sourceUrls: coverage?.sourceUrls ?? [],
            sourceFailures: coverage?.sourceFailures ?? [],
            fetchedAt: coverage?.fetchedAt ?? null,
            catalogObjects: coverage?.catalogObjects ?? 0,
            parsedObjects: coverage?.parsedObjects ?? 0,
            propagatedObjects: coverage?.propagatedObjects ?? 0,
            returnedObjects: coverage?.returnedObjects ?? objects.length,
            objectLimit: coverage?.objectLimit ?? 0,
        },
        inventory: {
            returnedObjects: objects.length,
            spacecraftObjects: objectClassCounts.spacecraft,
            unknownClassObjects: objectClassCounts.unknown,
            excludedDebrisObjects: objectClassCounts.debris,
            excludedRocketBodies: objectClassCounts.rocket_body,
            excludedObjects,
            monitoredSatelliteObjects: objectClassCounts.spacecraft + objectClassCounts.unknown,
            identityGapObjectCount,
            identityGapFamilies,
        },
        identityVerificationSources: IDENTITY_VERIFICATION_SOURCES,
        systemCoverage: publicSystemCoverage,
        topExposures,
        topElectromagneticExposures,
        topRadiationExposures,
        riskActivity,
        environment: {
            state: environmentState,
            observedAt: latestEnvironment?.timestamp ?? null,
            source: latestEnvironment?.source ?? null,
            stormTier: latestEnvironment?.alerts.stormTier ?? "unknown",
        },
        radiation: {
            feeds: [
                ...(latestEnvironment?.radiation ? [{
                    id: `noaa-goes-seiss-${latestEnvironment.radiation.platform ?? "unknown"}`,
                    measurements: ["proton_flux_gt_10_mev", "electron_flux_gt_2_mev"],
                    state: latestEnvironment.quality.conflicting ? "conflicting" : freshnessState(latestEnvironment.radiation.observedAt, 15 * 60 * 1000),
                    observedAt: latestEnvironment.radiation.observedAt,
                }] : [{
                    id: "noaa-goes-seiss-unknown",
                    measurements: ["proton_flux_gt_10_mev", "electron_flux_gt_2_mev"],
                    state: "unknown" as const,
                    observedAt: null,
                }]),
                ...supplementalRadiationFeeds,
            ],
            availableFeedCount: radiationFeedCount,
            configuredFeeds: ["noaa-goes-seiss-primary", "noaa-goes-seiss-secondary", ...(esaConfigured ? ["esa-swe-ngrm"] : [])],
            candidateFeeds: ["esa-swe-ngrm"],
            note: "Flux is a particle-environment proxy; it is not spacecraft dose or damage telemetry.",
        },
        assessment: {
            supportedEffects: ["radiation exposure", "single-event upset screening", "charging exposure", "communications/navigation disturbance", "thermospheric drag sensitivity"],
            states: ["nominal", "watch", "high", "critical", "unknown"],
            damageConclusionAvailable: false,
            missionHealthEvidenceRequired: true,
            spacecraftDesignEvidenceRequired: true,
        },
        readiness: {
            operationalScreening: operationalBlockers.length === 0,
            globalFleetCoverage: publicFleetCoverage.globalFleetCoverage,
            confirmedDamageAssessment: false,
            blockers: allReadinessBlockers,
            fleetEvidence: publicFleetCoverage.evidence,
        },
        limitations: [
            "Public catalog coverage is not proof that every operational satellite is present or correctly identified.",
            "Debris and rocket bodies are inventoried but excluded from spacecraft-system exposure scoring.",
            "Unknown-class objects remain monitored as unprofiled until mission identity is established.",
            "Risk is a screening result, not a dose, damage, or failure probability; mission telemetry and design data are required for confirmation.",
            "Public system coverage contains no protected health or design evidence; it describes catalog presence and environmental evidence only.",
        ],
    };
}

// Public historical context for replay. TID is null where no spacecraft-specific
// dosimetry exists; the API must not turn an event index into a false dose claim.
const HISTORICAL_SCENARIOS: HistoricalScenario[] = [
    { id: "gannon-g5-2024", name: "Gannon G5 Event", eventDate: "2024-05-10", kpIndex: 9, tidDoseKrad: null, tidDoseStatus: "not_observed", eventDurationHours: 39, affectedSystems: ["LEO spacecraft", "GNSS", "HF communications", "power grids"], provenance: ["https://www.swpc.noaa.gov/news/g5-geomagnetic-storm-may-10-11-2024"] },
    { id: "halloween-storm-2003", name: "Halloween Storm", eventDate: "2003-10-29", kpIndex: 9, tidDoseKrad: null, tidDoseStatus: "not_observed", eventDurationHours: 48, affectedSystems: ["LEO spacecraft", "satellite navigation", "HF communications", "power systems"], provenance: ["https://www.swpc.noaa.gov/phenomena/geomagnetic-storms"] },
    { id: "quebec-1989", name: "March 1989 Quebec Event", eventDate: "1989-03-13", kpIndex: 9, tidDoseKrad: null, tidDoseStatus: "not_observed", eventDurationHours: 12, affectedSystems: ["power grids", "HF communications", "satellite operations"], provenance: ["https://www.nasa.gov/history/solar-storms-and-space-weather/", "https://www.swpc.noaa.gov/phenomena/geomagnetic-storms"] },
    { id: "bastille-day-2000", name: "July 2000 Bastille Day Event", eventDate: "2000-07-14", kpIndex: 9, tidDoseKrad: null, tidDoseStatus: "not_observed", eventDurationHours: 24, affectedSystems: ["satellite electronics", "spacecraft charging", "HF communications", "astronaut radiation environment"], provenance: ["https://www.swpc.noaa.gov/phenomena/solar-flares-radio-blackouts"] },
    { id: "x28-flare-2003", name: "November 2003 X28 Flare", eventDate: "2003-11-04", kpIndex: 8, tidDoseKrad: null, tidDoseStatus: "not_observed", eventDurationHours: 6, affectedSystems: ["HF communications", "spacecraft sensors", "GNSS", "aviation communications"], provenance: ["https://www.swpc.noaa.gov/phenomena/solar-flares-radio-blackouts"] },
    { id: "x9-3-2017", name: "September 2017 X9.3 Event", eventDate: "2017-09-06", kpIndex: 8, tidDoseKrad: null, tidDoseStatus: "not_observed", eventDurationHours: 24, affectedSystems: ["HF communications", "GNSS", "polar aviation", "spacecraft electronics"], provenance: ["https://www.swpc.noaa.gov/phenomena/solar-flares-radio-blackouts"] },
    { id: "carrington-scale-reference", name: "Carrington-Scale Reference Scenario", eventDate: "1859-09-02", kpIndex: 9, tidDoseKrad: null, tidDoseStatus: "not_observed", eventDurationHours: 24, affectedSystems: ["global power systems", "satellite constellations", "GNSS", "HF communications", "LEO drag environment"], provenance: ["https://www.swpc.noaa.gov/phenomena/geomagnetic-storms"] },
];

/** Build the authenticated fleet assessment once for screening and capacity planning. */
export async function buildFleetExposureAssessments() {
    const snapshot = getSatelliteObjects();
    const environment = getLatestCanonical();
    await Promise.all([
        hydratePersistedSpacecraftHealthEvidence(),
        hydratePersistedSpacecraftSystemHealthEvidence(),
        hydratePersistedSpacecraftDesignEvidence(),
        hydratePersistedSpacecraftSystemProfiles(),
    ]);
    const healthByNorad = new Map(getSpacecraftHealthEvidence().map((evidence) => [evidence.noradId, evidence]));
    const systemHealthById = new Map(getSpacecraftSystemHealthEvidence().map((evidence) => [evidence.systemId, evidence]));
    const designEvidence = getSpacecraftDesignEvidence();
    const designByNorad = new Map(designEvidence.filter((evidence) => evidence.noradId).map((evidence) => [evidence.noradId!, evidence]));
    const designBySystem = new Map(designEvidence.filter((evidence) => evidence.systemId).map((evidence) => [evidence.systemId!, evidence]));
    const profiles = getSpacecraftSystemProfiles();
    const objects = (snapshot?.objects ?? []).filter((object) => object.objectClass !== "debris" && object.objectClass !== "rocket_body");
    const assessments = objects.map((object) => {
        const profile = resolveScreeningProfile(object, profiles);
        const systemHealth = systemHealthById.get(profile.systemId);
        const health = healthByNorad.get(object.noradId) ?? (systemHealth ? { ...systemHealth, noradId: object.noradId } : undefined);
        const design = designByNorad.get(object.noradId) ?? designBySystem.get(profile.systemId);
        return assessSatellite(object, environment, Date.now(), health, design, profiles);
    });
    return { snapshot, environment, profiles, assessments };
}

export function mountSsaRoutes(app: Router) {
    app.get("/api/openapi.json", (_req: AuthenticatedRequest, res: Response) => {
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.json(getOpenApiDocument());
    });
    app.get("/api/docs", (_req: AuthenticatedRequest, res: Response) => {
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.type("html").send(getApiDocsHtml());
    });
    app.get("/api/ssa/radiation-monitoring-catalog", (_req: AuthenticatedRequest, res: Response) => {
        res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
        res.json(buildRadiationMonitoringCatalog(getLatestCanonical()));
    });

    app.get("/api/physics/scenarios", (_req: AuthenticatedRequest, res: Response) => {
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.json({ scenarios: HISTORICAL_SCENARIOS, count: HISTORICAL_SCENARIOS.length, generatedAt: new Date().toISOString() });
    });

    app.get("/api/physics/scenarios/:id", (req: AuthenticatedRequest, res: Response) => {
        const scenario = HISTORICAL_SCENARIOS.find((candidate) => candidate.id === req.params.id);
        if (!scenario) {
            res.status(404).json({ error: "Historical scenario not found", availableIds: HISTORICAL_SCENARIOS.map((candidate) => candidate.id) });
            return;
        }
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.json(scenario);
    });

    app.get("/api/ssa/risk-zones", (_req: AuthenticatedRequest, res: Response) => {
        const snapshot = getRiskZones();
        // Cache 5 min server-side to avoid repeated external calls when ingest is the source
        res.setHeader("Cache-Control", "public, max-age=300");
        if (!snapshot) {
            res.json({ riskZones: [], updatedAt: new Date().toISOString() });
            return;
        }
        res.json(snapshot);
    });

    app.get("/api/ssa/satellites", (_req: AuthenticatedRequest, res: Response) => {
        const snapshot = getSatelliteObjects();
        res.setHeader("Cache-Control", "public, max-age=300");
        if (!snapshot) {
            res.json({
                objects: [],
                highValue: [],
                unidentified: [],
                updatedAt: new Date().toISOString(),
                coverage: { catalogGroup: "active", sourceUrl: "", sourceUrls: [], sourceFailures: [], complete: false, catalogObjects: 0, parsedObjects: 0, propagatedObjects: 0, returnedObjects: 0, objectLimit: 12_000, truncated: true, fetchedAt: new Date().toISOString(), objectClassCounts: { spacecraft: 0, rocket_body: 0, debris: 0, unknown: 0 } },
            });
            return;
        }
        res.json(snapshot);
    });

    app.get("/api/ssa/monitoring-coverage", (_req: AuthenticatedRequest, res: Response) => {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        res.json(buildMonitoringCoverage());
    });

    app.get("/api/ssa/identity-gaps", (req: AuthenticatedRequest, res: Response) => {
        const snapshot = getSatelliteObjects();
        const rawLimit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 50;
        if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
            res.status(400).json({ error: "limit must be an integer between 1 and 100" });
            return;
        }
        const familyFilter = typeof req.query.family === "string" ? req.query.family.trim().toUpperCase() : null;
        const gaps = buildIdentityGapQueue(snapshot?.objects ?? [], 100).filter((gap) => !familyFilter || gap.family === familyFilter).slice(0, rawLimit);
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        res.json({
            scope: "public_identity_gap_queue",
            generatedAt: new Date().toISOString(),
            catalogFetchedAt: snapshot?.coverage.fetchedAt ?? null,
            catalogSourceUrls: snapshot?.coverage.sourceUrls ?? [],
            gaps,
            count: gaps.length,
            limitations: [
                "Identity gaps are unowned catalog families, not ownership assignments.",
                "Objects in this queue remain unknown for exposure screening until an approved system profile is submitted.",
                "Debris and rocket bodies are excluded from this spacecraft identity queue.",
            ],
        });
    });

    app.get("/api/ssa/identity-verification/:noradId", (req: AuthenticatedRequest, res: Response) => {
        const noradId = typeof req.params.noradId === "string" ? req.params.noradId.trim() : "";
        if (!/^\d{1,8}$/.test(noradId)) {
            res.status(400).json({ error: "noradId must be a numeric catalog identifier" });
            return;
        }
        const object = getSatelliteObjects()?.objects.find((candidate) => candidate.noradId === noradId) ?? null;
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        res.json({
            scope: "public_identity_verification",
            noradId,
            status: object ? "candidate_match" : "not_in_current_catalog",
            catalogFetchedAt: getSatelliteObjects()?.coverage.fetchedAt ?? null,
            object: object ? {
                noradId: object.noradId,
                name: object.name,
                orbitType: object.orbitType,
                altitudeKm: object.altitudeKm,
                objectClass: object.objectClass ?? "unknown",
                observedAt: object.observedAt,
            } : null,
            verificationSources: identityVerificationSourcesFor(noradId),
            nextAction: "operator_profile_required",
            limitations: [
                "This endpoint provides public identity cross-checks only; it does not verify ownership, mission identity, shielding, or radiation qualification.",
                "Submit an approved system profile or mission evidence before using identity as fleet-coverage proof.",
            ],
        });
    });

    app.get(
        "/api/ssa/exposure-screening",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
            const systemIdFilter = typeof req.query.systemId === "string" ? req.query.systemId.trim().toLowerCase() : null;
            const stateFilter = typeof req.query.state === "string" ? req.query.state.trim().toLowerCase() : null;
            const dimensionFilter = typeof req.query.dimension === "string" ? req.query.dimension.trim().toLowerCase() : null;
            const dimension = dimensionFilter === "radiation" || dimensionFilter === "electromagnetic" ? dimensionFilter as ExposureDimension : null;
            if (dimensionFilter && !dimension) {
                res.status(400).json({ error: "Invalid dimension filter", allowed: ["radiation", "electromagnetic"] });
                return;
            }
            const rawMinimumExposure = typeof req.query.minExposure === "string" ? Number(req.query.minExposure) : 0.38;
            if (!Number.isFinite(rawMinimumExposure) || rawMinimumExposure < 0 || rawMinimumExposure > 1) {
                res.status(400).json({ error: "minExposure must be a number between 0 and 1" });
                return;
            }
            const validStates = new Set<ScreeningAssessment["state"]>(["nominal", "watch", "high", "critical", "unknown"]);
            if (stateFilter && !validStates.has(stateFilter as ScreeningAssessment["state"])) {
                res.status(400).json({ error: "Invalid state filter", allowed: [...validStates] });
                return;
            }
            const rawLimit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 500;
            if (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > 1_000) {
                res.status(400).json({ error: "limit must be an integer between 1 and 1000" });
                return;
            }
            const { snapshot, environment, profiles, assessments } = await buildFleetExposureAssessments();
            const systemCoverage = buildSystemCoverage(assessments, [...PUBLIC_SCREENING_SYSTEMS, ...profiles]);
            const fleetCoverage = buildFleetCoverageVerdict({
                catalog: {
                    available: snapshot !== null,
                    complete: snapshot?.coverage.complete ?? false,
                    truncated: snapshot?.coverage.truncated ?? true,
                    sourceFailures: snapshot?.coverage.sourceFailures ?? [],
                    fetchedAt: snapshot?.coverage.fetchedAt ?? null,
                },
                assessments,
                profiles: [...PUBLIC_SCREENING_SYSTEMS, ...profiles],
            });
            const filteredAssessments = assessments.filter((assessment) => {
                if (systemIdFilter && assessment.profile.systemId !== systemIdFilter) return false;
                if (stateFilter && assessment.state !== stateFilter) return false;
                if (!matchesExposureDimension(assessment, dimension, rawMinimumExposure)) return false;
                return true;
            });
            const prioritizedAssessments = prioritizeScreeningAssessments(filteredAssessments);
            const returnedAssessments = prioritizedAssessments.slice(0, rawLimit);
            res.setHeader("Cache-Control", "no-store");
            res.json({
                scope: "authenticated_fleet_exposure_screening",
                generatedAt: new Date().toISOString(),
                environmentObservedAt: environment?.timestamp ?? null,
                query: { systemId: systemIdFilter, state: stateFilter, dimension, minExposure: rawMinimumExposure, limit: rawLimit },
                matchedAssessments: filteredAssessments.length,
                returnedAssessments: returnedAssessments.length,
                assessments: returnedAssessments,
                summary: summarizeScreening(returnedAssessments),
                fleetSummary: summarizeScreening(assessments),
                systemCoverage,
                readiness: fleetCoverage,
                limitations: ["This is an environmental screening result, not a dose, damage, or failure probability.", "Objects without fresh orbit/environment evidence remain unknown.", "System-scoped evidence is expanded only through an approved system profile; exact NORAD evidence takes precedence."],
            });
        }),
    );

    app.get(
        "/api/ssa/spacecraft-health",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (_req: AuthenticatedRequest, res: Response) => {
            await hydratePersistedSpacecraftHealthEvidence();
            res.setHeader("Cache-Control", "no-store");
            res.json({ evidence: getSpacecraftHealthEvidence(), updatedAt: new Date().toISOString() });
        }),
    );

    app.get(
        "/api/ssa/system-health",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (_req: AuthenticatedRequest, res: Response) => {
            await hydratePersistedSpacecraftSystemHealthEvidence();
            res.setHeader("Cache-Control", "no-store");
            res.json({ evidence: getSpacecraftSystemHealthEvidence(), updatedAt: new Date().toISOString() });
        }),
    );

    app.get(
        "/api/ssa/spacecraft-design",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (_req: AuthenticatedRequest, res: Response) => {
            await hydratePersistedSpacecraftDesignEvidence();
            res.setHeader("Cache-Control", "no-store");
            res.json({ evidence: getSpacecraftDesignEvidence(), updatedAt: new Date().toISOString() });
        }),
    );

    app.get(
        "/api/ssa/system-profiles",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (_req: AuthenticatedRequest, res: Response) => {
            await hydratePersistedSpacecraftSystemProfiles();
            res.setHeader("Cache-Control", "no-store");
            res.json({ profiles: getSpacecraftSystemProfiles(), updatedAt: new Date().toISOString() });
        }),
    );

    app.post(
        "/api/ssa/spacecraft-health",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
            const body = req.body as { evidence?: unknown };
            const inputs = Array.isArray(body?.evidence) ? body.evidence : [body];
            if (inputs.length === 0 || inputs.length > 100) {
                res.status(400).json({ error: "evidence must contain between 1 and 100 records" });
                return;
            }
            const accepted = [];
            let persisted = 0;
            const errors = [];
            for (const [index, input] of inputs.entries()) {
                const parsed = validateSpacecraftHealthEvidence(input);
                if (!parsed.ok) {
                    errors.push({ index, error: parsed.error });
                    continue;
                }
                setSpacecraftHealthEvidence(parsed.value);
                if (await persistSpacecraftHealthEvidence(parsed.value).catch(() => false)) persisted += 1;
                accepted.push(parsed.value);
            }
            if (errors.length > 0) {
                res.status(400).json({ error: "Invalid spacecraft health evidence", accepted: accepted.length, persisted, errors });
                return;
            }
            res.status(201).json({ ok: true, accepted: accepted.length, persisted, evidence: accepted });
        }),
    );

    app.post(
        "/api/ssa/system-health",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
            const body = req.body as { evidence?: unknown };
            const inputs = Array.isArray(body?.evidence) ? body.evidence : [body];
            if (inputs.length === 0 || inputs.length > 100) {
                res.status(400).json({ error: "evidence must contain between 1 and 100 records" });
                return;
            }
            const accepted = [];
            let persisted = 0;
            const errors = [];
            for (const [index, input] of inputs.entries()) {
                const parsed = validateSpacecraftSystemHealthEvidence(input);
                if (!parsed.ok) {
                    errors.push({ index, error: parsed.error });
                    continue;
                }
                setSpacecraftSystemHealthEvidence(parsed.value);
                if (await persistSpacecraftSystemHealthEvidence(parsed.value).catch(() => false)) persisted += 1;
                accepted.push(parsed.value);
            }
            if (errors.length > 0) {
                res.status(400).json({ error: "Invalid spacecraft system health evidence", accepted: accepted.length, persisted, errors });
                return;
            }
            res.status(201).json({ ok: true, accepted: accepted.length, persisted, evidence: accepted });
        }),
    );

    app.post(
        "/api/ssa/spacecraft-design",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
            const body = req.body as { evidence?: unknown };
            const inputs = Array.isArray(body?.evidence) ? body.evidence : [body];
            if (inputs.length === 0 || inputs.length > 100) {
                res.status(400).json({ error: "evidence must contain between 1 and 100 records" });
                return;
            }
            const parsed = inputs.map(validateSpacecraftDesignEvidence);
            const invalid = parsed.find((result) => !result.ok);
            if (invalid && !invalid.ok) {
                res.status(400).json({ error: invalid.error });
                return;
            }
            const values = parsed.flatMap((result) => result.ok ? [result.value] : []);
            for (const evidence of values) {
                setSpacecraftDesignEvidence(evidence);
                await persistSpacecraftDesignEvidence(evidence);
            }
            res.status(202).json({ accepted: values.length, evidence: values });
        }),
    );

    app.post(
        "/api/ssa/system-profiles",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
            const body = req.body as { profiles?: unknown };
            const inputs = Array.isArray(body?.profiles) ? body.profiles : [body];
            if (inputs.length === 0 || inputs.length > 100) {
                res.status(400).json({ error: "profiles must contain between 1 and 100 records" });
                return;
            }
            const parsed = inputs.map(validateSpacecraftSystemProfile);
            const invalid = parsed.find((result) => !result.ok);
            if (invalid && !invalid.ok) {
                res.status(400).json({ error: invalid.error });
                return;
            }
            const values = parsed.flatMap((result) => result.ok ? [result.value] : []);
            for (const profile of values) {
                setSpacecraftSystemProfile(profile);
                await persistSpacecraftSystemProfile(profile);
            }
            res.status(202).json({ accepted: values.length, profiles: values });
        }),
    );

    app.get("/api/ssa/space-domain", (_req: AuthenticatedRequest, res: Response) => {
        const memorySnapshot = getTrackedRuntimeMemoryPressureSnapshot("ssa-route", {
          route: "/api/ssa/space-domain",
        });
        const { snapshot, availability } = resolveSpaceDomainAvailability(
            getSpaceDomainSnapshot(),
            memorySnapshot,
        );
        const summary = buildSpaceDomainSummary(snapshot);
        res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=25");
        res.json({
            snapshot: toPublicSpaceDomainSnapshot(snapshot),
            availability,
            summary,
            analysis: getSpaceDomainAnalysis(summary, {
                memorySnapshot,
                availability,
            }),
        });
    });

    app.get("/api/ssa/seven-zone", (_req: AuthenticatedRequest, res: Response) => {
        const memorySnapshot = getTrackedRuntimeMemoryPressureSnapshot("ssa-route", {
            route: "/api/ssa/seven-zone",
        });
        const { snapshot, availability } = resolveSpaceDomainAvailability(
            getSpaceDomainSnapshot(),
            memorySnapshot,
        );
        const summary = buildSpaceDomainSummary(snapshot);
        const assessment = buildPublicSevenZoneAssessment({
            generatedAt: new Date().toISOString(),
            availability,
            snapshot: toPublicSpaceDomainSnapshot(snapshot),
            summary,
            memoryLevel: memorySnapshot.level,
        });
        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
        res.json(assessment);
    });
}
