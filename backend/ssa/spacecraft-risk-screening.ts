import type { CanonicalSpaceWeatherPoint } from "../types.js";
import type { SpacecraftHealthEvidence } from "./spacecraft-health-store.js";
import type { SpacecraftDesignEvidence } from "./spacecraft-design-evidence-store.js";
import type { SpacecraftSystemProfile } from "./spacecraft-system-profile-store.js";
import type { SatelliteObject } from "./open-catalog-client.js";

type EvidenceState = "observed" | "stale" | "unknown" | "partial";
export type ScreeningAssessment = {
  satellite: SatelliteObject & { objectClass?: string; observedAt?: string };
  profile: SpacecraftSystemProfile & { completeness: "complete" | "partial" | "missing" };
  state: "nominal" | "watch" | "high" | "critical" | "unknown";
  score: number | null;
  telemetryStatus: "nominal" | "degraded" | "critical" | "unknown";
  damageStatus: "none" | "suspected" | "confirmed" | "unknown";
  radiationExposure: number | null;
  electromagneticExposure: number | null;
  vanAllenRegion: string;
  beltEffects: string[];
  effects: string[];
  provenance: { orbit: { source: string; observedAt: string | null }; environment: { source: string | null; observedAt: string | null } };
  evidenceLedger: { orbit: EvidenceState; environment: EvidenceState; particleFlux: EvidenceState; spacecraftDesign: EvidenceState; healthTelemetry: EvidenceState; damage: EvidenceState };
  limitations: string[];
};

const publicProfile = (systemId: string, aliases: string[], namePatterns: string[], missionType: string): SpacecraftSystemProfile => ({ systemId, aliases, namePatterns, missionType, source: "public-screening-catalog", observedAt: "2026-01-01T00:00:00.000Z" });
export const PUBLIC_SCREENING_SYSTEMS: SpacecraftSystemProfile[] = [
  publicProfile("iss", ["ISS"], ["ISS", "ZARYA"], "crewed_leo"),
  publicProfile("gps", ["GPS"], ["GPS", "NAVSTAR"], "navigation_mEO"),
  publicProfile("starlink", ["STARLINK"], ["STARLINK"], "communications_leo"),
  publicProfile("iridium", ["IRIDIUM"], ["IRIDIUM"], "communications_leo"),
  publicProfile("galileo", ["GALILEO"], ["GALILEO"], "navigation_meo"),
  publicProfile("goes", ["GOES"], ["GOES"], "weather_geo"),
  publicProfile("oneweb", ["ONEWEB"], ["ONEWEB"], "communications_leo"),
  publicProfile("sentinel", ["SENTINEL"], ["SENTINEL"], "earth_observation"),
];

function normalized(value: string): string { return value.trim().toLowerCase(); }
function fresh(observedAt: string | undefined, maxAgeMs: number, nowMs: number): EvidenceState { if (!observedAt) return "unknown"; const age = nowMs - Date.parse(observedAt); return Number.isFinite(age) ? age >= 0 && age <= maxAgeMs ? "observed" : "stale" : "unknown"; }
function unprofiledId(name: string): string { const cleaned = name.trim().replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase(); const token = cleaned.split(/\s+/)[0] ?? "unknown"; return `unprofiled-${token || "unknown"}`.slice(0, 64); }

export function resolveScreeningProfile(object: SatelliteObject & { observedAt?: string }, profiles: SpacecraftSystemProfile[]): SpacecraftSystemProfile & { completeness: "complete" | "partial" | "missing" } {
  const name = normalized(object.name);
  const match = profiles.find((profile) => profile.expectedNoradIds?.includes(object.noradId) || profile.aliases.some((alias) => name.includes(normalized(alias))) || profile.namePatterns.some((pattern) => name.includes(normalized(pattern))));
  if (match) return { ...match, completeness: match.source === "public-screening-catalog" ? "partial" : "complete" };
  return { systemId: unprofiledId(object.name), aliases: [], namePatterns: [], missionType: "unknown", source: "inferred-name-family", observedAt: new Date().toISOString(), completeness: "missing" };
}

