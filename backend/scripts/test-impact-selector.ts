import { execSync } from "node:child_process";

interface ImpactSelection {
  changedFiles: string[];
  commands: string[];
  rationale: string[];
}

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function changedFiles(): string[] {
  const base = process.env.IMPACT_BASE_REF?.trim() || "origin/main";
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const files = out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // Fallback to working tree changes if base branch is unavailable.
  }

  const out = execSync("git status --short", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

function selectCommands(files: string[]): ImpactSelection {
  const commands = new Set<string>();
  const rationale: string[] = [];

  commands.add("npm run lint");

  if (files.some((f) => f.startsWith("backend/") || f.startsWith("tests/backend") || f.endsWith(".py"))) {
    commands.add("npm test");
    commands.add("npm run test:backend:granular");
    rationale.push("backend or backend-adjacent files changed");
  }

  if (files.some((f) => f.startsWith("src/") || f.startsWith("tests/e2e/") || f.startsWith("tests/unit/"))) {
    commands.add("npm run test:unit:ui");
    rationale.push("frontend or ui tests changed");
  }

  if (files.some((f) => f.startsWith("tests/e2e/"))) {
    commands.add("npm run test:unit:ui");
    rationale.push("e2e suite changed");
  }

  if (files.some((f) => f.startsWith("ml/rag/") || f.startsWith("research/documentation-rag/"))) {
    commands.add("pytest ml/rag/test_trust_manifest.py ml/rag/test_rag_checksum_directive.py -q");
    rationale.push("rag/trust assets changed");
  }

  if (files.some((f) => f.startsWith("tools/mcp-model-ops/") || f.startsWith("backend/scripts/document-trust-pipeline"))) {
    commands.add("npm run audit:documents:trust:strict");
    commands.add("npm run index:system");
    rationale.push("mcp policy or trust pipeline changed");
  }

  if (rationale.length === 0) {
    rationale.push("no high-risk path detected; lint only");
  }

  return {
    changedFiles: files,
    commands: Array.from(commands),
    rationale,
  };
}

function main(): void {
  const files = changedFiles();
  const selection = selectCommands(files);

  if (argFlag("--json")) {
    console.log(JSON.stringify(selection, null, 2));
    return;
  }

  console.log("Impacted Test Selector");
  console.log("======================");
  console.log(`Changed files: ${selection.changedFiles.length}`);
  for (const reason of selection.rationale) {
    console.log(`- ${reason}`);
  }
  console.log("");
  console.log("Recommended commands:");
  for (const cmd of selection.commands) {
    console.log(`- ${cmd}`);
  }

  if (argFlag("--run")) {
    for (const cmd of selection.commands) {
      console.log(`\n$ ${cmd}`);
      execSync(cmd, { stdio: "inherit" });
    }
  }
}

main();

