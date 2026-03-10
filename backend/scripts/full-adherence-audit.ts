import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getBatteryGuard } from "./battery-and-work-queue.js";

type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

type CheckResult = {
  name: string;
  command: string;
  status: CheckStatus;
  exitCode: number | null;
  detail: string;
};

type AuditTotals = { pass: number; warn: number; fail: number; skip: number };

type AuditPayload = {
  generated_at: string;
  strict_mode: boolean;
  totals: AuditTotals;
  checks: CheckResult[];
  security_compliance?: unknown;
  /** True when only light checks ran due to low battery. */
  battery_safe_run?: boolean;
  /** Set when audit was skipped entirely (e.g. low_battery). */
  skipped?: string;
};

/** Env for child processes: strip npm env vars that trigger "Unknown env config" warnings. */
function sanitizeEnvForNpm(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  if ("npm_config_devdir" in out) delete out.npm_config_devdir;
  return out;
}

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

function requiredRbacEnvKeys(): string[] {
  const base = [
    "RBAC_VIEWER_EMAIL",
    "RBAC_VIEWER_PASSWORD",
    "RBAC_OPERATOR_EMAIL",
    "RBAC_OPERATOR_PASSWORD",
  ];
  if ((process.env.RBAC_TEST_TRAIN ?? "false").toLowerCase() === "true") {
    base.push("RBAC_ADMIN_EMAIL", "RBAC_ADMIN_PASSWORD");
  }
  return base;
}

function getMissingEnv(keys: string[]): string[] {
  return keys.filter((key) => {
    const value = process.env[key];
    return !(typeof value === "string" && value.trim().length > 0);
  });
}

function buildRbacPreflightCheck(strictMode: boolean): CheckResult {
  const required = requiredRbacEnvKeys();
  const missing = getMissingEnv(required);
  if (missing.length === 0) {
    return {
      name: "RBAC Environment Preflight",
      command: `env ${required.join(" ")}`,
      status: "PASS",
      exitCode: 0,
      detail: `All required RBAC variables are set (${required.join(", ")})`,
    };
  }

  const status: CheckStatus = strictMode ? "FAIL" : "SKIP";
  return {
    name: "RBAC Environment Preflight",
    command: `env ${required.join(" ")}`,
    status,
    exitCode: null,
    detail:
      `Missing RBAC variables: ${missing.join(", ")}. ` +
      "Run `npm run setup:rbac` and export credentials before runtime audit.",
  };
}

function runCommand(name: string, command: string, opts?: { allowFail?: boolean }): CheckResult {
  const proc = spawnSync("bash", ["-lc", command], {
    env: sanitizeEnvForNpm(process.env),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });

  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
  const exitCode = proc.status;
  const passed = exitCode === 0;
  const status: CheckStatus = passed ? "PASS" : opts?.allowFail ? "WARN" : "FAIL";

  const detail = output.length > 800 ? `${output.slice(0, 800)}\n...<truncated>` : output;
  return {
    name,
    command,
    status,
    exitCode,
    detail,
  };
}

function printResult(result: CheckResult): void {
  console.log(`[${result.status}] ${result.name}`);
  console.log(`       cmd: ${result.command}`);
  console.log(`       exit: ${result.exitCode ?? "null"}`);
  if (result.detail.length > 0) {
    const lines = result.detail.split("\n");
    const preview = lines.slice(0, 6).join("\n");
    console.log(`       output:\n${preview}`);
    if (lines.length > 6) {
      console.log("       ...");
    }
  }
}

function summary(
  results: CheckResult[],
): { pass: number; warn: number; fail: number; skip: number } {
  return results.reduce(
    (acc, item) => {
      if (item.status === "PASS") acc.pass += 1;
      if (item.status === "WARN") acc.warn += 1;
      if (item.status === "FAIL") acc.fail += 1;
      if (item.status === "SKIP") acc.skip += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0, skip: 0 },
  );
}

