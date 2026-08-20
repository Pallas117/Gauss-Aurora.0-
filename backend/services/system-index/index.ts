import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface RouteEntry {
  method: string;
  path: string;
  file: string;
}

export interface RouteTestLink {
  route: string;
  tests: string[];
}

export interface FailureSignature {
  id: string;
  source: string;
  summary: string;
  fingerprint: string;
}

export interface RiskRegisterEntry {
  id: string;
  severity: "low" | "medium" | "high";
  source: string;
  summary: string;
}

const ROUTE_REGEX = /\b(app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;

function loadJson(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function extractRoutesFromFile(filePath: string, repoRoot: string): RouteEntry[] {
  const src = readFileSync(filePath, "utf8");
  const entries: RouteEntry[] = [];
  for (const match of src.matchAll(ROUTE_REGEX)) {
    const method = (match[2] ?? "get").toUpperCase();
    const routePath = match[3] ?? "";
    if (!routePath.startsWith("/")) continue;
    entries.push({
      method,
      path: routePath,
      file: path.relative(repoRoot, filePath).split(path.sep).join("/"),
    });
  }
  return entries;
}

export function buildRouteTestLinks(
  routes: RouteEntry[],
  testFiles: string[],
  repoRoot: string,
): RouteTestLink[] {
  const testContents = new Map<string, string>();
  for (const testFile of testFiles) {
    testContents.set(testFile, readFileSync(testFile, "utf8"));
  }

  return routes.map((route) => {
    const tests: string[] = [];
    for (const testFile of testFiles) {
      const src = testContents.get(testFile) ?? "";
      if (src.includes(route.path)) {
        tests.push(path.relative(repoRoot, testFile).split(path.sep).join("/"));
      }
    }
    return { route: `${route.method} ${route.path}`, tests };
  });
}

export function buildFailureSignatures(repoRoot: string): FailureSignature[] {
  const signatures: FailureSignature[] = [];
  const sweepFailuresPath = path.join(repoRoot, "reports", "orchestrator", "sweep-failures.json");
  const sweep = loadJson(sweepFailuresPath);
  if (Array.isArray(sweep)) {
    for (const entry of sweep.slice(0, 200)) {
      const summary =
        typeof entry === "string"
          ? entry
          : JSON.stringify(entry).slice(0, 400);
      const fingerprint = summary.toLowerCase().replace(/\s+/g, " ").slice(0, 120);
      signatures.push({
        id: `sweep-${signatures.length + 1}`,
        source: "reports/orchestrator/sweep-failures.json",
        summary,
        fingerprint,
      });
    }
  }

  const debugPath = path.join(repoRoot, "reports", "orchestrator", "sweep-debug.json");
  const debug = loadJson(debugPath);
  if (debug && typeof debug === "object") {
    const summary = JSON.stringify(debug).slice(0, 600);
    signatures.push({
      id: `debug-${signatures.length + 1}`,
      source: "reports/orchestrator/sweep-debug.json",
      summary,
      fingerprint: summary.toLowerCase().replace(/\s+/g, " ").slice(0, 120),
    });
  }
  return signatures;
}

export function buildRuntimeRiskRegister(repoRoot: string): RiskRegisterEntry[] {
  const out: RiskRegisterEntry[] = [];

  const requirementsPath = path.join(repoRoot, "reports", "progress", "requirements-audit.latest.json");
  const requirements = loadJson(requirementsPath) as
    | { summary?: { failed?: number; warned?: number } }
    | null;
  if (requirements?.summary) {
    const failed = Number(requirements.summary.failed ?? 0);
    const warned = Number(requirements.summary.warned ?? 0);
    out.push({
      id: "requirements-audit",
      severity: failed > 0 ? "high" : warned > 0 ? "medium" : "low",
      source: "reports/progress/requirements-audit.latest.json",
      summary: `requirements failed=${failed} warned=${warned}`,
    });
  }

  const securityPath = path.join(repoRoot, "reports", "progress", "security-compliance.latest.json");
  const security = loadJson(securityPath) as
    | { summary?: { fail?: number; warn?: number; pass?: number } }
    | null;
  if (security?.summary) {
    const fail = Number(security.summary.fail ?? 0);
    const warn = Number(security.summary.warn ?? 0);
    out.push({
      id: "security-compliance",
      severity: fail > 0 ? "high" : warn > 0 ? "medium" : "low",
      source: "reports/progress/security-compliance.latest.json",
      summary: `security fail=${fail} warn=${warn}`,
    });
  }

  const powerPath = path.join(repoRoot, "reports", "progress", "power-drain-audit.latest.json");
  const power = loadJson(powerPath) as
    | { status?: string; summary?: string }
    | null;
  if (power) {
    const status = (power.status ?? "unknown").toString().toLowerCase();
    out.push({
      id: "power-drain-audit",
      severity: status === "critical" || status === "fail" ? "high" : status === "warn" ? "medium" : "low",
      source: "reports/progress/power-drain-audit.latest.json",
      summary: typeof power.summary === "string" ? power.summary : `power status=${status}`,
    });
  }

  return out;
}
