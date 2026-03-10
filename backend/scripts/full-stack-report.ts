import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";
export type FinalStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL";

export type MissionCheck = {
  phase: string;
  name: string;
  mandatory: boolean;
  status: CheckStatus;
  command?: string;
  detail?: string;
  durationMs?: number;
  remediation?: string;
  rerunCommand?: string;
};

export type MissionSummary = {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  skip: number;
  mandatoryFailures: number;
  optionalFailures: number;
};

export type MissionConfig = {
  frontendUrl: string;
  backendUrl: string;
  brainUrl: string;
  ragUrl: string | null;
  writeMode: string;
  cleanup: boolean;
  runTrainCheck: boolean;
  runUiE2E: boolean;
  runUiMobile: boolean;
};

export type MissionReport = {
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: FinalStatus;
  config: MissionConfig;
  checks: MissionCheck[];
  summary: MissionSummary;
  triage?: {
    name: string;
    command?: string;
    detail?: string;
    remediation?: string;
    rerunCommand?: string;
  } | null;
};

export function summarizeChecks(checks: MissionCheck[]): MissionSummary {
  const summary: MissionSummary = {
    total: checks.length,
    pass: 0,
    warn: 0,
    fail: 0,
    skip: 0,
    mandatoryFailures: 0,
    optionalFailures: 0,
  };

  for (const check of checks) {
    if (check.status === "PASS") summary.pass += 1;
    if (check.status === "WARN") summary.warn += 1;
    if (check.status === "FAIL") {
      summary.fail += 1;
      if (check.mandatory) {
        summary.mandatoryFailures += 1;
      } else {
        summary.optionalFailures += 1;
      }
    }
    if (check.status === "SKIP") summary.skip += 1;
  }

  return summary;
}

export function computeFinalStatus(summary: MissionSummary): FinalStatus {
  if (summary.mandatoryFailures > 0) {
    return "FAIL";
  }
  if (summary.fail > 0 || summary.warn > 0) {
    return "PASS_WITH_WARNINGS";
  }
  return "PASS";
}

export function findTriage(checks: MissionCheck[]) {
  const failed = checks.find((check) => check.status === "FAIL" && check.mandatory);
  if (failed) {
    return {
      name: failed.name,
      command: failed.command,
      detail: failed.detail,
      remediation: failed.remediation,
      rerunCommand: failed.rerunCommand ?? failed.command,
    };
  }

  const warned = checks.find((check) => check.status === "WARN");
  if (!warned) {
    return null;
  }
  return {
    name: warned.name,
    command: warned.command,
    detail: warned.detail,
    remediation: warned.remediation,
    rerunCommand: warned.rerunCommand ?? warned.command,
  };
}

function ensureParentDir(pathname: string): void {
  mkdirSync(dirname(pathname), { recursive: true });
}

export function toMarkdown(report: MissionReport): string {
  const lines: string[] = [];
  lines.push("# Full-Stack Mission Validation Report");
  lines.push("");
  lines.push(`- Run ID: \`${report.runId}\``);
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Ended: ${report.endedAt}`);
  lines.push(`- Duration: ${report.durationMs} ms`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total checks: ${report.summary.total}`);
  lines.push(`- PASS: ${report.summary.pass}`);
  lines.push(`- WARN: ${report.summary.warn}`);
  lines.push(`- FAIL: ${report.summary.fail}`);
  lines.push(`- SKIP: ${report.summary.skip}`);
  lines.push(`- Mandatory failures: ${report.summary.mandatoryFailures}`);
  lines.push(`- Optional failures: ${report.summary.optionalFailures}`);
  lines.push("");

  if (report.triage) {
    lines.push("## Triage");
    lines.push("");
    lines.push(`- First failing/warning check: **${report.triage.name}**`);
    if (report.triage.command) lines.push(`- Command: \`${report.triage.command}\``);
    if (report.triage.detail) lines.push(`- Detail: ${report.triage.detail}`);
    if (report.triage.remediation) lines.push(`- Remediation: ${report.triage.remediation}`);
    if (report.triage.rerunCommand) lines.push(`- Re-run: \`${report.triage.rerunCommand}\``);
    lines.push("");
  }

  lines.push("## Checks");
  lines.push("");
  lines.push("| Phase | Check | Mandatory | Status | Duration (ms) |");
  lines.push("|---|---|---:|---:|---:|");
  for (const check of report.checks) {
    lines.push(
      `| ${check.phase} | ${check.name} | ${check.mandatory ? "yes" : "no"} | ${check.status} | ${
        check.durationMs ?? ""
      } |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReportArtifacts(basePathNoExt: string, report: MissionReport): {
  jsonPath: string;
  markdownPath: string;
} {
  const jsonPath = `${basePathNoExt}-report.json`;
  const markdownPath = `${basePathNoExt}-summary.md`;
  ensureParentDir(jsonPath);

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, `${toMarkdown(report)}\n`, "utf8");
  return { jsonPath, markdownPath };
}

function parseArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return typeof value === "string" ? value : null;
}

function runCli(): void {
  if (process.argv[1] && !process.argv[1].endsWith("full-stack-report.ts")) {
    return;
  }

  const input = parseArg("--from");
  if (!input) {
    console.error("Usage: npm run report:fullstack -- --from <path-to-report.json>");
    process.exit(1);
  }

  const sourcePath = resolve(input);
  const report = JSON.parse(readFileSync(sourcePath, "utf8")) as MissionReport;
  const base = sourcePath.endsWith(".json") ? sourcePath.slice(0, -5) : sourcePath;
  const markdownPath = `${base}.md`;
  writeFileSync(markdownPath, `${toMarkdown(report)}\n`, "utf8");
  console.log(`[full-stack-report] wrote ${markdownPath}`);
}

runCli();
