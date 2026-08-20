import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const catalogPath = path.join(root, "config", "mission-targets.json");
const schemaPath = path.join(root, "config", "mission-target.schema.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
  schema?: string;
  profiles?: Array<Record<string, any>>;
};
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { properties?: Record<string, { const?: string }> };

const failures: string[] = [];
const allowed = {
  customerSegment: new Set(["commercial_satcom", "weather_space_weather", "earth_observation", "pnt", "lunar_relay", "mission_integrator"]),
  orbit: new Set(["LEO", "MEO", "GEO", "HEO", "lunar_orbit", "lunar_surface", "multi_orbit", "unknown"]),
  deploymentScope: new Set(["ground_only", "simulator", "hosted_payload", "flight_candidate"]),
  criticality: new Set(["routine", "important", "high", "safety_critical"]),
  pilotFit: new Set(["primary", "strategic", "evidence_partner", "future"]),
};

if (catalog.schema !== "gauss-mission-target-catalog-v1") failures.push("catalog schema must be gauss-mission-target-catalog-v1");
if (schema.properties?.schema?.const !== "gauss-mission-target-v1") failures.push("mission target schema version is not pinned");
if (!catalog.profiles || catalog.profiles.length < 5 || catalog.profiles.length > 10) failures.push("catalog must contain between 5 and 10 target profiles");

const ids = new Set<string>();
for (const [index, profile] of (catalog.profiles ?? []).entries()) {
  const label = `profile[${index}]`;
  const required = ["schema", "missionId", "targetSystem", "customerSegment", "orbit", "deploymentScope", "criticality", "spacecraftCount", "interfaces", "dataContract", "radiation", "compute", "evidence"];
  for (const field of required) if (!(field in profile)) failures.push(`${label} missing ${field}`);
  if (profile.schema !== "gauss-mission-target-v1") failures.push(`${label} has an invalid schema`);
  if (typeof profile.missionId !== "string" || !/^[a-z0-9][a-z0-9-]{2,96}$/.test(profile.missionId)) failures.push(`${label} has an invalid missionId`);
  if (typeof profile.missionId === "string") {
    if (ids.has(profile.missionId)) failures.push(`${label} duplicates missionId ${profile.missionId}`);
    ids.add(profile.missionId);
  }
  for (const field of ["customerSegment", "orbit", "deploymentScope", "criticality"] as const) {
    if (!allowed[field].has(profile[field])) failures.push(`${label}.${field} is not an allowed value`);
  }
  if (!Number.isInteger(profile.spacecraftCount) || profile.spacecraftCount < 1) failures.push(`${label}.spacecraftCount must be a positive integer`);
  const evidence = profile.evidence as Record<string, any> | undefined;
  if (!evidence || !Array.isArray(evidence.sourceRefs) || evidence.sourceRefs.length === 0) failures.push(`${label} needs at least one source reference`);
  if (!evidence || !Array.isArray(evidence.unknowns) || evidence.unknowns.length === 0) failures.push(`${label} must declare unknowns before operator confirmation`);
  if (!evidence || !allowed.pilotFit.has(evidence.pilotFit)) failures.push(`${label}.evidence.pilotFit is not an allowed value`);
  if (profile.deploymentScope === "flight_candidate" && evidence?.profileStatus === "research_profile") failures.push(`${label} cannot be flight_candidate with research_profile evidence`);
}

console.log("Gauss mission-target onboarding gate");
console.log(`Profiles reviewed: ${catalog.profiles?.length ?? 0}`);
if (failures.length === 0) {
  console.log("PASS: target catalog is bounded, sourced, and explicit about unknowns");
  process.exit(0);
}
failures.forEach((failure) => console.error(`FAIL: ${failure}`));
process.exit(1);
