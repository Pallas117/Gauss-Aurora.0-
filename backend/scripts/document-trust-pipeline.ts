import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ApprovalStatus = "approved" | "needs_review" | "rejected";
export type RedactionStatus = "ready" | "pending_review" | "not_required";
export type SensitivityLevel = "public" | "internal" | "restricted" | "unknown";
export type IndexDecision = "index" | "review" | "skip";

export interface DocumentTrustRecord {
  path: string;
  sha256: string;
  sizeBytes: number;
  supported: boolean;
  approvalStatus: ApprovalStatus;
  redactionStatus: RedactionStatus;
  sensitivity: SensitivityLevel;
  owner: string;
  retentionPolicy: string;
  indexDecision: IndexDecision;
  indexAllowed: boolean;
  approvalSource: "override" | "heuristic";
  reasons: string[];
}

export interface DocumentTrustManifest {
  generatedAt: string;
  rootDir: string;
  policyVersion: string;
  overridesPath: string | null;
  totals: {
    files: number;
    supported: number;
    approved: number;
    indexAllowed: number;
    needsReview: number;
    rejected: number;
  };
  documents: DocumentTrustRecord[];
}

type DocumentOverride = Partial<
  Pick<
    DocumentTrustRecord,
    "approvalStatus" | "redactionStatus" | "sensitivity" | "owner" | "retentionPolicy"
  >
> & {
  reasons?: string[];
};

type OverridesFile = {
  documents?: Record<string, DocumentOverride>;
};

const SUPPORTED_DOC_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".pdf",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".pptx",
]);
const SKIP_ARTIFACT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tif",
  ".tiff",
  ".js",
  ".css",
  ".map",
]);
const SENSITIVE_NAME_PATTERNS = [
  /opportunity/i,
  /briefing/i,
  /mainframe/i,
  /vulnerability/i,
  /assessment/i,
  /interview/i,
  /workspace/i,
  /saved_resource/i,
];

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function relativePath(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function walkFiles(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === ".DS_Store") continue;
      if (entry.name.startsWith(".gauss-doc-trust")) continue;
      out.push(absolute);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function checksumFile(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function loadOverrides(overridesPath: string | null): Record<string, DocumentOverride> {
  if (!overridesPath) return {};
  try {
    const raw = readFileSync(overridesPath, "utf8");
    const parsed = JSON.parse(raw) as OverridesFile;
    return parsed.documents ?? {};
  } catch {
    return {};
  }
}

function defaultSensitivity(relPath: string): SensitivityLevel {
  if (relPath.startsWith("spacecraft-ops-probability/")) return "public";
  if (SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(relPath))) return "restricted";
  if (relPath.includes("/.obsidian/")) return "internal";
  return "unknown";
}

function classifyDocument(
  rootDir: string,
  absolutePath: string,
  override: DocumentOverride | undefined,
): DocumentTrustRecord {
  const relPath = relativePath(rootDir, absolutePath);
  const ext = path.extname(relPath).toLowerCase();
  const sizeBytes = statSync(absolutePath).size;
  const supported = SUPPORTED_DOC_EXTENSIONS.has(ext);
  const reasons: string[] = [];

  let approvalStatus: ApprovalStatus = "needs_review";
  let redactionStatus: RedactionStatus = "pending_review";
  let sensitivity = defaultSensitivity(relPath);
  let owner = "unknown";
  let retentionPolicy = "review_required";
  let indexDecision: IndexDecision = "review";

  if (relPath.startsWith(".") || relPath.includes("/.")) {
    reasons.push("Hidden workspace/tooling artifact.");
    indexDecision = "skip";
  }

  if (relPath.includes("_files/") || SKIP_ARTIFACT_EXTENSIONS.has(ext)) {
    reasons.push("Scraped page asset or non-document artifact.");
    indexDecision = "skip";
  }

  if (!supported) {
    reasons.push("Unsupported extraction format for current RAG pipeline.");
    if (indexDecision !== "skip") {
      indexDecision = "review";
    }
  }

  if (SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(relPath))) {
    reasons.push("File name indicates sensitive or presentation-specific content.");
  }

  if (relPath.startsWith("spacecraft-ops-probability/")) {
    owner = "gauss";
    retentionPolicy = "living_reference";
    reasons.push("Curated mission reference directory.");
  }

  if (override) {
    approvalStatus = override.approvalStatus ?? approvalStatus;
    redactionStatus = override.redactionStatus ?? redactionStatus;
    sensitivity = override.sensitivity ?? sensitivity;
    owner = override.owner ?? owner;
    retentionPolicy = override.retentionPolicy ?? retentionPolicy;
    for (const reason of override.reasons ?? []) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  }

  const approvalSource = override ? "override" : "heuristic";
  const indexAllowed =
    supported &&
    approvalStatus === "approved" &&
    (redactionStatus === "ready" || redactionStatus === "not_required") &&
    indexDecision !== "skip";

  if (indexAllowed) {
    indexDecision = "index";
  } else if (indexDecision !== "skip") {
    indexDecision = approvalStatus === "rejected" ? "skip" : "review";
  }

  if (approvalStatus === "approved" && !supported) {
    reasons.push("Approved in metadata but still unsupported by extractor.");
  }
  if (approvalStatus !== "approved") {
    reasons.push("Explicit approval is still required before indexing.");
  }
  if (redactionStatus !== "ready" && redactionStatus !== "not_required") {
    reasons.push("Redaction review is incomplete.");
  }

  return {
    path: relPath,
    sha256: checksumFile(absolutePath),
    sizeBytes,
    supported,
    approvalStatus,
    redactionStatus,
    sensitivity,
    owner,
    retentionPolicy,
    indexDecision,
    indexAllowed,
    approvalSource,
    reasons,
  };
}

