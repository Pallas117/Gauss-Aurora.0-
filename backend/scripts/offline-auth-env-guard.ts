import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface GuardReport {
  generatedAt: string;
  envFilePath: string;
  repairedKeys: string[];
  remainingMissingKeys: string[];
  codeChecks: {
    viteInjectsPublicEnv: boolean;
    supabaseUsesSharedRuntimeEnv: boolean;
    authChecksUseSharedRuntimeEnv: boolean;
  };
}

function parseEnvFile(raw: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    values.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  return values;
}

function setKey(raw: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(raw)) {
    return raw.replace(pattern, line);
  }
  return `${raw.trimEnd()}${raw.trim().length > 0 ? os.EOL : ""}${line}${os.EOL}`;
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}${os.EOL}`, "utf8");
}

async function main(): Promise<void> {
  const envFilePath = path.resolve(".env.public.local");
  const envRaw = existsSync(envFilePath) ? readFileSync(envFilePath, "utf8") : "";
  const envValues = parseEnvFile(envRaw);

  const repairs: Array<{ key: string; value: string }> = [];
  const publicSupabaseUrl =
    envValues.get("VITE_SUPABASE_URL") ??
    envValues.get("SUPABASE_URL") ??
    process.env.VITE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";
  if (!envValues.get("VITE_SUPABASE_URL") && publicSupabaseUrl) {
    repairs.push({ key: "VITE_SUPABASE_URL", value: publicSupabaseUrl });
  }

  const publishableKey =
    envValues.get("VITE_SUPABASE_PUBLISHABLE_KEY") ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "";
  if (!envValues.get("VITE_SUPABASE_PUBLISHABLE_KEY") && publishableKey) {
    repairs.push({ key: "VITE_SUPABASE_PUBLISHABLE_KEY", value: publishableKey });
  }

  if (!envValues.get("VITE_HELIO_PROXY_URL")) {
    repairs.push({ key: "VITE_HELIO_PROXY_URL", value: "/api" });
  }

  let nextEnvRaw = envRaw;
  for (const repair of repairs) {
    nextEnvRaw = setKey(nextEnvRaw, repair.key, repair.value);
  }
  if (repairs.length > 0) {
    mkdirSync(path.dirname(envFilePath), { recursive: true });
    writeFileSync(envFilePath, nextEnvRaw, "utf8");
  }

  const viteConfig = readFileSync(path.resolve("vite.config.ts"), "utf8");
  const supabaseClient = readFileSync(path.resolve("src/integrations/supabase/client.ts"), "utf8");
  const authEnvCheck = readFileSync(path.resolve("src/lib/auth-env-check.ts"), "utf8");

  const report: GuardReport = {
    generatedAt: new Date().toISOString(),
    envFilePath,
    repairedKeys: repairs.map((repair) => repair.key),
    remainingMissingKeys: [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ].filter((key) => !parseEnvFile(nextEnvRaw).get(key)),
    codeChecks: {
      viteInjectsPublicEnv: viteConfig.includes("__GAUSS_PUBLIC_ENV__"),
      supabaseUsesSharedRuntimeEnv: supabaseClient.includes('getViteEnv("VITE_SUPABASE_URL")'),
      authChecksUseSharedRuntimeEnv: authEnvCheck.includes('getViteEnv("VITE_SUPABASE_URL")'),
    },
  };

  const outPath = path.resolve("reports/monitoring/offline-auth-env-guard.latest.json");
  writeJson(outPath, report);
  console.log(JSON.stringify(report, null, 2));

  if (
    report.remainingMissingKeys.length > 0 ||
    Object.values(report.codeChecks).some((value) => value === false)
  ) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
