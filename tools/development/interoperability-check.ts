import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configPath = path.join(root, "config/development-interoperability.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
  schema_version?: number;
  contract?: string;
  truth_states?: string[];
  lifecycle?: string[];
  artifacts?: Record<string, string>;
  required_role_sections?: string[];
  required_skill_sections?: string[];
  roles?: Record<string, { skill: string; lanes: string[] }>;
};

const failures: string[] = [];
const requireFile = (relativePath: string) => {
  if (!existsSync(path.join(root, relativePath))) failures.push(`missing file: ${relativePath}`);
};
const requireText = (relativePath: string, sections: string[]) => {
  requireFile(relativePath);
  if (!existsSync(path.join(root, relativePath))) return;
  const text = readFileSync(path.join(root, relativePath), "utf8");
  for (const section of sections) if (!text.includes(section)) failures.push(`${relativePath}: missing ${section}`);
};

if (config.schema_version !== 1 || config.contract !== "gauss-development-interoperability-v1") failures.push("invalid interoperability contract identity");
for (const state of ["observed", "inferred", "unknown", "blocked", "verified"]) if (!config.truth_states?.includes(state)) failures.push(`missing truth state: ${state}`);
for (const state of ["observe", "diagnose", "plan", "authorize", "execute", "handoff"]) if (!config.lifecycle?.includes(state)) failures.push(`missing lifecycle state: ${state}`);
for (const artifact of Object.values(config.artifacts ?? {})) requireFile(artifact);
for (const [role, definition] of Object.entries(config.roles ?? {})) {
  requireText(`agents/roles/${role}.md`, config.required_role_sections ?? []);
  requireText(`skills/${definition.skill}/SKILL.md`, config.required_skill_sections ?? []);
  if (!definition.lanes?.length) failures.push(`${role}: no subagent lanes`);
}

if (failures.length) {
  console.error(`Gauss interoperability check failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  const roleCount = Object.keys(config.roles ?? {}).length;
  const laneCount = Object.values(config.roles ?? {}).reduce((count, role) => count + role.lanes.length, 0);
  console.log(`Gauss interoperability check passed: ${roleCount} roles, ${laneCount} lanes`);
}