export function buildTrustManifest(rootDirInput: string, overridesPathInput?: string | null): DocumentTrustManifest {
  const rootDir = path.resolve(rootDirInput);
  const overridesPath = overridesPathInput ? path.resolve(overridesPathInput) : path.join(rootDir, ".gauss-doc-trust-overrides.json");
  const overrideMap = loadOverrides(overridesPath);
  const documents = walkFiles(rootDir).map((absolutePath) =>
    classifyDocument(rootDir, absolutePath, overrideMap[relativePath(rootDir, absolutePath)]),
  );

  const totals = documents.reduce(
    (acc, document) => {
      acc.files += 1;
      if (document.supported) acc.supported += 1;
      if (document.approvalStatus === "approved") acc.approved += 1;
      if (document.approvalStatus === "needs_review") acc.needsReview += 1;
      if (document.approvalStatus === "rejected") acc.rejected += 1;
      if (document.indexAllowed) acc.indexAllowed += 1;
      return acc;
    },
    { files: 0, supported: 0, approved: 0, indexAllowed: 0, needsReview: 0, rejected: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    policyVersion: "orbital-stewardship-v1",
    overridesPath: overrideMap && Object.keys(overrideMap).length > 0 ? overridesPath : null,
    totals,
    documents,
  };
}

export function writeTrustManifest(outPath: string, manifest: DocumentTrustManifest): void {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}${os.EOL}`, "utf8");
}

function printSummary(manifest: DocumentTrustManifest): void {
  console.log("Document Trust Pipeline");
  console.log("=======================");
  console.log(`Root: ${manifest.rootDir}`);
  console.log(`Files: ${manifest.totals.files}`);
  console.log(`Supported docs: ${manifest.totals.supported}`);
  console.log(`Approved docs: ${manifest.totals.approved}`);
  console.log(`Index-allowed docs: ${manifest.totals.indexAllowed}`);
  console.log(`Needs review: ${manifest.totals.needsReview}`);
  console.log(`Rejected: ${manifest.totals.rejected}`);
}

function main(): void {
  const rootDir = argValue("--root") ?? "research/documentation-rag";
  const rootResolved = path.resolve(process.cwd(), rootDir);
  const manifestOut =
    argValue("--manifest-out") ?? path.join(rootResolved, ".gauss-doc-trust.json");
  const reportOut =
    argValue("--report-out") ?? "reports/rag/document-trust-manifest.latest.json";
  const overrides =
    argValue("--overrides") ?? path.join(rootResolved, ".gauss-doc-trust-overrides.json");
  const strict = hasFlag("--strict");

  const manifest = buildTrustManifest(rootResolved, overrides);
  writeTrustManifest(path.resolve(process.cwd(), manifestOut), manifest);
  writeTrustManifest(path.resolve(process.cwd(), reportOut), manifest);
  printSummary(manifest);

  if (strict && manifest.totals.indexAllowed === 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  main();
}
