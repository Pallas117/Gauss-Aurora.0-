import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

type ParsedArgs = {
  name: string | null;
};

function parseArgs(argv: string[]): ParsedArgs {
  let name: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--name" || token === "-n") {
      name = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return { name };
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function toPascalCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function templates(featureKebab: string) {
  const featurePascal = toPascalCase(featureKebab);

  const types = `export interface ${featurePascal}Input {
  timestamp: string;
}

export interface ${featurePascal}Output {
  ok: boolean;
  source: "${featureKebab}";
  generatedAt: string;
}
`;

  const service = `import type { ${featurePascal}Input, ${featurePascal}Output } from "./${featureKebab}.types.js";

export function run${featurePascal}(input: ${featurePascal}Input): ${featurePascal}Output {
  return {
    ok: true,
    source: "${featureKebab}",
    generatedAt: input.timestamp,
  };
}
`;

  const test = `import test from "node:test";
import assert from "node:assert/strict";
import { run${featurePascal} } from "./${featureKebab}.service.js";

test("run${featurePascal} returns typed scaffold output", () => {
  const result = run${featurePascal}({ timestamp: "2026-01-01T00:00:00.000Z" });
  assert.equal(result.ok, true);
  assert.equal(result.source, "${featureKebab}");
  assert.equal(result.generatedAt, "2026-01-01T00:00:00.000Z");
});
`;

  const barrel = `export * from "./${featureKebab}.types.js";
export * from "./${featureKebab}.service.js";
`;

  return { types, service, test, barrel };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    console.error("Usage: npm run scaffold:backend-feature -- --name <feature-name>");
    process.exitCode = 1;
    return;
  }

  const featureKebab = toKebabCase(args.name);
  if (!featureKebab) {
    console.error("Feature name produced an empty slug. Use alphanumeric text.");
    process.exitCode = 1;
    return;
  }

  const featureDir = path.resolve("backend", "features", featureKebab);
  if (await exists(featureDir)) {
    console.error(`Feature scaffold already exists: ${featureDir}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(featureDir, { recursive: true });
  const { types, service, test, barrel } = templates(featureKebab);

  await writeFile(path.join(featureDir, `${featureKebab}.types.ts`), types, "utf8");
  await writeFile(path.join(featureDir, `${featureKebab}.service.ts`), service, "utf8");
  await writeFile(path.join(featureDir, `${featureKebab}.service.test.ts`), test, "utf8");
  await writeFile(path.join(featureDir, "index.ts"), barrel, "utf8");

  console.log(`Created backend scaffold at ${featureDir}`);
  console.log(`Next: wire backend/features/${featureKebab}/index.ts into your ingest loop or route.`);
}

main().catch((error: unknown) => {
  console.error("Failed to create backend feature scaffold.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
