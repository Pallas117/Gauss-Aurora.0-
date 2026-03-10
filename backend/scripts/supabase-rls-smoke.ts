/**
 * Supabase RLS smoke test: as an authenticated user, SELECT from published
 * tables must succeed; INSERT into raw tables must fail (RLS + grants).
 *
 * Usage:
 *   npm run test:supabase-rls
 *   npm run test:supabase-rls -- --help
 *
 * Environment:
 *   SUPABASE_URL or VITE_SUPABASE_URL               (required)
 *   SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY (required)
 *   RBAC_VIEWER_TOKEN or RBAC_VIEWER_EMAIL/RBAC_VIEWER_PASSWORD (required)
 */

import { createClient } from "@supabase/supabase-js";

const HELP_TEXT = `
Supabase RLS smoke test.

Usage:
  npm run test:supabase-rls
  npm run test:supabase-rls -- --help

Environment:
  SUPABASE_URL or VITE_SUPABASE_URL               (required)
  SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY (required)
  RBAC_VIEWER_TOKEN or RBAC_VIEWER_EMAIL/RBAC_VIEWER_PASSWORD (required)
`;

function envValue(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

async function loginWithPassword(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(12_000),
  });
  const raw = await res.text();
  let body: { access_token?: string } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // ignore
  }
  const token = body.access_token;
  if (res.status !== 200 || !token) {
    throw new Error(`Auth failed for ${email} (HTTP ${res.status}): ${raw.slice(0, 200)}`);
  }
  return token;
}

function printResult(name: string, pass: boolean, detail: string): boolean {
  const status = pass ? "PASS" : "FAIL";
  console.log(`[${status}] ${name}: ${detail}`);
  return pass;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const supabaseUrl = envValue("SUPABASE_URL", "VITE_SUPABASE_URL");
  const anonKey = envValue("VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    console.error(
      "Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_ANON_KEY/VITE_SUPABASE_PUBLISHABLE_KEY.",
    );
    process.exit(1);
  }

  let token = envValue("RBAC_VIEWER_TOKEN");
  if (!token) {
    const email = envValue("RBAC_VIEWER_EMAIL");
    const password = envValue("RBAC_VIEWER_PASSWORD");
    if (!email || !password) {
      console.error(
        "Missing RBAC_VIEWER_TOKEN or RBAC_VIEWER_EMAIL/RBAC_VIEWER_PASSWORD.",
      );
      process.exit(1);
    }
    token = await loginWithPassword(supabaseUrl, anonKey, email, password);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  let failures = 0;

  // Published tables: authenticated must be able to SELECT (may return empty)
  const publishedTables = [
    "sw_nowcast_5s",
    "mms_recon_vectors_5s",
    "aurora_healpix_maps",
    "source_health",
  ] as const;

  for (const table of publishedTables) {
    const { error } = await supabase.from(table).select("*").limit(1);
    const pass = !error;
    if (!printResult(`authenticated SELECT ${table}`, pass, error ? error.message : "ok")) {
      failures += 1;
    }
  }

  // Raw table: authenticated must NOT be able to INSERT (RLS + no grant)
  const { error: insertError } = await supabase.from("sw_raw_samples").insert({
    source: "rls-smoke",
    stream: "test",
    observed_at: new Date().toISOString(),
    payload: { test: true },
  });
  const insertDenied = !!insertError;
  if (!printResult("authenticated INSERT sw_raw_samples denied", insertDenied, insertDenied ? "ok (denied)" : "expected denial")) {
    failures += 1;
  }

  if (failures > 0) {
    console.error(`\nSupabase RLS smoke test failed with ${failures} issue(s).`);
    process.exit(1);
  }

  console.log("\nSupabase RLS smoke test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
