/**
 * Scaffold a new backend feature module.
 * Usage: npm run scaffold:backend-feature -- --name my-feature --type route|worker|adapter|script
 *
 * Creates boilerplate files in the appropriate directory, following Gauss conventions:
 * - route  → backend/routes/{name}.ts + backend/routes/{name}.test.ts
 * - worker → backend/worker/{name}.ts + backend/worker/{name}.test.ts
 * - adapter → backend/adapters/{name}.ts
 * - script → backend/scripts/{name}.ts
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const argv = process.argv.slice(2);

function arg(flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  const v = argv[idx + 1];
  return typeof v === "string" && !v.startsWith("--") ? v : null;
}

const name = arg("--name");
const type = arg("--type") ?? "route";

if (!name) {
  console.error("Usage: npm run scaffold:backend-feature -- --name <name> --type route|worker|adapter|script");
  process.exit(1);
}

const TEMPLATES: Record<string, Array<{ path: string; content: string }>> = {
  route: [
    {
      path: `backend/routes/${name}.ts`,
      content: `import type { Express } from "express";\n\nexport function mount${toPascal(name)}Routes(app: Express): void {\n  app.get("/api/${name}/status", (_req, res) => {\n    res.json({ ok: true, service: "${name}" });\n  });\n}\n`,
    },
    {
      path: `backend/routes/${name}.test.ts`,
      content: `import test from "node:test";\nimport assert from "node:assert/strict";\n\ntest("${name} route smoke", () => {\n  assert.ok(true, "Replace with real assertions");\n});\n`,
    },
  ],
  worker: [
    {
      path: `backend/worker/${name}.ts`,
      content: `export class ${toPascal(name)}Worker {\n  async tick(): Promise<void> {\n    // TODO: implement\n  }\n}\n`,
    },
    {
      path: `backend/worker/${name}.test.ts`,
      content: `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { ${toPascal(name)}Worker } from "./${name}.js";\n\ntest("${name} worker smoke", async () => {\n  const w = new ${toPascal(name)}Worker();\n  await w.tick();\n  assert.ok(true);\n});\n`,
    },
  ],
  adapter: [
    {
      path: `backend/adapters/${name}.ts`,
      content: `export async function fetch${toPascal(name)}Data(): Promise<unknown> {\n  // TODO: implement adapter\n  return null;\n}\n`,
    },
  ],
  script: [
    {
      path: `backend/scripts/${name}.ts`,
      content: `/**\n * ${name} — TODO: describe purpose.\n */\n\nasync function main(): Promise<void> {\n  console.log("${name}");\n}\n\nvoid main().catch((err) => { console.error(err); process.exit(1); });\n`,
    },
  ],
};

function toPascal(str: string): string {
  return str.replace(/([-_][a-z])/g, (m) => m[1]!.toUpperCase()).replace(/^./, (m) => m.toUpperCase());
}

const files = TEMPLATES[type];
if (!files) {
  console.error(`Unknown type: ${type}. Use: route | worker | adapter | script`);
  process.exit(1);
}

for (const { path, content } of files) {
  const full = join(cwd, path);
  if (existsSync(full)) {
    console.warn(`[SKIP] ${path} already exists`);
    continue;
  }
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  console.log(`[CREATED] ${path}`);
}
