import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const debtMarkers = /\b(TODO|FIXME|HACK|XXX)\b/;
const sourceExtensions = new Set([
  ".c", ".cc", ".cpp", ".h", ".hpp", ".js", ".jsx", ".py", ".rs", ".sh", ".ts", ".tsx",
]);

function run(command: string, args: string[], cwd = root): { ok: boolean; output: string } {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }
}

function changedFiles(): string[] {
  const result = run("git", ["status", "--porcelain=v1", "-uall"]);
  return result.output
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => {
      const separator = " -> ";
      const index = file.indexOf(separator);
      return index >= 0 ? file.slice(index + separator.length) : file;
    });
}

function addedDebtMarkers(): string[] {
  const diff = run("git", ["diff", "HEAD", "--unified=0", "--no-color"]).output;
  let currentFile = "";
  const findings: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) currentFile = line.slice(6);
    if (!line.startsWith("+") || line.startsWith("+++") || currentFile === "tools/development/tech-debt-check.ts") continue;
    if (sourceExtensions.has(path.extname(currentFile).toLowerCase()) && debtMarkers.test(line)) {
      findings.push(`${currentFile}: ${line.slice(1).trim()}`);
    }
  }

  for (const file of changedFiles()) {
    const absolute = path.join(root, file);
    if (file === "tools/development/tech-debt-check.ts") continue;
    if (file.startsWith(".") || !sourceExtensions.has(path.extname(file).toLowerCase()) || !existsSync(absolute)) continue;
    if (!run("git", ["status", "--porcelain=v1", "--", file]).output.startsWith("??")) continue;
    readFileSync(absolute, "utf8").split("\n").forEach((line, index) => {
      if (debtMarkers.test(line)) findings.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  return findings;
}

const failures: string[] = [];
if (!run("git", ["diff", "HEAD", "--check"]).ok) failures.push("git diff --check failed");

const orchestrator = path.join(root, "gauss-orchestrator", "Cargo.toml");
if (existsSync(orchestrator)) {
  const format = run("cargo", ["fmt", "--all", "--", "--check"], path.dirname(orchestrator));
  if (!format.ok) failures.push("Rust formatting drift detected; run cargo fmt --all in gauss-orchestrator");
}

const markers = addedDebtMarkers();
if (markers.length > 0) failures.push(`new debt marker(s): ${markers.join(" | ")}`);

const disposable = changedFiles().filter(
  (file) => file.startsWith(".playwright-cli/") || file.startsWith(".playwright-mcp/"),
);
if (disposable.length > 0) failures.push(`disposable captures remain: ${disposable.join(", ")}`);

console.log("Gauss technical-debt gate");
console.log("Policy: zero new debt; pre-existing low-priority debt must remain owned, evidenced, and bounded.");
if (failures.length === 0) {
  console.log("PASS: no new debt markers, formatting drift, whitespace errors, or disposable captures detected");
  process.exit(0);
}
failures.forEach((failure) => console.error(`FAIL: ${failure}`));
process.exit(1);