const SECURITY_COMPLIANCE_JSON_PATH = "reports/progress/security-compliance.latest.json";

function loadSecurityComplianceReport(root: string): unknown | null {
  const full = path.resolve(root, SECURITY_COMPLIANCE_JSON_PATH);
  try {
    const raw = readFileSync(full, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function buildPayload(
  strictMode: boolean,
  checks: CheckResult[],
  cwd: string,
  opts?: { battery_safe_run?: boolean; skipped?: string }
): AuditPayload {
  const totals = summary(checks);
  const payload: AuditPayload = {
    generated_at: new Date().toISOString(),
    strict_mode: strictMode,
    totals,
    checks: checks.map((check) => ({
      name: check.name,
      command: check.command,
      status: check.status,
      exitCode: check.exitCode,
      detail: check.detail,
    })),
  };
  if (opts?.battery_safe_run) payload.battery_safe_run = true;
  if (opts?.skipped) payload.skipped = opts.skipped;
  const securityCompliance = loadSecurityComplianceReport(cwd);
  if (securityCompliance != null) {
    payload.security_compliance = securityCompliance;
  }
  return payload;
}

function writeJsonReport(jsonOutPath: string, payload: unknown): void {
  const resolved = path.resolve(process.cwd(), jsonOutPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Light subset when battery is below min_safe_battery_percent: RBAC preflight, lint, directive, backend-env. */
function runLightAudit(strictMode: boolean): { checks: CheckResult[]; battery_safe_run: true } {
  const checks: CheckResult[] = [];
  checks.push(buildRbacPreflightCheck(strictMode));
  // No RBAC runtime test in light mode
  checks.push(runCommand("TypeScript Lint", "npm run lint"));
  checks.push(runCommand("Directive adherence (Python)", "npm run check:directive", { allowFail: true }));
  checks.push(runCommand("Backend Environment Sanity", "npm run check:backend-env"));
  return { checks, battery_safe_run: true };
}

function runFullAudit(strictMode: boolean): CheckResult[] {
  const checks: CheckResult[] = [];

  const rbacPreflight = buildRbacPreflightCheck(strictMode);
  checks.push(rbacPreflight);
  if (rbacPreflight.status === "PASS") {
    checks.push(runCommand("RBAC Runtime Smoke Test", "npm run test:rbac"));
  } else {
    checks.push({
      name: "RBAC Runtime Smoke Test",
      command: "npm run test:rbac",
      status: strictMode ? "FAIL" : "SKIP",
      exitCode: null,
      detail:
        "Skipped because RBAC preflight did not pass. Set RBAC_* variables to run runtime auth verification.",
    });
  }

  checks.push(runCommand("TypeScript Lint", "npm run lint"));
  checks.push(runCommand("Unit/Integration Tests", "npm test"));
  checks.push(runCommand("Orchestrator Tests", "npm run test:orchestrator"));

  const ingestToken = process.env.ORCHESTRATOR_INGEST_API_TOKEN;
  if (typeof ingestToken === "string" && ingestToken.trim().length > 0) {
    checks.push(
      runCommand(
        "Orchestrator ingest E2E",
        "node --env-file-if-exists=.env --import tsx backend/scripts/orchestrator-ingest-e2e.ts",
      ),
    );
  } else {
    checks.push({
      name: "Orchestrator ingest E2E",
      command: "POST /api/ingest/telemetry/packets",
      status: "SKIP",
      exitCode: null,
      detail:
        "Set ORCHESTRATOR_INGEST_API_TOKEN to validate orchestrator ingest E2E (canonical packet POST to backend).",
    });
  }

  if (typeof ingestToken === "string" && ingestToken.trim().length > 0) {
    checks.push(
      runCommand(
        "Orchestrator live ingest (one file)",
        "npm run test:orchestrator:live-ingest",
      ),
    );
  } else {
    checks.push({
      name: "Orchestrator live ingest (one file)",
      command: "cargo run --process-file",
      status: "SKIP",
      exitCode: null,
      detail:
        "Set ORCHESTRATOR_INGEST_API_TOKEN to validate live orchestrator processing one fixture file and POSTing to backend (backend must be running).",
    });
  }

  checks.push(
    runCommand(
      "Security Compliance Mapping Check",
      `node --env-file-if-exists=.env --import tsx backend/scripts/security-compliance-check.ts --json-out ${SECURITY_COMPLIANCE_JSON_PATH}`,
    ),
  );
  checks.push(runCommand("Directive adherence (Python)", "npm run check:directive", { allowFail: true }));
  checks.push(runCommand("Production Build", "npm run build"));
  checks.push(runCommand("Backend Environment Sanity", "npm run check:backend-env"));
  if (
    getMissingEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]).length < 2 &&
    getMissingEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]).length < 2 &&
    (process.env.RBAC_VIEWER_TOKEN ?? (process.env.RBAC_VIEWER_EMAIL && process.env.RBAC_VIEWER_PASSWORD))
  ) {
    checks.push(
      runCommand(
        "Supabase RLS Smoke",
        "node --env-file-if-exists=.env --import tsx backend/scripts/supabase-rls-smoke.ts",
      ),
    );
  } else {
    checks.push({
      name: "Supabase RLS Smoke",
      command: "npm run test:supabase-rls",
      status: "SKIP",
      exitCode: null,
      detail:
        "Set SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY), and RBAC_VIEWER_TOKEN or RBAC_VIEWER_EMAIL/RBAC_VIEWER_PASSWORD to run RLS smoke.",
    });
  }
  checks.push(runCommand("DTN+ISL Network Management Audit", "npm run check:network-management"));
  checks.push(runCommand("Demand Features Audit", "npm run check:demand-features"));

  return checks;
}

function main(): void {
  const strictMode = hasArg("--strict");
  const jsonOnly = hasArg("--json");
  const jsonOutPath = argValue("--json-out");
  const noBatteryCheck = hasArg("--no-battery-check");
  const cwd = process.cwd();

  let checks: CheckResult[];
  let payloadOpts: { battery_safe_run?: boolean; skipped?: string } | undefined;

  if (!noBatteryCheck) {
    const batteryGuard = getBatteryGuard(cwd);
    const battery = batteryGuard.batteryPercent;
    if (battery !== null && batteryGuard.isLowBattery) {
      const chargingLabel =
        batteryGuard.charging === null
          ? "unknown"
          : batteryGuard.charging
            ? "charging"
            : "discharging";
      console.warn(
        `[Audit] Battery ${battery}% (${chargingLabel}) below min_safe_battery_percent (${batteryGuard.effectiveMinSafeBatteryPercent}); running light audit only. Use --no-battery-check to force full audit.`,
      );
      const light = runLightAudit(strictMode);
      checks = light.checks;
      payloadOpts = { battery_safe_run: light.battery_safe_run };
    } else {
      checks = runFullAudit(strictMode);
    }
  } else {
    checks = runFullAudit(strictMode);
  }

  const defaultJsonPath = "reports/progress/requirements-audit.latest.json";
  const outPath = jsonOutPath ?? defaultJsonPath;
  const payload = buildPayload(strictMode, checks, cwd, payloadOpts);
  writeJsonReport(outPath, payload);

  if (jsonOnly) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Full Adherence Audit${strictMode ? " (strict mode)" : ""}${payloadOpts?.battery_safe_run ? " [battery-safe light run]" : ""}`);
    console.log("====================");
    checks.forEach(printResult);

    const totals = summary(checks);
    console.log("");
    console.log(
      `Summary: PASS=${totals.pass}, WARN=${totals.warn}, FAIL=${totals.fail}, SKIP=${totals.skip}`,
    );
  }

  const exitTotals = summary(checks);
  if (exitTotals.fail > 0 || (strictMode && exitTotals.warn > 0)) {
    process.exit(1);
  }
}

main();
