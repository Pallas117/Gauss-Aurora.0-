import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFailureSignatures,
  buildRouteTestLinks,
  buildRuntimeRiskRegister,
  extractRoutesFromFile,
} from "../services/system-index/index.js";

function repoRootFromScript(): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "../..");
}

function walkFiles(root: string, filter: (filePath: string) => boolean): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        stack.push(absolute);
      } else if (entry.isFile() && filter(absolute)) {
        out.push(absolute);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function extractContracts(repoRoot: string): Record<string, string[]> {
  const contractsDir = path.join(repoRoot, "backend", "contracts");
  if (!statSafe(contractsDir)?.isDirectory()) return {};
  const files = walkFiles(contractsDir, (fp) => fp.endsWith(".ts"));
  const out: Record<string, string[]> = {};
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const keys = Array.from(src.matchAll(/name:\s*["'`]([^"'`]+)["'`]/g)).map((m) => m[1]).filter(Boolean);
    out[rel] = keys;
  }
  return out;
}

function statSafe(target: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(target);
  } catch {
    return null;
  }
}

function main(): void {
  const repoRoot = repoRootFromScript();
  const routeFiles = walkFiles(path.join(repoRoot, "backend", "routes"), (fp) => fp.endsWith(".ts"));
  const testFiles = walkFiles(path.join(repoRoot, "tests"), (fp) => fp.endsWith(".ts") || fp.endsWith(".tsx") || fp.endsWith(".py"));
  const routes = routeFiles.flatMap((file) => extractRoutesFromFile(file, repoRoot));
  const routeTestLinks = buildRouteTestLinks(routes, testFiles, repoRoot);
  const failureSignatures = buildFailureSignatures(repoRoot);
  const runtimeRiskRegister = buildRuntimeRiskRegister(repoRoot);
  const contracts = extractContracts(repoRoot);

  const outDir = path.join(repoRoot, "reports", "index");
  writeJson(path.join(outDir, "route-to-test-map.latest.json"), {
    generatedAt: new Date().toISOString(),
    routeCount: routes.length,
    routes,
    links: routeTestLinks,
  });
  writeJson(path.join(outDir, "contract-to-test-map.latest.json"), {
    generatedAt: new Date().toISOString(),
    contracts,
    links: routeTestLinks.filter((entry) => entry.tests.length > 0),
  });
  writeJson(path.join(outDir, "failure-signature-catalog.latest.json"), {
    generatedAt: new Date().toISOString(),
    count: failureSignatures.length,
    signatures: failureSignatures,
  });
  writeJson(path.join(outDir, "runtime-risk-register.latest.json"), {
    generatedAt: new Date().toISOString(),
    count: runtimeRiskRegister.length,
    risks: runtimeRiskRegister,
  });

  console.log(`system-index: routes=${routes.length} tests=${testFiles.length} signatures=${failureSignatures.length} risks=${runtimeRiskRegister.length}`);
}

main();

