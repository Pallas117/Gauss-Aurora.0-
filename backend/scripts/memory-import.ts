import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const SUPPORTED = new Set([".md", ".markdown", ".html", ".htm", ".pdf", ".json", ".jsonl", ".csv", ".tsv", ".pptx"]);

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  return value && !value.startsWith("--") ? value : null;
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function main(): void {
  const sourceArg = arg("--source");
  if (!sourceArg) throw new Error("Usage: npm run memory:import -- --source /path/to/file");
  const source = path.resolve(sourceArg);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Source file not found: ${source}`);
  const extension = path.extname(source).toLowerCase();
  if (!SUPPORTED.has(extension)) throw new Error(`Unsupported memory import extension: ${extension}`);
  const stats = statSync(source);
  if (stats.size > MAX_IMPORT_BYTES) throw new Error(`Source exceeds ${MAX_IMPORT_BYTES} byte import limit`);

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const inbox = path.join(repoRoot, "research", "memory-inbox");
  mkdirSync(inbox, { recursive: true });
  const safeName = path.basename(source).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const destination = path.join(inbox, safeName);
  copyFileSync(source, destination);

  const manifestPath = path.join(inbox, ".gauss-memory-imports.json");
  const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) as { imports?: unknown[] } : {};
  const imports = Array.isArray(existing.imports) ? existing.imports : [];
  imports.push({
    sourcePath: source,
    destinationPath: path.relative(repoRoot, destination).split(path.sep).join("/"),
    sourceSha256: sha256(source),
    importedAt: new Date().toISOString(),
    status: "needs_review",
  });
  writeFileSync(manifestPath, `${JSON.stringify({ imports: imports.slice(-64) }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, source, destination, sourceSha256: sha256(source), status: "needs_review" }, null, 2));
}

main();
