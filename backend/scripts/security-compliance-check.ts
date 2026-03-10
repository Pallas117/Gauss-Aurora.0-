import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

type ControlStatus = "pass" | "warn" | "fail";

type ControlCheck = {
  id: string;
  framework: string;
  title: string;
  status: ControlStatus;
  details: string;
};

function hasArg(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function argValue(flag: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (typeof value !== "string" || value.startsWith("--")) return null;
  return value;
}

function repoRoot(): string {
  const currentFile = decodeURIComponent(new URL(import.meta.url).pathname);
  return path.resolve(path.dirname(currentFile), "..", "..");
}

function checkFileContains(relativePath: string, pattern: RegExp): boolean {
  const full = path.join(repoRoot(), relativePath);
  if (!existsSync(full)) {
    return false;
  }
  return pattern.test(readFileSync(full, "utf8"));
}

function checkTreeContains(relativePath: string, pattern: RegExp): boolean {
  const full = path.join(repoRoot(), relativePath);
  if (!existsSync(full)) {
    return false;
  }

  const entry = statSync(full);
  if (entry.isFile()) {
    return pattern.test(readFileSync(full, "utf8"));
  }

  for (const child of readdirSync(full)) {
    if (checkTreeContains(path.join(relativePath, child), pattern)) {
      return true;
    }
  }

  return false;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function runChecks(): ControlCheck[] {
  const checks: ControlCheck[] = [];
  const authRequired = envBool("AUTH_REQUIRED", true);
  checks.push({
    id: "NIST-AC-3",
    framework: "NIST SP 800-53 Rev.5",
    title: "Access enforcement with authenticated API boundary",
    status: authRequired ? "pass" : "warn",
    details: authRequired
      ? "AUTH_REQUIRED is enabled by default."
      : "AUTH_REQUIRED=false detected. Use only for local non-production debugging.",
  });

  const hasRoleGate =
    checkTreeContains("backend/routes", /requireRole\("admin"\)|requireRole\("operator"\)/) ||
    checkFileContains("backend/server.ts", /requireRole\("admin"\)|requireRole\("operator"\)/);
  checks.push({
    id: "NIST-CSF-PR.AA",
    framework: "NIST CSF 2.0",
    title: "Role-based authorization control",
    status: hasRoleGate ? "pass" : "fail",
    details: hasRoleGate
      ? "Role gate calls found in backend routes."
      : "No role gate calls detected in backend routes.",
  });

  const hasAuditEvents = checkFileContains("backend/cybertiger/daemon.ts", /type:\s*"auth\.failure"|type:\s*"ip\.blocked"/);
  checks.push({
    id: "ISO-A.8.15",
    framework: "ISO/IEC 27001:2022",
    title: "Logging and security event traceability",
    status: hasAuditEvents ? "pass" : "fail",
    details: hasAuditEvents
      ? "CyberTiger event generation patterns detected."
      : "CyberTiger event generation patterns not detected.",
  });

  const hasRateLimit = checkFileContains("backend/cybertiger/daemon.ts", /rateLimitWindowMs|applyRateLimit/);
  checks.push({
    id: "NIST-SC-7",
    framework: "NIST SP 800-53 Rev.5",
    title: "Boundary protection and request throttling",
    status: hasRateLimit ? "pass" : "fail",
    details: hasRateLimit
      ? "Rate-limiting controls present in daemon implementation."
      : "Rate-limiting controls missing in daemon implementation.",
  });

  const hasSignatureDetection = checkFileContains("backend/cybertiger/daemon.ts", /SIGNATURE_PATTERNS|detectSignature/);
  checks.push({
    id: "NIST-SI-4",
    framework: "NIST SP 800-53 Rev.5",
    title: "Security monitoring and anomaly detection",
    status: hasSignatureDetection ? "pass" : "fail",
    details: hasSignatureDetection
      ? "Signature-based detection controls present."
      : "Signature-based detection controls missing.",
  });

  const hasSpaceGuidanceDoc = existsSync(path.join(repoRoot(), "docs", "CYBERTIGER_COMPLIANCE_BASELINE.md"));
  checks.push({
    id: "SPACE-NISTIR-8401",
    framework: "NISTIR 8401 / Satellite Ground Segment",
    title: "Documented mapping to satellite cybersecurity guidance",
    status: hasSpaceGuidanceDoc ? "pass" : "warn",
    details: hasSpaceGuidanceDoc
      ? "Compliance baseline document present."
      : "Compliance baseline document missing.",
  });

  const hasDtnAuditScript = checkFileContains(
    "backend/scripts/network-management-audit.ts",
    /DTN \+ ISL Network Management Audit|network\/audit/,
  );
  checks.push({
    id: "SPACE-DTN-1",
    framework: "DTN/ISL Operations Baseline",
    title: "DTN + ISL network-management audit control exists",
    status: hasDtnAuditScript ? "pass" : "fail",
    details: hasDtnAuditScript
      ? "Network-management audit script is present."
      : "Missing backend/scripts/network-management-audit.ts.",
  });

  const hasPassApiNetworkRoutes =
    checkFileContains("gauss-orchestrator/src/pass_api.rs", /"\/network\/audit"/) &&
    checkFileContains("gauss-orchestrator/src/pass_api.rs", /"\/network\/route\/plan"/);
  checks.push({
    id: "SPACE-DTN-2",
    framework: "DTN/ISL Operations Baseline",
    title: "API-first network route planning and audit endpoints",
    status: hasPassApiNetworkRoutes ? "pass" : "warn",
    details: hasPassApiNetworkRoutes
      ? "Pass API exposes network audit and route planning routes."
      : "Pass API network routes missing or incomplete.",
  });

  return checks;
}

function buildReport(checks: ControlCheck[]): {
  generated_at: string;
  totals: { pass: number; warn: number; fail: number };
  controls: ControlCheck[];
} {
  let pass = 0;
  let warn = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.status === "pass") pass += 1;
    if (c.status === "warn") warn += 1;
    if (c.status === "fail") fail += 1;
  }
  return {
    generated_at: new Date().toISOString(),
    totals: { pass, warn, fail },
    controls: checks,
  };
}

function main(): void {
  const checks = runChecks();
  const jsonOut = argValue("--json-out");
  const jsonStdout = hasArg("--json");

  const report = buildReport(checks);

  if (jsonOut) {
    const resolved = path.resolve(process.cwd(), jsonOut);
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (jsonStdout) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    let failed = 0;
    let warned = 0;

    console.log("CyberTiger Security Compliance Check");
    console.log("====================================");
    for (const check of checks) {
      if (check.status === "fail") failed += 1;
      if (check.status === "warn") warned += 1;
      const prefix = check.status.toUpperCase().padEnd(4, " ");
      console.log(`[${prefix}] ${check.id} (${check.framework}) - ${check.title}`);
      console.log(`       ${check.details}`);
    }

    console.log("");
    console.log(`Summary: ${checks.length} checks, ${failed} fail, ${warned} warn`);
  }

  if (report.totals.fail > 0) {
    process.exit(1);
  }
}

main();
