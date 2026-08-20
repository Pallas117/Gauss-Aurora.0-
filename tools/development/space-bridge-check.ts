import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const profilePath = path.join(root, "config", "space-data-center-bridge.json");
const schemaPath = path.join(root, "config", "space-data-center-bridge.schema.json");
const profile = JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, any>;
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, any>;
const failures: string[] = [];

if (schema.properties?.schema?.const !== "gauss-space-data-center-bridge-v1") failures.push("bridge schema version is not pinned");
if (profile.schema !== "gauss-space-data-center-bridge-v1") failures.push("bridge profile schema is invalid");
if (profile.mode !== "ground_simulation") failures.push("initial bridge profile must remain ground_simulation");

const zones = Array.isArray(profile.trustZones) ? profile.trustZones : [];
const zoneIds = new Set(zones.map((zone) => zone.id));
const segments = new Set(zones.map((zone) => zone.segment));
for (const required of ["LEO", "MEO", "GEO", "lunar", "ground"]) if (!segments.has(required)) failures.push(`missing trust zone segment ${required}`);
if (zones.some((zone) => zone.commandAuthority !== false)) failures.push("trust-zone command authority must remain false");

const nodes = Array.isArray(profile.nodes) ? profile.nodes : [];
const nodeIds = new Set(nodes.map((node) => node.id));
for (const node of nodes) {
  if (!zoneIds.has(node.zone)) failures.push(`node ${node.id} references an unknown zone`);
  if (!Number.isInteger(node.memoryBudgetMb) || node.memoryBudgetMb < 16) failures.push(`node ${node.id} has an invalid memory budget`);
}

const links = Array.isArray(profile.links) ? profile.links : [];
for (const link of links) {
  if (!nodeIds.has(link.source) || !nodeIds.has(link.destination)) failures.push(`link ${link.id} references an unknown node`);
  if (link.transport === "https_ground_only" && (!String(link.source).startsWith("ground-") || !String(link.destination).startsWith("ground-"))) failures.push(`link ${link.id} uses a ground-only transport outside ground nodes`);
  if (link.source !== "ground-yamcs-01" && link.destination !== "ground-operator-01" && link.transport !== "dtn_bp") failures.push(`link ${link.id} must use DTN for cross-segment transport`);
  if (link.storeAndForward !== true && link.transport === "dtn_bp") failures.push(`DTN link ${link.id} must support store-and-forward`);
}

const products = Array.isArray(profile.dataProducts) ? profile.dataProducts : [];
if (products.some((product) => product.integrity !== "sha256" || product.encryption !== "required")) failures.push("all bridge products require SHA-256 integrity and encryption");
if (profile.computePolicy?.allowOnlineTraining !== false) failures.push("online training must remain disabled");
if (profile.computePolicy?.fallback !== "deterministic_baseline") failures.push("compute fallback must be deterministic_baseline");
if (profile.safety?.commandAuthority !== false || profile.safety?.unknownState !== "abstain" || profile.safety?.staleState !== "abstain" || profile.safety?.approvalRequired !== true) failures.push("safety policy must be fail-closed and approval-gated");

console.log("Gauss space-data-center bridge gate");
console.log(`Nodes: ${nodes.length}; links: ${links.length}; products: ${products.length}`);
if (failures.length === 0) {
  console.log("PASS: bridge is segmented, bounded, encrypted, DTN-capable, and command-inert");
  process.exit(0);
}
failures.forEach((failure) => console.error(`FAIL: ${failure}`));
process.exit(1);
