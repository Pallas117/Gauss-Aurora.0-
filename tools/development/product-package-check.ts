import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Boundary = {
  partnerOwned?: string[];
  gaussOwned?: string[];
  gaussDoesNotOwn?: string[];
  integrationSurface?: string[];
};

type Partner = {
  id?: string;
  sourceUrl?: string;
  capabilities?: string[];
  gaussWrap?: string[];
  nonCompeteBoundary?: string[];
  verificationStatus?: string;
  unknowns?: string[];
};

type ProductPackage = {
  id?: string;
  tier?: string;
  delivery?: string;
  installArtifacts?: string[];
  requiredInputs?: string[];
  acceptanceTests?: string[];
  externalGates?: string[];
  partnerBoundary?: Boundary;
  safety?: {
    commandAuthority?: boolean;
    onlineTraining?: boolean;
    fallback?: string;
    approvalRequired?: boolean;
  };
};

type Manifest = {
  schema?: string;
  partners?: Partner[];
  packages?: ProductPackage[];
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "config/product-packages.json");
const schemaPath = path.join(root, "config/product-packages.schema.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
  properties?: { schema?: { const?: string } };
};
const failures: string[] = [];

const expectedPartnerIds = ["xorbita", "jaops", "transcelestial", "pan-galactic"];
const expectedPackageIds = ["fleet-integration", "flight-candidate-adapter", "bridge-node"];

function requireList(label: string, value: unknown, minimum: number): value is string[] {
  if (!Array.isArray(value) || value.length < minimum || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    failures.push(`${label} must contain at least ${minimum} non-empty strings`);
    return false;
  }
  return true;
}

if (manifest.schema !== "gauss-product-packages-v1") failures.push("product package manifest schema is invalid");
if (schema.properties?.schema?.const !== "gauss-product-packages-v1") failures.push("product package schema version is not pinned");

const partners = manifest.partners ?? [];
if (partners.length !== expectedPartnerIds.length) failures.push("manifest must contain exactly four named partner profiles");
const partnerIds = new Set<string>();
for (const [index, partner] of partners.entries()) {
  const label = `partner[${index}]`;
  if (!partner.id || !expectedPartnerIds.includes(partner.id)) failures.push(`${label} has an unknown partner id`);
  if (partner.id && partnerIds.has(partner.id)) failures.push(`${label} duplicates partner ${partner.id}`);
  if (partner.id) partnerIds.add(partner.id);
  try {
    if (!partner.sourceUrl) throw new Error("missing sourceUrl");
    const url = new URL(partner.sourceUrl);
    if (url.protocol !== "https:") throw new Error("sourceUrl must use https");
  } catch (error) {
    failures.push(`${label} sourceUrl is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  requireList(`${label}.capabilities`, partner.capabilities, 2);
  requireList(`${label}.gaussWrap`, partner.gaussWrap, 2);
  requireList(`${label}.nonCompeteBoundary`, partner.nonCompeteBoundary, 2);
  requireList(`${label}.unknowns`, partner.unknowns, 1);
  if (partner.verificationStatus !== "public_capability_claim" && partner.verificationStatus !== "partner_confirmed") {
    failures.push(`${label}.verificationStatus must distinguish public claims from partner confirmation`);
  }
}
for (const id of expectedPartnerIds) if (!partnerIds.has(id)) failures.push(`missing partner profile ${id}`);

const packages = manifest.packages ?? [];
if (packages.length !== expectedPackageIds.length) failures.push("manifest must contain exactly three product packages");
const packageIds = new Set<string>();
for (const [index, product] of packages.entries()) {
  const label = `package[${index}]`;
  if (!product.id || !expectedPackageIds.includes(product.id)) failures.push(`${label} has an unknown package id`);
  if (product.id && packageIds.has(product.id)) failures.push(`${label} duplicates package ${product.id}`);
  if (product.id) packageIds.add(product.id);
  for (const artifact of product.installArtifacts ?? []) {
    if (!existsSync(path.join(root, artifact))) failures.push(`${label} references missing artifact ${artifact}`);
  }
  requireList(`${label}.installArtifacts`, product.installArtifacts, 3);
  requireList(`${label}.requiredInputs`, product.requiredInputs, 3);
  requireList(`${label}.acceptanceTests`, product.acceptanceTests, 4);
  requireList(`${label}.externalGates`, product.externalGates, 2);
  const boundary = product.partnerBoundary;
  requireList(`${label}.partnerBoundary.partnerOwned`, boundary?.partnerOwned, 2);
  requireList(`${label}.partnerBoundary.gaussOwned`, boundary?.gaussOwned, 2);
  requireList(`${label}.partnerBoundary.gaussDoesNotOwn`, boundary?.gaussDoesNotOwn, 2);
  requireList(`${label}.partnerBoundary.integrationSurface`, boundary?.integrationSurface, 2);
  if (product.safety?.commandAuthority !== false) failures.push(`${label} must not have command authority`);
  if (product.safety?.onlineTraining !== false) failures.push(`${label} must disable online training`);
  if (product.safety?.fallback !== "deterministic_baseline") failures.push(`${label} must use deterministic_baseline fallback`);
  if (product.safety?.approvalRequired !== true) failures.push(`${label} must remain approval-gated`);
}
for (const id of expectedPackageIds) if (!packageIds.has(id)) failures.push(`missing product package ${id}`);

console.log("Gauss partner/product boundary gate");
console.log(`Partners: ${partners.length}; packages: ${packages.length}`);
if (failures.length === 0) {
  console.log("PASS: partner capabilities are wrapped by explicit, non-competing Gauss boundaries");
  process.exit(0);
}
failures.forEach((failure) => console.error(`FAIL: ${failure}`));
process.exit(1);
