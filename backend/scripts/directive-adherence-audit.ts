/**
 * PROJECT GAUSS directive adherence audit.
 * Runs all directive-related checks and writes a machine-readable report
 * (same shape as full-adherence-audit) for orchestrator/CI.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type CheckStatus = "PASS" | "WARN" | "FAIL";

type CheckResult = {
  name: string;
  command: string;
  status: CheckStatus;
  exitCode: number | null;
  detail: string;
};

const TELEMETRY_LOG_CAP_MAX = 50;
const MIN_POLL_MS = 1000;

function runCommand(name: string, command: string, opts?: { allowFail?: boolean }): CheckResult {
  const proc = spawnSync("bash", ["-lc", command], {
    env: process.env,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    cwd: process.cwd(),
  });
  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
  const exitCode = proc.status;
  const passed = exitCode === 0;
  const status: CheckStatus = passed ? "PASS" : opts?.allowFail ? "WARN" : "FAIL";
  const detail = output.length > 800 ? `${output.slice(0, 800)}\n...<truncated>` : output;
  return { name, command, status, exitCode, detail };
}

function checkPythonDirective(): CheckResult {
  const script = path.resolve(process.cwd(), "backend/scripts/check-directive-python.py");
  if (!existsSync(script)) {
    return {
      name: "Python directive (GC + lazy load)",
      command: "check-directive-python.py",
      status: "WARN",
      exitCode: null,
      detail: "check-directive-python.py not found",
    };
  }
  const proc = spawnSync("python3", [script], {
    encoding: "utf8",
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
  const status: CheckStatus = proc.status === 0 ? "PASS" : "FAIL";
  return {
    name: "Python directive (GC + lazy load)",
    command: `python3 backend/scripts/check-directive-python.py`,
    status,
    exitCode: proc.status,
    detail: output.length > 600 ? `${output.slice(0, 600)}\n...` : output,
  };
}

function checkMlxCacheLimit(): CheckResult {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) {
    return {
      name: "mlx_lm cache limit (--cache-limit-gb 2.5)",
      command: "grep",
      status: "PASS",
      exitCode: 0,
      detail: "No package.json; no mlx_lm launch in repo (PASS).",
    };
  }
  const content = readFileSync(pkgPath, "utf8");
  if (!content.includes("mlx_lm") && !content.includes("mlx-lm")) {
    return {
      name: "mlx_lm cache limit (--cache-limit-gb 2.5)",
      command: "grep mlx",
      status: "PASS",
      exitCode: 0,
      detail: "No mlx_lm launch in package.json; when added, must use --cache-limit-gb 2.5.",
    };
  }
  const hasCacheLimit =
    content.includes("--cache-limit-gb") && content.includes("2.5");
  return {
    name: "mlx_lm cache limit (--cache-limit-gb 2.5)",
    command: "grep --cache-limit-gb package.json scripts",
    status: hasCacheLimit ? "PASS" : "WARN",
    exitCode: hasCacheLimit ? 0 : 1,
    detail: hasCacheLimit
      ? "mlx_lm launch includes --cache-limit-gb 2.5."
      : "If mlx_lm is used, add --cache-limit-gb 2.5 to launch command.",
  };
}

function checkBackendPollingCadence(): CheckResult {
  return runCommand(
    "Backend polling cadence (>= 1000 ms)",
    "node --import tsx --test backend/power-polling.test.ts",
  );
}

function checkProbabilityGate(): CheckResult {
  return runCommand(
    "Probability gate (LLM only after 3-sigma)",
    "node --import tsx --test backend/ml-client/probability-gate.test.ts",
  );
}

function checkRagChecksum(): CheckResult {
  const testPath = path.join(process.cwd(), "ml/rag/test_rag_checksum_directive.py");
  if (!existsSync(testPath)) {
    return {
      name: "RAG checksum before LLM (SEU resilience)",
      command: "pytest ml/rag/test_rag_checksum_directive.py",
      status: "WARN",
      exitCode: null,
      detail: "test_rag_checksum_directive.py not found",
    };
  }
  const proc = spawnSync("python3", ["-m", "pytest", "ml/rag/test_rag_checksum_directive.py", "-v", "--tb=short"], {
    encoding: "utf8",
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
  const status: CheckStatus = proc.status === 0 ? "PASS" : "FAIL";
  return {
    name: "RAG checksum before LLM (SEU resilience)",
    command: "python3 -m pytest ml/rag/test_rag_checksum_directive.py",
    status,
    exitCode: proc.status,
    detail: output.length > 600 ? `${output.slice(0, 600)}\n...` : output,
  };
}

function checkAirGapped(): CheckResult {
  const dirs = ["backend", "ml"];
  const patterns = ["aws\\.", "openai\\.com", "api\\.openai"];
  const violations: string[] = [];
  for (const dir of dirs) {
    const full = path.join(process.cwd(), dir);
    if (!existsSync(full)) continue;
    for (const pattern of patterns) {
      const proc = spawnSync("grep", ["-r", "-l", "-E", pattern, full], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      if (proc.status === 0 && proc.stdout) {
        const files = proc.stdout.trim().split("\n").filter(Boolean);
        for (const f of files) {
          if (f.includes("node_modules") || f.includes(".json")) continue;
          violations.push(`${f}: matches ${pattern}`);
        }
      }
    }
  }
  const status: CheckStatus = violations.length === 0 ? "PASS" : "WARN";
  return {
    name: "Air-gapped (no cloud API in core)",
    command: "grep aws/openai in backend ml",
    status,
    exitCode: violations.length === 0 ? 0 : 1,
    detail:
      violations.length === 0
        ? "No aws/openai references in backend/ml."
        : violations.slice(0, 10).join("\n") + (violations.length > 10 ? "\n..." : ""),
  };
}

function checkReactStateCap(): CheckResult {
  const srcDir = path.join(process.cwd(), "src");
  if (!existsSync(srcDir)) {
    return {
      name: "React telemetry log cap (<= 50)",
      command: "grep setLogs/setTasks slice",
      status: "PASS",
      exitCode: 0,
      detail: "No src/; skip.",
    };
  }
  const violations: string[] = [];
  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
        walk(full);
      } else if (e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".jsx"))) {
        const content = readFileSync(full, "utf8");
        if (!content.includes("setLogs") && !content.includes("setTasks")) continue;
        const re = /\.slice\s*\(\s*0\s*,\s*(\d+)\s*\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          const num = parseInt(m[1]!, 10);
          if (num > TELEMETRY_LOG_CAP_MAX) {
            violations.push(`${full}: .slice(0, ${num}) exceeds directive max ${TELEMETRY_LOG_CAP_MAX}`);
          }
        }
      }
    }
  }
  walk(srcDir);
  const status: CheckStatus = violations.length === 0 ? "PASS" : "FAIL";
  return {
    name: "React telemetry log cap (<= 50)",
    command: "grep setLogs/setTasks .slice(0,N)",
    status,
    exitCode: violations.length === 0 ? 0 : 1,
    detail:
      violations.length === 0
        ? `All log/task state caps <= ${TELEMETRY_LOG_CAP_MAX}.`
        : violations.join("\n"),
  };
}

function summary(results: CheckResult[]): { pass: number; warn: number; fail: number } {
  return results.reduce(
    (acc, item) => {
      if (item.status === "PASS") acc.pass += 1;
      if (item.status === "WARN") acc.warn += 1;
      if (item.status === "FAIL") acc.fail += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function main(): void {
  const checks: CheckResult[] = [];
  checks.push(checkPythonDirective());
  checks.push(checkMlxCacheLimit());
  checks.push(checkBackendPollingCadence());
  checks.push(checkProbabilityGate());
  checks.push(checkRagChecksum());
  checks.push(checkAirGapped());
  checks.push(checkReactStateCap());

  const totals = summary(checks);
  const payload = {
    generated_at: new Date().toISOString(),
    totals,
    checks: checks.map((c) => ({
      name: c.name,
      command: c.command,
      status: c.status,
      exitCode: c.exitCode,
      detail: c.detail,
    })),
  };

  const jsonOut = process.argv.includes("--json-out")
    ? process.argv[process.argv.indexOf("--json-out") + 1]
    : null;
  if (jsonOut) {
    const resolved = path.resolve(process.cwd(), jsonOut);
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  if (!process.argv.includes("--json")) {
    console.log("Directive Adherence Audit");
    console.log("========================");
    for (const c of checks) {
      console.log(`[${c.status}] ${c.name}`);
      console.log(`       cmd: ${c.command}`);
      if (c.detail.length > 0) {
        const lines = c.detail.split("\n").slice(0, 5);
        console.log(`       output:\n${lines.join("\n")}`);
      }
    }
    console.log("");
    console.log(`Summary: PASS=${totals.pass}, WARN=${totals.warn}, FAIL=${totals.fail}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }

  if (totals.fail > 0) {
    process.exit(1);
  }
}

main();
