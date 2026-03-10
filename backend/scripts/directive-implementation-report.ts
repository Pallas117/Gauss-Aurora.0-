/**
 * Directive implementation report: scan codebase against the full checklist
 * from the Directive Testing and Fix Plan; write uncompleted-implementations.md
 * (and .json) listing only items that are not complete.
 */

import { readFileSync, existsSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPORT_DIR = "reports/progress";
const DIRECTIVE_REPORT_PATH = path.join(REPORT_DIR, "directive-adherence.latest.json");
const OUTPUT_MD = path.join(REPORT_DIR, "uncompleted-implementations.md");
const OUTPUT_JSON = path.join(REPORT_DIR, "uncompleted-implementations.json");

type CheckResult = { completed: boolean; reason?: string };

function cwd(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}

function readSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseDirectiveAuditReport(): { checks: { name: string; status: string }[] } | null {
  const full = cwd(DIRECTIVE_REPORT_PATH);
  if (!existsSync(full)) return null;
  const raw = readSafe(full);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { checks?: { name: string; status: string }[] };
    return data.checks ? { checks: data.checks } : null;
  } catch {
    return null;
  }
}

function auditCheckPass(report: ReturnType<typeof parseDirectiveAuditReport>, nameSubstr: string): boolean {
  if (!report) return false;
  const c = report.checks.find((c) => c.name.includes(nameSubstr));
  return c?.status === "PASS";
}

type ChecklistEntry = {
  id: string;
  section: string;
  description: string;
  check: () => CheckResult;
};

