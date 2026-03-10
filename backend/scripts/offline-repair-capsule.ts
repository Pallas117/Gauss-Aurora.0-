import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildModelOrchestratorPairing,
  buildRepairPairingSummary,
  type OfflineRepairPairing,
  type OfflineRepairPairingSummary,
} from "../repair/offline-repair-pairing.js";
import { getBatteryGuard } from "./battery-and-work-queue.js";

type Severity = "P1" | "P2" | "P3";

type AuditReport = {
  generated_at?: string;
  totals?: {
    pass?: number;
    warn?: number;
    fail?: number;
    skip?: number;
  };
  checks?: Array<{
    name?: string;
    status?: string;
    detail?: string;
    command?: string;
  }>;
};

type BackendLintReport = {
  generated_at?: string;
  issues?: Array<{
    file: string;
    line: number;
    column?: number;
    message: string;
    severity: "error" | "warning";
  }>;
};

type BackpropAction = {
  milestone?: string;
  key?: string;
  label?: string;
  target?: string;
  hint?: string;
  score?: number;
};

type BackpropReport = {
  generated_at?: string;
  readiness?: {
    overall?: number;
    next_incomplete_milestone?: string;
  };
  blockers?: string[];
  backprop_actions?: BackpropAction[];
};

type WorkQueueReport = {
  generatedAt?: string;
  timestamp?: string;
  min_safe_battery_percent?: number;
  total_estimated_minutes?: number;
  items?: Array<{
    id?: string;
    title?: string;
    file?: string;
    line?: number;
    severity?: string;
    priority?: number;
    estimated_minutes?: number;
    recommended_action?: string;
  }>;
};

type DebtFinding = {
  id: string;
  severity: Severity;
  category: "architecture" | "audit" | "runtime" | "quality";
  title: string;
  target: string | null;
  evidence: string;
  recommendation: string;
  offlineFixable: boolean;
};

type RepairBatch = {
  batchId: string;
  goal: string;
  rationale: string;
  maxFilesChanged: number;
  maxChangedLines: number;
  allowedActions: string[];
  blockedActions: string[];
  validatorSequence: string[];
  items: DebtFinding[];
  pairing: OfflineRepairPairing;
};

type OfflineRepairCapsule = {
  generated_at: string;
  root: string;
  profile: {
    offline_required: boolean;
    air_gap: boolean;
    strict_local_inference: boolean;
    local_engine_url: string | null;
    model_endpoint_mode: "local" | "remote" | "unset";
    ingest_power_profile: string;
    power_save_mode: boolean;
    battery_percent: number | null;
    charging: boolean | null;
    min_safe_battery_percent: number;
  };
  tech_debt_summary: {
    findings: DebtFinding[];
    total_findings: number;
    offline_fixable_findings: number;
  };
  system_flow: Array<{
    stage: string;
    purpose: string;
    inputs: string[];
    outputs: string[];
    guardrails: string[];
  }>;
  pairing_summary: OfflineRepairPairingSummary;
  repair_batches: RepairBatch[];
  prompt_contract: {
    role: string;
    instructions: string[];
    required_output: string[];
    validator_policy: string[];
  };
};

const DEFAULT_OUTPUT = "reports/orchestrator/offline-repair-capsule.latest.json";
const TARGET_DIRS = ["backend", "src"];

function nowIso(): string {
  return new Date().toISOString();
}

function resolveRoot(): string {
  return process.cwd();
}

function parseArgs(argv: string[]): { jsonOut: string } {
  let jsonOut = DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json-out" && argv[index + 1]) {
      jsonOut = argv[index + 1];
      index += 1;
    }
  }
  return { jsonOut };
}

function readJson<T>(root: string, relativePath: string): T | null {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function lineCount(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function walkTypescriptFiles(root: string, relativeDir: string, bucket: Array<{ file: string; lines: number }>): void {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return;
  }
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const entryRelative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      walkTypescriptFiles(root, entryRelative, bucket);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
      continue;
    }
    const content = fs.readFileSync(path.join(root, entryRelative), "utf8");
    bucket.push({
      file: entryRelative,
      lines: lineCount(content),
    });
  }
}

function collectHotspots(root: string): Array<{ file: string; lines: number }> {
  const files: Array<{ file: string; lines: number }> = [];
  for (const dir of TARGET_DIRS) {
    walkTypescriptFiles(root, dir, files);
  }
  return files.sort((left, right) => right.lines - left.lines).slice(0, 8);
}

function severityFromLineCount(lines: number): Severity | null {
  if (lines >= 3000) return "P1";
  if (lines >= 800) return "P2";
  if (lines >= 500) return "P3";
  return null;
}

