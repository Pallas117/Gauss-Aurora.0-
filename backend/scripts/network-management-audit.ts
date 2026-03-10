import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type ControlStatus = "pass" | "warn" | "fail";

type Control = {
  id: string;
  title: string;
  status: ControlStatus;
  details: string;
};

function repoRoot(): string {
  const currentFile = decodeURIComponent(new URL(import.meta.url).pathname);
  return path.resolve(path.dirname(currentFile), "..", "..");
}

function checkFileExists(relativePath: string): boolean {
  return existsSync(path.join(repoRoot(), relativePath));
}

function checkFileContains(relativePath: string, pattern: RegExp): boolean {
  const full = path.join(repoRoot(), relativePath);
  if (!existsSync(full)) return false;
  return pattern.test(readFileSync(full, "utf8"));
}

function envBool(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "off", "no", "disabled"].includes(raw);
}

async function checkLiveAuditEndpoint(): Promise<Control> {
  const configuredUrl = (
    process.env.DTN_ISL_AUDIT_URL ??
    process.env.ORCHESTRATOR_PASS_API_NETWORK_AUDIT_URL ??
    ""
  ).trim();

  if (!configuredUrl) {
    return {
      id: "DTN-LIVE-0",
      title: "Configured DTN audit upstream",
      status: "warn",
      details: "DTN_ISL_AUDIT_URL is not configured. Backend ops status will remain local-only until an upstream audit feed is added.",
    };
  }

  try {
    const response = await fetch(configuredUrl, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) {
      return {
        id: "DTN-LIVE-1",
        title: "Configured DTN audit upstream",
        status: "fail",
        details: `Audit endpoint ${configuredUrl} returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as {
      readiness_score?: number;
      fail?: number;
      warn?: number;
      pass?: number;
    };
    const fail = typeof payload.fail === "number" ? payload.fail : 0;
    const warn = typeof payload.warn === "number" ? payload.warn : 0;
    const pass = typeof payload.pass === "number" ? payload.pass : 0;
    const score = typeof payload.readiness_score === "number" ? payload.readiness_score : 0;

    return {
      id: "DTN-LIVE-1",
      title: "Configured DTN audit upstream",
      status: fail > 0 ? "fail" : "pass",
      details: `Endpoint reachable at ${configuredUrl}. score=${score}, pass=${pass}, warn=${warn}, fail=${fail}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return {
      id: "DTN-LIVE-1",
      title: "Configured DTN audit upstream",
      status: "fail",
      details: `Unable to reach ${configuredUrl}: ${message}`,
    };
  }
}

async function runChecks(): Promise<Control[]> {
  const checks: Control[] = [];

  const hasNetworkModule = checkFileExists("gauss-orchestrator/src/network_management.rs");
  checks.push({
    id: "DTN-ISL-1",
    title: "Network management module",
    status: hasNetworkModule ? "pass" : "fail",
    details: hasNetworkModule
      ? "Rust DTN/ISL network manager module is present."
      : "Missing gauss-orchestrator/src/network_management.rs.",
  });

  const hasPassApiRoutes =
    checkFileContains("gauss-orchestrator/src/pass_api.rs", /\"\/network\/audit\"/) &&
    checkFileContains("gauss-orchestrator/src/pass_api.rs", /\"\/network\/route\/plan\"/) &&
    checkFileContains("gauss-orchestrator/src/pass_api.rs", /\"\/network\/links\"/);
  checks.push({
    id: "DTN-ISL-2",
    title: "Pass API network routes",
    status: hasPassApiRoutes ? "pass" : "fail",
    details: hasPassApiRoutes
      ? "Pass API exposes network audit, route planning, and link inventory routes."
      : "Missing one or more network routes in pass_api.rs.",
  });

  const hasOpsSurface = checkFileContains("backend/routes/ops-control.ts", /\/api\/ops\/network\/audit/) &&
    checkFileContains("backend/mission-logic.ts", /loadDtnIslStatus/);
  checks.push({
    id: "DTN-ISL-3",
    title: "Backend ops surface for DTN status",
    status: hasOpsSurface ? "pass" : "fail",
    details: hasOpsSurface
      ? "Backend exposes DTN audit status through ops-control routes and mission logic."
      : "Missing DTN audit surface in backend routes or mission logic.",
  });

  const hasOpsContract = checkFileContains("src/lib/contracts/ops-command.ts", /dtnIslStatus/);
  checks.push({
    id: "DTN-ISL-4",
    title: "Frontend ops contract updated",
    status: hasOpsContract ? "pass" : "fail",
    details: hasOpsContract
      ? "Ops snapshot contract includes DTN/ISL status payload."
      : "Missing dtnIslStatus in ops-command contract.",
  });

  checks.push(await checkLiveAuditEndpoint());
  return checks;
}

async function main(): Promise<void> {
  const checks = await runChecks();
  let pass = 0;
  let warn = 0;
  let fail = 0;

  console.log("DTN + ISL Network Management Audit");
  console.log("===============================");

  for (const check of checks) {
    if (check.status === "pass") pass += 1;
    if (check.status === "warn") warn += 1;
    if (check.status === "fail") fail += 1;
    console.log(`[${check.status.toUpperCase().padEnd(4, " ")}] ${check.id} - ${check.title}`);
    console.log(`       ${check.details}`);
  }

  console.log("");
  console.log(`Summary: ${checks.length} checks, ${pass} pass, ${warn} warn, ${fail} fail`);

  if (fail > 0) {
    process.exit(1);
  }
}

main();