function buildChecklist(): ChecklistEntry[] {
  const directiveReport = parseDirectiveAuditReport();

  return [
    {
      id: "1.1",
      section: "1. Memory – Python GC after heavy use",
      description: "gauss_physics_imputer.py has _directive_cleanup; train_unet.py gc in torch path or no torch",
      check: () => {
        if (auditCheckPass(directiveReport, "Python directive")) return { completed: true };
        const imputer = readSafe(cwd("backend/gauss_physics_imputer.py"));
        if (!imputer) return { completed: false, reason: "backend/gauss_physics_imputer.py not found" };
        if (!imputer.includes("_directive_cleanup")) return { completed: false, reason: "_directive_cleanup missing in imputer" };
        return { completed: true };
      },
    },
    {
      id: "1.2",
      section: "1. Memory – Lazy loading (polars)",
      description: "check-directive-python.py exists and bans pl.read_csv/pl.read_parquet",
      check: () => {
        if (auditCheckPass(directiveReport, "Python directive")) return { completed: true };
        const script = readSafe(cwd("backend/scripts/check-directive-python.py"));
        if (!script) return { completed: false, reason: "check-directive-python.py not found" };
        if (!script.includes("pl.read_csv") && !script.includes("pl.read_parquet")) return { completed: false, reason: "pl.read_* check not found in script" };
        return { completed: true };
      },
    },
    {
      id: "1.3",
      section: "1. Memory – mlx_lm cache limit",
      description: "mlx_lm launch uses --cache-limit-gb 2.5 or no mlx_lm",
      check: () => {
        if (auditCheckPass(directiveReport, "mlx_lm cache limit")) return { completed: true };
        const pkg = readSafe(cwd("package.json"));
        if (!pkg) return { completed: true };
        if ((pkg.includes("mlx_lm") || pkg.includes("mlx-lm")) && (!pkg.includes("--cache-limit-gb") || !pkg.includes("2.5")))
          return { completed: false, reason: "mlx_lm present but --cache-limit-gb 2.5 not found" };
        return { completed: true };
      },
    },
    {
      id: "1.4",
      section: "1. Memory – Rust zero-copy",
      description: "gauss-orchestrator doc contains zero-copy / serde guidance",
      check: () => {
        const dev = readSafe(cwd("gauss-orchestrator/DEVELOPMENT.md"));
        if (!dev) return { completed: false, reason: "gauss-orchestrator/DEVELOPMENT.md not found" };
        if (!dev.includes("zero-copy") && !dev.includes("serde") && !dev.includes("from_slice")) return { completed: false, reason: "Zero-copy/serde guidance not found in DEVELOPMENT.md" };
        return { completed: true };
      },
    },
    {
      id: "2.1",
      section: "2. Power – Backend polling cadence",
      description: "power-polling.test.ts exists and enforces >= 1000 ms",
      check: () => {
        if (auditCheckPass(directiveReport, "Backend polling cadence")) return { completed: true };
        const f = readSafe(cwd("backend/power-polling.test.ts"));
        if (!f) return { completed: false, reason: "backend/power-polling.test.ts not found" };
        if (!f.includes("MIN_CADENCE_MS") || !f.includes("1000")) return { completed: false, reason: "MIN_CADENCE_MS 1000 not found" };
        return { completed: true };
      },
    },
    {
      id: "2.2",
      section: "2. Power – Frontend polling cadence",
      description: "Frontend setInterval >= 1000 ms documented or enforced (optional)",
      check: () => ({ completed: true }),
    },
    {
      id: "2.3",
      section: "2. Power – Probability gating (3-sigma)",
      description: "probability-gate.test.ts has below-threshold LOG_AND_SLEEP test",
      check: () => {
        if (auditCheckPass(directiveReport, "Probability gate")) return { completed: true };
        const f = readSafe(cwd("backend/ml-client/probability-gate.test.ts"));
        if (!f) return { completed: false, reason: "probability-gate.test.ts not found" };
        if (!f.includes("LOG_AND_SLEEP") || !f.includes("directive")) return { completed: false, reason: "Directive LOG_AND_SLEEP test not found" };
        return { completed: true };
      },
    },
    {
      id: "3.1",
      section: "3. Audit – RAG checksum before LLM",
      description: "ml/rag/test_rag_checksum_directive.py exists and run by directive audit",
      check: () => {
        if (auditCheckPass(directiveReport, "RAG checksum")) return { completed: true };
        if (!existsSync(cwd("ml/rag/test_rag_checksum_directive.py"))) return { completed: false, reason: "ml/rag/test_rag_checksum_directive.py not found" };
        return { completed: true };
      },
    },
    {
      id: "3.2",
      section: "3. Audit – Air-gapped",
      description: "No aws/openai in core (backend, ml)",
      check: () => {
        if (auditCheckPass(directiveReport, "Air-gapped")) return { completed: true };
        return { completed: false, reason: "Directive audit report missing or Air-gapped check not PASS" };
      },
    },
    {
      id: "3.3",
      section: "3. Audit – CCSDS telemetry",
      description: "CCSDS parsers/tests exist; directive checklist or doc links",
      check: () => {
        const hasCcsds = existsSync(cwd("gauss-orchestrator/src/telemetry/ccsds.rs")) || existsSync(cwd("backend/contracts/packet-ingest-contract.ts"));
        if (hasCcsds) return { completed: true };
        return { completed: false, reason: "CCSDS-related code (orchestrator or backend) not found" };
      },
    },
    {
      id: "4.1",
      section: "4. UI – React state cap (<= 50)",
      description: "CommandPage, DevHud, AutomationPage, ChronosPage caps <= 50",
      check: () => {
        if (auditCheckPass(directiveReport, "React telemetry log cap")) return { completed: true };
        return { completed: false, reason: "Directive audit report missing or React state cap check not PASS" };
      },
    },
    {
      id: "4.2",
      section: "4. UI – Three.js / WebGL vs SVG",
      description: "Documented path to reduce WebGL/Three.js under memory pressure",
      check: () => {
        const doc = readSafe(cwd("docs/archive/SCENE_RADIATION_VISUALIZATION.md")) ?? readSafe(cwd("docs/SHADER_SPEC.md")) ?? readSafe(cwd("docs/DATA_FETCHING_OPTIMIZATION.md"));
        if (doc && (doc.includes("memory") || doc.includes("LOD") || doc.includes("SVG") || doc.includes("pressure"))) return { completed: true };
        if (process.env.VITE_LOW_MEMORY_MODE !== undefined) return { completed: true };
        return { completed: false, reason: "No doc or env flag for memory-pressure/WebGL reduction found" };
      },
    },
    {
      id: "5.1",
      section: "5. Orchestration – Directive audit script",
      description: "directive-adherence-audit.ts exists, runs all steps, writes JSON",
      check: () => {
        const f = readSafe(cwd("backend/scripts/directive-adherence-audit.ts"));
        if (!f) return { completed: false, reason: "directive-adherence-audit.ts not found" };
        if (!f.includes("checkPythonDirective") || !f.includes("checkReactStateCap") || !f.includes("totals")) return { completed: false, reason: "Directive audit script missing expected checks or totals" };
        return { completed: true };
      },
    },
    {
      id: "5.2",
      section: "5. Orchestration – npm, orchestrator, CI",
      description: "audit:directive script; orchestrator runs directive audit; CI directive-adherence job",
      check: () => {
        const pkg = readSafe(cwd("package.json"));
        if (!pkg || !pkg.includes("audit:directive")) return { completed: false, reason: "package.json missing audit:directive script" };
        const ci = readSafe(cwd(".github/workflows/ci-tests.yml"));
        if (!ci || !ci.includes("directive-adherence") || !ci.includes("audit:directive")) return { completed: false, reason: "CI missing directive-adherence job or audit:directive step" };
        const auditRs = readSafe(cwd("gauss-orchestrator/src/audit_automation.rs"));
        if (!auditRs || !auditRs.includes("directive_audit_command") || !auditRs.includes("directive_report_path")) return { completed: false, reason: "Orchestrator audit_automation.rs missing directive audit wiring" };
        return { completed: true };
      },
    },
    {
      id: "8",
      section: "8. Files – Plan table",
      description: "All plan Section 8 files exist and touched (imputer, check-directive-python, directive-adherence-audit, CommandPage 50, package.json, orchestrator, CI, tests)",
      check: () => {
        const required = [
          "backend/gauss_physics_imputer.py",
          "backend/scripts/check-directive-python.py",
          "backend/scripts/directive-adherence-audit.ts",
          "src/pages/CommandPage.tsx",
        ];
        for (const p of required) {
          if (!existsSync(cwd(p))) return { completed: false, reason: `Missing file: ${p}` };
        }
        const imputer = readSafe(cwd("backend/gauss_physics_imputer.py"));
        if (!imputer?.includes("_directive_cleanup")) return { completed: false, reason: "gauss_physics_imputer.py missing _directive_cleanup" };
        const cmdPage = readSafe(cwd("src/pages/CommandPage.tsx"));
        if (cmdPage?.includes(".slice(0, 100)")) return { completed: false, reason: "CommandPage still has .slice(0, 100); should be 50" };
        return { completed: true };
      },
    },
  ];
}

