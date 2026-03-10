import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTrustManifest,
  type DocumentTrustManifest,
  type DocumentTrustRecord,
} from "./document-trust-pipeline.js";

export type RepoKnowledgeKind =
  | "trusted_document"
  | "documentation"
  | "dataset"
  | "model_asset"
  | "report"
  | "code"
  | "config"
  | "other";

export interface RepoKnowledgeEntry {
  path: string;
  kind: RepoKnowledgeKind;
  group: string;
  sizeBytes: number;
  sha256: string;
  priority: number;
  approved: boolean;
  indexAllowed: boolean;
  notes: string[];
}

export interface RepoKnowledgeMissingAsset {
  path: string;
  reason: string;
}

export interface RepoKnowledgeBaseReport {
  generatedAt: string;
  root: string;
  trustRoot: string;
  totals: {
    files: number;
    totalBytes: number;
    trustedDocuments: number;
    datasets: number;
    modelAssets: number;
    codeFiles: number;
    reports: number;
  };
  summaries: Array<{
    group: string;
    files: number;
    totalBytes: number;
  }>;
  prioritySources: RepoKnowledgeEntry[];
  missingAssets: RepoKnowledgeMissingAsset[];
  files: RepoKnowledgeEntry[];
}

type RegistryModel = {
  dataset?: string;
};

const EXCLUDED_ROOTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".turbo",
  ".cursor",
  "gauss-orchestrator/target",
]);