function normalizeTarget(root: string, value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  const absolute = path.isAbsolute(value) ? value : path.join(root, value);
  const relative = path.relative(root, absolute);
  return relative.startsWith("..") ? value : relative;
}

function recommendationForFile(file: string): string {
  if (file === "backend/server.ts") {
    return "Split planner, audit, and mission routes into mounted modules before giving DeepSeek patch authority.";
  }
  if (file === "backend/worker/ingest-loop.ts") {
    return "Extract source policy, persistence, and cadence control into narrower worker modules.";
  }
  if (file === "src/pages/HeliophysicsDashboard.tsx") {
    return "Move source health, risk HUD, and heavy metrics cards into leaf components with explicit props.";
  }
  if (file === "src/pages/AutomationPage.tsx") {
    return "Keep operator actions thin and push source-policy rendering into reusable presentational blocks.";
  }
  return "Reduce file scope before enabling autonomous patch application.";
}

function buildArchitectureFindings(root: string, hotspots: Array<{ file: string; lines: number }>): DebtFinding[] {
  return hotspots
    .map((hotspot, index) => {
      const severity = severityFromLineCount(hotspot.lines);
      if (!severity) {
        return null;
      }
      return {
        id: `hotspot-${index + 1}`,
        severity,
        category: "architecture" as const,
        title: `${hotspot.file} is still oversized`,
        target: hotspot.file,
        evidence: `${hotspot.lines} lines in a single TypeScript surface.`,
        recommendation: recommendationForFile(hotspot.file),
        offlineFixable: true,
      };
    })
    .filter((finding): finding is DebtFinding => finding != null);
}

function severityFromAuditStatus(status: string): Severity {
  if (status === "FAIL") return "P1";
  if (status === "WARN") return "P2";
  return "P3";
}

function auditFixable(check: NonNullable<AuditReport["checks"]>[number]): boolean {
  const detail = (check.detail ?? "").toLowerCase();
  if (detail.includes("missing rbac") || detail.includes("export credentials")) {
    return false;
  }
  return !(detail.includes("missing supabase") || detail.includes("set ") || detail.includes("backend running"));
}

function buildAuditFindings(root: string, audit: AuditReport | null): DebtFinding[] {
  const checks = audit?.checks ?? [];
  return checks
    .filter((check) => ["FAIL", "WARN", "SKIP"].includes((check.status ?? "").toUpperCase()))
    .slice(0, 6)
    .map((check, index) => {
      const status = (check.status ?? "SKIP").toUpperCase();
      return {
        id: `audit-${index + 1}`,
        severity: severityFromAuditStatus(status),
        category: "audit" as const,
        title: `${check.name ?? "Unnamed audit step"} is ${status}`,
        target: null,
        evidence: check.detail ?? check.command ?? "No audit detail recorded.",
        recommendation:
          status === "FAIL"
            ? "Resolve this before enabling unattended patch apply."
            : "Treat this as an operator prerequisite or convert it into an automated local check.",
        offlineFixable: auditFixable(check),
      };
    });
}

function buildRuntimeFindings(root: string, backprop: BackpropReport | null): DebtFinding[] {
  const blockers = backprop?.blockers ?? [];
  const actions = backprop?.backprop_actions ?? [];
  const findings: DebtFinding[] = [];

  blockers.slice(0, 3).forEach((blocker, index) => {
    const action = actions[index];
    findings.push({
      id: `runtime-${index + 1}`,
      severity: "P2",
      category: "runtime",
      title: blocker,
      target: normalizeTarget(root, action?.target ?? null),
      evidence: `Backprop capsule blocker. Next milestone: ${backprop?.readiness?.next_incomplete_milestone ?? "unknown"}.`,
      recommendation: action?.hint ?? "Reduce runtime pressure before scaling offline autonomy.",
      offlineFixable: Boolean(action?.target),
    });
  });

  return findings;
}

function buildQualityFindings(lint: BackendLintReport | null): DebtFinding[] {
  const issues = lint?.issues ?? [];
  return issues.slice(0, 6).map((issue, index) => ({
    id: `quality-${index + 1}`,
    severity: issue.severity === "error" ? "P2" : "P3",
    category: "quality" as const,
    title: issue.message,
    target: issue.file,
    evidence: `${issue.file}:${issue.line}${issue.column ? `:${issue.column}` : ""}`,
    recommendation: "Keep the offline fixer limited to low-diff lint and typing corrections in this area.",
    offlineFixable: true,
  }));
}

function severityScore(severity: Severity): number {
  if (severity === "P1") return 3;
  if (severity === "P2") return 2;
  return 1;
}