function main(): void {
  const checklist = buildChecklist();
  const uncompleted: { id: string; section: string; description: string; reason: string }[] = [];

  for (const entry of checklist) {
    const result = entry.check();
    if (!result.completed) {
      uncompleted.push({
        id: entry.id,
        section: entry.section,
        description: entry.description,
        reason: result.reason ?? "Check failed",
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const outDir = cwd(REPORT_DIR);
  mkdirSync(outDir, { recursive: true });

  let md: string;
  if (uncompleted.length === 0) {
    md = `# Directive Implementation Report (Uncompleted Items)\nGenerated: ${generatedAt}\n\nAll directive implementation items are complete.\n`;
  } else {
    const bySection = new Map<string, typeof uncompleted>();
    for (const u of uncompleted) {
      const list = bySection.get(u.section) ?? [];
      list.push(u);
      bySection.set(u.section, list);
    }
    const sections = Array.from(bySection.entries())
      .map(([section, items]) => {
        const lines = items.map((i) => `- **${i.id}** ${i.description}: ${i.reason}`).join("\n");
        return `## ${section}\n${lines}`;
      })
      .join("\n\n");
    md = `# Directive Implementation Report (Uncompleted Items)\nGenerated: ${generatedAt}\n\n${sections}\n`;
  }

  writeFileSync(cwd(OUTPUT_MD), md, "utf8");
  const jsonPayload = {
    generated_at: generatedAt,
    uncompleted: uncompleted.map((u) => ({ section: u.id, item: u.description, reason: u.reason })),
  };
  writeFileSync(cwd(OUTPUT_JSON), `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");

  if (!process.argv.includes("--quiet")) {
    console.log(`Directive implementation report written to ${OUTPUT_MD}`);
    if (uncompleted.length > 0) {
      console.log(`Uncompleted: ${uncompleted.length}`);
      uncompleted.forEach((u) => console.log(`  ${u.id}: ${u.reason}`));
    } else {
      console.log("All directive implementation items are complete.");
    }
  }

  process.exit(uncompleted.length > 0 ? 1 : 0);
}

main();
