import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Policy = {
  schema_version: string;
  mode: string;
  runtime_apply: boolean;
  spacecraft_apply: boolean;
  approval_required: boolean;
  signature_required_for_apply: boolean;
  max_patch_bytes: number;
  max_changed_files: number;
  max_changed_lines: number;
  allowed_path_prefixes: string[];
  forbidden_path_prefixes: string[];
  required_validation_commands: string[];
  full_validation_commands: string[];
};

type Result = {
  schema_version: "gauss-self-modification-result-v1";
  status: "candidate_validated" | "rejected";
  apply_ready: false;
  patch_sha256: string;
  changed_files: string[];
  changed_lines: number;
  findings: string[];
  policy: Pick<Policy, "mode" | "approval_required" | "signature_required_for_apply">;
};

const root = process.cwd();
const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const patchPath = path.resolve(root, arg("--patch", "/proposal/proposal.patch"));
const policyPath = path.resolve(root, arg("--policy", "config/self-modification-policy.json"));
const outputPath = path.resolve(root, arg("--out", "/output/validation.json"));

const fail = (message: string): never => {
  throw new Error(message);
};

const normalisePatchPath = (value: string): string => {
  const withoutPrefix = value.replace(/^[ab]\//, "");
  if (!withoutPrefix || path.posix.isAbsolute(withoutPrefix) || withoutPrefix.includes("\0")) {
    fail(`invalid patch path: ${value}`);
  }
  const normalised = path.posix.normalize(withoutPrefix);
  if (normalised === "." || normalised.startsWith("../") || normalised.includes("/../")) {
    fail(`path traversal is not allowed: ${value}`);
  }
  return normalised;
};

const matchesPrefix = (candidate: string, prefixes: string[]): boolean =>
  prefixes.some((prefix) => candidate === prefix || candidate.startsWith(prefix));

const main = async (): Promise<void> => {
  const policy = JSON.parse(await readFile(policyPath, "utf8")) as Policy;
  const patch = await readFile(patchPath);
  const patchText = patch.toString("utf8");
  const findings: string[] = [];
  const files = new Set<string>();
  let changedLines = 0;

  if (policy.schema_version !== "gauss-self-modification-policy-v1") findings.push("unsupported policy schema");
  if (policy.mode !== "proposal_only") findings.push("policy must remain proposal_only");
  if (policy.runtime_apply || policy.spacecraft_apply) findings.push("runtime and spacecraft apply must be disabled");
  if (!policy.approval_required || !policy.signature_required_for_apply) findings.push("approval and apply signature gates are required");
  if (patch.length === 0) findings.push("proposal patch is empty");
  if (patch.length > policy.max_patch_bytes) findings.push(`patch exceeds ${policy.max_patch_bytes} bytes`);
  if (patchText.includes("Binary files ")) findings.push("binary patches are not allowed");

  const recordPath = (rawPath: string): void => {
    if (rawPath === "/dev/null") return;
    try {
      const file = normalisePatchPath(rawPath);
      files.add(file);
      if (!matchesPrefix(file, policy.allowed_path_prefixes)) findings.push(`path is outside the allow-list: ${file}`);
      if (matchesPrefix(file, policy.forbidden_path_prefixes)) findings.push(`path is forbidden: ${file}`);
    } catch (error) {
      findings.push(error instanceof Error ? error.message : String(error));
    }
  };

  for (const line of patchText.split(/\r?\n/)) {
    const fileMatch = line.match(/^(?:---|\+\+\+) (.+)$/);
    if (fileMatch) {
      try {
        const rawPath = fileMatch[1].split("\t", 1)[0];
        recordPath(rawPath);
      } catch (error) {
        findings.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (line.startsWith("+ ") || (line.startsWith("+") && !line.startsWith("+++"))) changedLines += 1;
    if (line.startsWith("- ") || (line.startsWith("-") && !line.startsWith("---"))) changedLines += 1;
  }

  if (files.size > policy.max_changed_files) findings.push(`proposal changes ${files.size} files; limit is ${policy.max_changed_files}`);
  if (changedLines > policy.max_changed_lines) findings.push(`proposal changes ${changedLines} lines; limit is ${policy.max_changed_lines}`);

  const result: Result = {
    schema_version: "gauss-self-modification-result-v1",
    status: findings.length === 0 ? "candidate_validated" : "rejected",
    apply_ready: false,
    patch_sha256: createHash("sha256").update(patch).digest("hex"),
    changed_files: [...files].sort(),
    changed_lines: changedLines,
    findings,
    policy: {
      mode: policy.mode,
      approval_required: policy.approval_required,
      signature_required_for_apply: policy.signature_required_for_apply,
    },
  };

  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (findings.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(`[self-modification] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