function environmentFresh(environment: CanonicalSpaceWeatherPoint | null | undefined, nowMs: number): EvidenceState { return fresh(environment?.timestamp, 15 * 60 * 1000, nowMs); }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }

export function assessSatellite(object: SatelliteObject & { objectClass?: string; observedAt?: string }, environment: CanonicalSpaceWeatherPoint | null | undefined, nowMs = Date.now(), health?: SpacecraftHealthEvidence & { noradId?: string }, design?: SpacecraftDesignEvidence, profiles: SpacecraftSystemProfile[] = []): ScreeningAssessment {
  const profile = resolveScreeningProfile(object, profiles.length > 0 ? profiles : PUBLIC_SCREENING_SYSTEMS);
  const orbitState = fresh(object.observedAt, 24 * 60 * 60 * 1000, nowMs);
  const environmentState = environmentFresh(environment, nowMs);
  const particleState = environment?.radiation ? fresh(environment.radiation.observedAt, 15 * 60 * 1000, nowMs) : "unknown";
  const healthState = fresh(health?.observedAt, 60 * 60 * 1000, nowMs);
  const designState = fresh(design?.observedAt, 24 * 60 * 60 * 1000, nowMs);
  const telemetryStatus = healthState === "observed" ? health?.telemetryStatus ?? "unknown" : "unknown";
  const damageStatus = healthState === "observed" ? health?.damageStatus ?? "unknown" : "unknown";
  const hasFreshEnvironment = environmentState === "observed";
  const kp = environment?.indices?.kp ?? 0;
  const speed = environment?.solarWind?.speed ?? 0;
  const pressure = environment?.solarWind?.dynamicPressure ?? 0;
  const radiationExposure = hasFreshEnvironment ? clamp(Math.max(kp / 9, particleState === "observed" ? 0.35 : 0)) : null;
  const electromagneticExposure = hasFreshEnvironment ? clamp(Math.max(kp / 10, pressure / 20, speed / 1200)) : null;
  const score = radiationExposure === null && electromagneticExposure === null ? null : Math.max(radiationExposure ?? 0, electromagneticExposure ?? 0);
  let state: ScreeningAssessment["state"] = score === null || orbitState !== "observed" ? "unknown" : score >= 0.8 ? "critical" : score >= 0.6 ? "high" : score >= 0.35 ? "watch" : "nominal";
  if (telemetryStatus === "critical" || damageStatus === "confirmed") state = state === "unknown" ? "unknown" : "critical";
  const vanAllenRegion = object.altitudeKm < 2_000 ? "leo_outside_belts" : object.altitudeKm < 35_286 ? "inner_belt_transition" : "geo_outer_belt";
  const effects = ["radiation exposure", "single-event upset screening", "charging exposure", "communications/navigation disturbance", "thermospheric drag sensitivity"];
  return {
    satellite: object,
    profile,
    state,
    score,
    telemetryStatus,
    damageStatus,
    radiationExposure,
    electromagneticExposure,
    vanAllenRegion,
    beltEffects: effects,
    effects,
    provenance: { orbit: { source: orbitState === "observed" ? "configured_tle_catalog" : "catalog_missing_or_stale", observedAt: object.observedAt ?? null }, environment: { source: environment?.source ?? null, observedAt: environment?.timestamp ?? null } },
    evidenceLedger: { orbit: orbitState, environment: environmentState, particleFlux: particleState, spacecraftDesign: designState === "observed" ? "observed" : design ? "partial" : "unknown", healthTelemetry: healthState, damage: healthState === "observed" && damageStatus !== "unknown" ? "observed" : "unknown" },
    limitations: ["This is environmental screening, not a dose, damage, or failure probability.", "Fresh mission telemetry and spacecraft design evidence are required for confirmation.", "No spacecraft command or qualification decision is produced by this assessment."],
  };
}

export function summarizeScreening(assessments: ScreeningAssessment[]) {
  const counts = assessments.reduce<Record<ScreeningAssessment["state"], number>>((acc, item) => { acc[item.state] += 1; return acc; }, { nominal: 0, watch: 0, high: 0, critical: 0, unknown: 0 });
  return { total: assessments.length, ...counts };
}
