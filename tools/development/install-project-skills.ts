import { existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(root, "skills");

function parseFlag(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);

  if (index < 0) {
    return undefined;
  }

  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function destinationRoot(): string {
  const explicitTarget = parseFlag("target");
  if (explicitTarget) {
    return path.resolve(explicitTarget);
  }

  return path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "skills");
}

function skillDirectories(): string[] {
  if (!existsSync(sourceRoot)) {
    return [];
  }

  return readdirSync(sourceRoot)
    .filter((entry) => existsSync(path.join(sourceRoot, entry, "SKILL.md")))
    .sort((a, b) => a.localeCompare(b));
}

function symlinkTarget(destination: string): string | undefined {
  if (!existsSync(destination) || !lstatSync(destination).isSymbolicLink()) {
    return undefined;
  }

  return path.resolve(path.dirname(destination), readlinkSync(destination));
}

function main(): void {
  const destination = destinationRoot();
  mkdirSync(destination, { recursive: true });

  const skills = skillDirectories();
  if (skills.length === 0) {
    console.log("No project skills found.");
    return;
  }

  for (const skill of skills) {
    const sourcePath = path.join(sourceRoot, skill);
    const destinationPath = path.join(destination, skill);
    const existingTarget = symlinkTarget(destinationPath);

    if (existingTarget === sourcePath) {
      console.log(`skip ${skill}: already linked`);
      continue;
    }

    if (existsSync(destinationPath)) {
      console.error(`refuse ${skill}: ${destinationPath} already exists`);
      process.exitCode = 1;
      continue;
    }

    symlinkSync(sourcePath, destinationPath, "dir");
    console.log(`linked ${skill}: ${destinationPath}`);
  }
}

main();