const DATASET_EXTENSIONS = new Set([".json", ".jsonl", ".csv", ".pdf"]);

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function relativePath(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function checksumFile(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function walkFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const rel = relativePath(rootDir, absolute);
      if (entry.isDirectory()) {
        if (EXCLUDED_ROOTS.has(rel) || entry.name.startsWith(".") || entry.name === "__pycache__") {
          continue;
        }
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === ".DS_Store" || entry.name.endsWith(".pyc")) continue;
      files.push(absolute);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function loadTrustIndex(rootDir: string, trustRoot: string): Map<string, DocumentTrustRecord> {
  const trustManifest: DocumentTrustManifest | null = existsSync(trustRoot) ? buildTrustManifest(trustRoot) : null;
  const out = new Map<string, DocumentTrustRecord>();
  for (const document of trustManifest?.documents ?? []) {
    out.set(`research/documentation-rag/${document.path}`, document);
  }
  return out;
}

function loadRegistryDatasetPaths(rootDir: string): string[] {
  const registryPath = path.join(rootDir, "ml/models/registry.json");
  if (!existsSync(registryPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as { models?: RegistryModel[] };
    return [...new Set((parsed.models ?? []).map((model) => model.dataset).filter((value): value is string => Boolean(value)))];
  } catch {
    return [];
  }
}

function classifyEntry(relPath: string, trustRecord?: DocumentTrustRecord): Pick<RepoKnowledgeEntry, "kind" | "group" | "priority" | "approved" | "indexAllowed" | "notes"> {
  const notes = [...(trustRecord?.reasons ?? [])];
  const extension = path.extname(relPath).toLowerCase();

  if (relPath.startsWith("research/documentation-rag/")) {
    const approved = trustRecord?.approvalStatus === "approved";
    const indexAllowed = trustRecord?.indexAllowed === true;
    if (approved && indexAllowed) {
      notes.push("Trusted and index-allowed for local RAG.");
    } else if (approved) {
      notes.push("Approved, but not currently index-allowed.");
    }
    return {
      kind: approved ? "trusted_document" : "documentation",
      group: "research-documentation",
      priority: indexAllowed ? 100 : approved ? 78 : 45,
      approved,
      indexAllowed,
      notes,
    };
  }

  if (
    relPath.startsWith("research/data-rag/") ||
    relPath.startsWith("gauss-orchestrator/new_telemetry/") ||
    relPath.startsWith("ml/data/") ||
    (relPath.startsWith("reports/network/") && DATASET_EXTENSIONS.has(extension))
  ) {
    return {
      kind: "dataset",
      group: relPath.split("/")[0] ?? "dataset",
      priority: 82,
      approved: false,
      indexAllowed: false,
      notes,
    };
  }

  if (relPath.startsWith("ml/")) {
    return {
      kind: "model_asset",
      group: "ml",
      priority: relPath.includes("registry.json") ? 90 : 70,
      approved: false,
      indexAllowed: false,
      notes,
    };
  }

  if (relPath.startsWith("backend/") || relPath.startsWith("src/") || relPath.startsWith("gauss-orchestrator/src/")) {
    return {
      kind: "code",
      group: relPath.split("/")[0] ?? "code",
      priority: 55,
      approved: false,
      indexAllowed: false,
      notes,
    };
  }

  if (relPath.startsWith("reports/")) {
    return {
      kind: "report",
      group: relPath.split("/").slice(0, 2).join("/"),
      priority: 50,
      approved: false,
      indexAllowed: false,
      notes,
    };
  }

  if (relPath.startsWith("docs/") || relPath.endsWith(".toml") || relPath.endsWith(".yaml") || relPath.endsWith(".yml")) {
    return {
      kind: "config",
      group: relPath.split("/")[0] ?? "config",
      priority: 48,
      approved: false,
      indexAllowed: false,
      notes,
    };
  }

  return {
    kind: "other",
    group: relPath.split("/")[0] ?? "other",
    priority: 30,
    approved: false,
    indexAllowed: false,
    notes,
  };
}

export function buildRepoKnowledgeBaseReport(rootDirInput = process.cwd()): RepoKnowledgeBaseReport {
  const rootDir = path.resolve(rootDirInput);
  const trustRoot = path.join(rootDir, "research/documentation-rag");
  const trustIndex = loadTrustIndex(rootDir, trustRoot);
  const files = walkFiles(rootDir).map((absolutePath) => {
    const relPath = relativePath(rootDir, absolutePath);
    const trustRecord = trustIndex.get(relPath);
    const classification = classifyEntry(relPath, trustRecord);
    return {
      path: relPath,
      kind: classification.kind,
      group: classification.group,
      sizeBytes: statSync(absolutePath).size,
      sha256: checksumFile(absolutePath),
      priority: classification.priority,
      approved: classification.approved,
      indexAllowed: classification.indexAllowed,
      notes: classification.notes,
    } satisfies RepoKnowledgeEntry;
  });

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const groupMap = new Map<string, { files: number; totalBytes: number }>();
  for (const file of files) {
    const current = groupMap.get(file.group) ?? { files: 0, totalBytes: 0 };
    current.files += 1;
    current.totalBytes += file.sizeBytes;
    groupMap.set(file.group, current);
  }

  const summaries = [...groupMap.entries()]
    .map(([group, summary]) => ({ group, files: summary.files, totalBytes: summary.totalBytes }))
    .sort((a, b) => b.files - a.files || a.group.localeCompare(b.group));

  const prioritySources = files
    .filter((file) => file.priority >= 70)
    .sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path))
    .slice(0, 40);

  const datasetPaths = loadRegistryDatasetPaths(rootDir);
  const missingAssets: RepoKnowledgeMissingAsset[] = [];
  for (const datasetPath of datasetPaths) {
    const resolved = path.isAbsolute(datasetPath) ? datasetPath : path.join(rootDir, datasetPath);
    if (!existsSync(resolved)) {
      missingAssets.push({ path: datasetPath.split(path.sep).join("/"), reason: "Model registry points to a missing dataset." });
    }
    const holdoutPath = datasetPath.replace(/\.jsonl$/i, ".holdout.jsonl");
    const holdoutResolved = path.isAbsolute(holdoutPath) ? holdoutPath : path.join(rootDir, holdoutPath);
    if (!existsSync(holdoutResolved)) {
      missingAssets.push({ path: holdoutPath.split(path.sep).join("/"), reason: "Holdout dataset is missing for training validation." });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    root: rootDir,
    trustRoot: relativePath(rootDir, trustRoot),
    totals: {
      files: files.length,
      totalBytes,
      trustedDocuments: files.filter((file) => file.kind === "trusted_document").length,
      datasets: files.filter((file) => file.kind === "dataset").length,
      modelAssets: files.filter((file) => file.kind === "model_asset").length,
      codeFiles: files.filter((file) => file.kind === "code").length,
      reports: files.filter((file) => file.kind === "report").length,
    },
    summaries,
    prioritySources,
    missingAssets,
    files,
  };
}

export function buildRepoKnowledgeDigest(report: RepoKnowledgeBaseReport): string {
  const trustedDocs = report.prioritySources.filter((file) => file.kind === "trusted_document").slice(0, 12);
  const datasets = report.prioritySources.filter((file) => file.kind === "dataset").slice(0, 12);
  const modelAssets = report.prioritySources.filter((file) => file.kind === "model_asset").slice(0, 12);
  const groupSummary = report.summaries.slice(0, 12);

  const lines: string[] = [];
  lines.push("# Repo Knowledge Base");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Purpose");
  lines.push("");
  lines.push(
    "This digest summarizes the trusted knowledge, datasets, model assets, and subsystem files that the local Gauss engine should consume before any fine-tuning claims are made.",
  );
  lines.push("");
  lines.push("## Trusted Foundational and Mission Documents");
  lines.push("");
  for (const file of trustedDocs) {
    lines.push(`- ${file.path}`);
  }
  if (trustedDocs.length === 0) {
    lines.push("- No approved trusted documents were detected.");
  }
  lines.push("");
  lines.push("## Connected Datasets and Telemetry Artifacts");
  lines.push("");
  for (const file of datasets) {
    lines.push(`- ${file.path}`);
  }
  if (datasets.length === 0) {
    lines.push("- No dataset-like files were detected in the approved roots.");
  }
  lines.push("");
  lines.push("## Model and Training Assets");
  lines.push("");
  for (const file of modelAssets) {
    lines.push(`- ${file.path}`);
  }
  if (modelAssets.length === 0) {
    lines.push("- No model assets were detected.");
  }
  lines.push("");
  lines.push("## Repo Subsystem Summary");
  lines.push("");
  for (const summary of groupSummary) {
    lines.push(`- ${summary.group}: ${summary.files} files`);
  }
  lines.push("");
  lines.push("## Current Gaps");
  lines.push("");
  if (report.missingAssets.length === 0) {
    lines.push("- No required training assets are currently missing.");
  } else {
    for (const asset of report.missingAssets) {
      lines.push(`- ${asset.path}: ${asset.reason}`);
    }
  }
  lines.push("");
  lines.push("## Ingestion Order");
  lines.push("");
  lines.push("1. Approved foundational and mission documents under research/documentation-rag.");
  lines.push("2. Approved repo-knowledge digest and training-readiness reports.");
  lines.push("3. Dataset and telemetry artifacts for feature extraction and supervised dataset building.");
  lines.push("4. Model registry and validation assets for promotion, rollback, and shadow-mode checks.");
  lines.push("");
  lines.push("The local engine should treat this digest as a map of trustworthy evidence, not as permission to train on everything indiscriminately.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeIfRequested(outputPath: string | null, content: string): void {
  if (!outputPath) return;
  const absolute = path.resolve(outputPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

async function main(): Promise<void> {
  const jsonOut = argValue("--json-out") ?? "reports/knowledge/repo-knowledge-base.latest.json";
  const digestOut = argValue("--digest-out") ?? "research/documentation-rag/repo-knowledge/repo-knowledge-base.md";
  const rootDir = argValue("--root") ?? process.cwd();

  const report = buildRepoKnowledgeBaseReport(rootDir);
  const digest = buildRepoKnowledgeDigest(report);

  writeIfRequested(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  writeIfRequested(digestOut, digest);

  console.log(
    JSON.stringify(
      {
        ok: true,
        files: report.totals.files,
        trustedDocuments: report.totals.trustedDocuments,
        datasets: report.totals.datasets,
        missingAssets: report.missingAssets.length,
        jsonOut: path.resolve(jsonOut),
        digestOut: path.resolve(digestOut),
      },
      null,
      2,
    ),
  );
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
