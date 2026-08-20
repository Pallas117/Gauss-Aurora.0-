import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_DATA = path.join(ROOT, "ml/data/agent-manager-v1/test.jsonl");
const REQUIRED_KEYS = [
  "mode",
  "owner",
  "actions",
  "evidence_needed",
  "approval_required",
  "risks",
  "truth_state",
] as const;
const MODES = new Set(["observe", "diagnose", "plan", "authorize", "execute", "verify"]);
const TRUTH_STATES = new Set(["observed", "inferred", "unknown", "blocked", "verified"]);
const OWNERS = new Set([
  "memory-observer",
  "memory-benchmarker",
  "memory-planner",
  "memory-verifier",
  "memory-systems",
  "mesh-network",
  "mission-control",
  "platform-integration",
  "satellite-operations",
  "sovereign-ui",
  "verification-keeper",
]);

type ContractResult = { ok: true } | { ok: false; errors: string[] };

function validate(value: unknown): ContractResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["response must be a JSON object"] };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const required = [...REQUIRED_KEYS].sort();
  const errors: string[] = [];
  if (JSON.stringify(keys) !== JSON.stringify(required)) {
    errors.push(`keys must be exactly ${required.join(", ")}`);
  }
  if (typeof record.mode !== "string" || !MODES.has(record.mode)) errors.push("mode is not a registered stage");
  if (typeof record.owner !== "string" || !OWNERS.has(record.owner)) errors.push("owner is not a registered Gauss role");
  for (const field of ["actions", "evidence_needed", "risks"] as const) {
    const list = record[field];
    if (!Array.isArray(list) || list.length === 0 || list.some((item) => typeof item !== "string" || item.trim() === "")) {
      errors.push(`${field} must be a non-empty string array`);
    }
  }
  if (typeof record.approval_required !== "boolean") errors.push("approval_required must be boolean");
  if (typeof record.truth_state !== "string" || !TRUTH_STATES.has(record.truth_state)) {
    errors.push("truth_state is not a registered state");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function parseLines(content: string): unknown[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`line ${index + 1} is not JSON: ${String(error)}`);
      }
    });
}

function main(): number {
  const responsePathIndex = process.argv.indexOf("--responses");
  const responsePath = responsePathIndex >= 0 ? process.argv[responsePathIndex + 1] : undefined;
  const sourcePath = process.argv.includes("--data")
    ? process.argv[process.argv.indexOf("--data") + 1]
    : DEFAULT_DATA;
  const content = responsePath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(responsePath ?? sourcePath, "utf8");
  const records = parseLines(content);
  const failures: Array<{ index: number; errors: string[] }> = [];

  records.forEach((record, index) => {
    let response = record;
    if (responsePath === undefined) {
      const messages = (record as { messages?: Array<{ role?: string; content?: string }> }).messages;
      const assistant = messages?.find((message) => message.role === "assistant");
      if (!assistant?.content) {
        failures.push({ index: index + 1, errors: ["dataset record has no assistant message"] });
        return;
      }
      try {
        response = JSON.parse(assistant.content) as unknown;
      } catch (error) {
        failures.push({ index: index + 1, errors: [`assistant content is not JSON: ${String(error)}`] });
        return;
      }
    }
    const result = validate(response);
    if (!result.ok) failures.push({ index: index + 1, errors: result.errors });
  });

  const report = {
    schema: "gauss-agent-manager-contract-v1",
    status: failures.length === 0 ? "passed" : "failed",
    records: records.length,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  return failures.length === 0 ? 0 : 1;
}

process.exitCode = main();
