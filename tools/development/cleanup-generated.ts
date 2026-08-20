import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const allowedRoots = [".playwright-cli", ".playwright-mcp"];
const apply = process.argv.includes("--apply");

function gitUntracked(rootPath: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "--", rootPath],
      { cwd: root, encoding: "utf8", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } },
    );
    return output
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .filter((file) => allowedRoots.some((allowedRoot) => file === allowedRoot || file.startsWith(`${allowedRoot}/`)));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown Git error";
    throw new Error(`Unable to identify untracked cleanup candidates: ${detail}`);
  }
}

function safeTarget(file: string): string {
  const absolute = path.resolve(root, file);
  const insideAllowedRoot = allowedRoots.some((allowedRoot) => {
    const allowedPath = path.resolve(root, allowedRoot);
    return absolute === allowedPath || absolute.startsWith(`${allowedPath}${path.sep}`);
  });
  if (!insideAllowedRoot) throw new Error(`Refusing cleanup outside allow-list: ${file}`);
  return absolute;
}

const candidates = [...new Set(allowedRoots.flatMap(gitUntracked))].sort();

console.log("Gauss generated-artifact cleanup");
console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
console.log("Allow-list: .playwright-cli/ and .playwright-mcp/ untracked captures only");

if (candidates.length === 0) {
  console.log("No disposable untracked captures detected.");
  process.exit(0);
}

for (const file of candidates) {
  const absolute = safeTarget(file);
  if (apply) {
    if (existsSync(absolute)) rmSync(absolute, { recursive: lstatSync(absolute).isDirectory(), force: true });
    console.log(`Removed ${file}`);
  } else {
    console.log(`Candidate ${file}`);
  }
}

if (!apply) console.log("Dry run only; rerun with --apply after reviewing the bounded candidate list.");