function groupKey(target: string | null, category: DebtFinding["category"]): string {
  if (!target) return category;
  if (target.startsWith("backend/")) return "backend";
  if (target.startsWith("src/pages/")) return "frontend-pages";
  if (target.startsWith("src/components/")) return "frontend-components";
  return category;
}

function validatorsForGroup(group: string): string[] {
  if (group === "backend") {
    return ["npm run -s lint", "npm test"];
  }
  if (group.startsWith("frontend")) {
    return ["npm run -s lint", "npm run -s test:unit:ui", "npm run -s build"];
  }
  return ["npm run -s lint", "npm run -s build"];
}

function goalForGroup(group: string): string {
  if (group === "backend") return "Reduce backend coupling before autonomous patch execution.";
  if (group === "frontend-pages") return "Trim page-level runtime surfaces before adding more autonomous UI behavior.";
  if (group === "frontend-components") return "Isolate heavy presentation components into smaller leaf modules.";
  return "Resolve locally fixable debt without network access.";
}

function buildRepairBatches(findings: DebtFinding[]): RepairBatch[] {
  const fixable = findings
    .filter((finding) => finding.offlineFixable)
    .sort((left, right) => severityScore(right.severity) - severityScore(left.severity));
  const grouped = new Map<string, DebtFinding[]>();

  for (const finding of fixable) {
    const key = groupKey(finding.target, finding.category);
    const list = grouped.get(key) ?? [];
    list.push(finding);
    grouped.set(key, list);
  }

  return Array.from(grouped.entries())
    .slice(0, 3)
    .map(([group, items], index) => {
      const batchBase = {
        batchId: `offline-batch-${index + 1}`,
        goal: goalForGroup(group),
        rationale: `Keep DeepSeek in a narrow ${group} patch lane with local-only validation.`,
        maxFilesChanged: 3,
        maxChangedLines: 180,
        allowedActions: [
          "read-local-files",
          "generate-unified-diff",
          "run-targeted-tests",
          "run-lint",
          "run-build",
        ],
        blockedActions: [
          "network-access",
          "dependency-install",
          "destructive-git",
          "broad-shell-exec",
          "external-llm-calls",
        ],
        validatorSequence: validatorsForGroup(group),
        items: items.slice(0, 3),
      };
      return {
        ...batchBase,
        pairing: buildModelOrchestratorPairing(batchBase),
      };
    });
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveModelEndpointMode(url: string | null): "local" | "remote" | "unset" {
  if (!url) {
    return "unset";
  }
  if (url.includes("127.0.0.1") || url.includes("localhost") || url.includes("100.")) {
    return "local";
  }
  return "remote";
}

function buildSystemFlow(): OfflineRepairCapsule["system_flow"] {
  return [
    {
      stage: "Sense",
      purpose: "Collect only local evidence before DeepSeek plans any repair.",
      inputs: [
        "reports/progress/requirements-audit.latest.json",
        "reports/progress/backend-lint-issues.json",
        "reports/context/latest-backprop.json",
        "reports/orchestrator/work-queue.json",
      ],
      outputs: ["offline-repair-capsule.latest.json"],
      guardrails: [
        "No network access.",
        "No package installation.",
        "No mutation during evidence collection.",
      ],
    },
    {
      stage: "Reduce",
      purpose: "Filter debt into small offline-fixable batches before the local model sees it.",
      inputs: ["capsule findings", "battery guard", "power profile", "air-gap state"],
      outputs: ["repair_batches[0..N]"],
      guardrails: [
        "Max 3 files per batch.",
        "Max 180 changed lines per batch.",
        "Skip env-only and credential-only blockers.",
      ],
    },
    {
      stage: "Pair",
      purpose: "Assign bounded reasoning to the model and bounded execution to the orchestrator before planning.",
      inputs: ["repair batch", "validatorSequence", "allowed targets"],
      outputs: ["pairing contract", "handoff order"],
      guardrails: [
        "Model does not run shell commands.",
        "Orchestrator does not widen the batch scope.",
        "Both lanes stay offline and local-only.",
      ],
    },
    {
      stage: "Plan",
      purpose: "Run DeepSeek locally against a bounded repair prompt.",
      inputs: ["repair batch", "pairing contract", "prompt contract"],
      outputs: ["patch proposal JSON", "unified diff"],
      guardrails: [
        "Local engine only.",
        "No shell execution from planner output.",
        "Planner may propose edits only inside batch targets.",
      ],
    },
    {
      stage: "Validate",
      purpose: "Verify the patch offline before any broader rollout.",
      inputs: ["candidate patch", "validatorSequence"],
      outputs: ["pass/fail verdict", "test logs", "updated evaluation line"],
      guardrails: [
        "Fail closed on lint/test/build errors.",
        "Do not widen scope when validation fails.",
        "Record the failure for the next capsule.",
      ],
    },
    {
      stage: "Record",
      purpose: "Feed the result back into the offline loop.",
      inputs: ["validation verdict", "autonomous evaluation", "updated work queue"],
      outputs: ["next backprop capsule", "next repair capsule"],
      guardrails: [
        "Append-only evaluation log.",
        "Keep human approval for medium/high-risk apply.",
        "Never auto-merge destructive changes.",
      ],
    },
  ];
}

function buildPromptContract(): OfflineRepairCapsule["prompt_contract"] {
  return {
    role:
      "You are DeepSeek running fully offline on Gauss. Produce the smallest safe patch that resolves only the current repair batch.",
    instructions: [
      "Use only the files named in the repair batch.",
      "Respect the model/orchestrator pairing contract and do not assume validator or shell authority.",
      "Prefer extraction and simplification over new framework layers.",
      "Do not introduce network calls, new dependencies, or long-running daemons.",
      "If the batch cannot be fixed within limits, return a refusal with the blocking reason.",
    ],
    required_output: [
      "JSON summary with risk, touched files, and validation plan.",
      "Unified diff patch.",
      "Short explanation of why the patch stays inside the batch scope.",
    ],
    validator_policy: [
      "Run the listed validator sequence in order.",
      "Reject the patch on the first failing validator.",
      "If risk is medium/high, require operator approval before apply.",
    ],
  };
}

function buildCapsule(root: string): OfflineRepairCapsule {
  const audit = readJson<AuditReport>(root, "reports/progress/requirements-audit.latest.json");
  const lint = readJson<BackendLintReport>(root, "reports/progress/backend-lint-issues.json");
  const backprop = readJson<BackpropReport>(root, "reports/context/latest-backprop.json");
  const workQueue = readJson<WorkQueueReport>(root, "reports/orchestrator/work-queue.json");
  const hotspots = collectHotspots(root);
  const batteryGuard = getBatteryGuard(root);
  const localEngineUrl =
    (process.env.ORCHESTRATOR_LOCAL_ENGINE_URL ?? process.env.GAUSS_BRAIN_URL ?? "").trim() || null;
  const strictLocalInference = boolFromEnv(process.env.ORCHESTRATOR_STRICT_LOCAL_INFERENCE, true);
  const airGap = boolFromEnv(process.env.GAUSS_AIR_GAP, false);
  const findings = [
    ...buildArchitectureFindings(root, hotspots),
    ...buildAuditFindings(root, audit),
    ...buildRuntimeFindings(root, backprop),
    ...buildQualityFindings(lint),
  ].sort((left, right) => severityScore(right.severity) - severityScore(left.severity));
  const repairBatches = buildRepairBatches(findings);

  return {
    generated_at: nowIso(),
    root,
    profile: {
      offline_required: airGap || strictLocalInference,
      air_gap: airGap,
      strict_local_inference: strictLocalInference,
      local_engine_url: localEngineUrl,
      model_endpoint_mode: resolveModelEndpointMode(localEngineUrl),
      ingest_power_profile: (process.env.INGEST_POWER_PROFILE ?? "nominal").trim() || "nominal",
      power_save_mode: boolFromEnv(process.env.POWER_SAVE_MODE, false),
      battery_percent: batteryGuard.batteryPercent,
      charging: batteryGuard.charging,
      min_safe_battery_percent:
        workQueue?.min_safe_battery_percent ?? batteryGuard.effectiveMinSafeBatteryPercent,
    },
    tech_debt_summary: {
      findings,
      total_findings: findings.length,
      offline_fixable_findings: findings.filter((finding) => finding.offlineFixable).length,
    },
    system_flow: buildSystemFlow(),
    pairing_summary: buildRepairPairingSummary(repairBatches),
    repair_batches: repairBatches,
    prompt_contract: buildPromptContract(),
  };
}

function writeJson(root: string, relativePath: string, value: unknown): string {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolutePath;
}

function main(): void {
  const root = resolveRoot();
  const args = parseArgs(process.argv.slice(2));
  const capsule = buildCapsule(root);
  const outputPath = writeJson(root, args.jsonOut, capsule);
  console.log(
    `OFFLINE_REPAIR_CAPSULE findings=${capsule.tech_debt_summary.total_findings} ` +
      `offline_fixable=${capsule.tech_debt_summary.offline_fixable_findings} output=${outputPath}`,
  );
}

main();
