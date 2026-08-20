import { getViteEnv } from "@/lib/heliophysics-utils";

/**
 * Auth env check: warn when Supabase frontend env is missing or still placeholder.
 * Use for dev-only console warning and optional config banner.
 */

const PLACEHOLDER_URL = "your-project.supabase.co";
const PLACEHOLDER_KEY = "your-anon-key";

export function getSupabaseEnvStatus(): {
  configured: boolean;
  reason?: string;
} {
  const url = getViteEnv("VITE_SUPABASE_URL");
  const key = getViteEnv("VITE_SUPABASE_PUBLISHABLE_KEY");

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return { configured: false, reason: "VITE_SUPABASE_URL is missing." };
  }
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    return { configured: false, reason: "VITE_SUPABASE_PUBLISHABLE_KEY is missing." };
  }
  if (url.trim().toLowerCase().includes(PLACEHOLDER_URL)) {
    return { configured: false, reason: "VITE_SUPABASE_URL is still the placeholder. Set it to your Supabase project URL." };
  }
  if (key.trim().toLowerCase() === PLACEHOLDER_KEY || key.length < 20) {
    return { configured: false, reason: "VITE_SUPABASE_PUBLISHABLE_KEY is still the placeholder or invalid. Set it to your Supabase anon key." };
  }
  return { configured: true };
}

let warned = false;
export function warnIfSupabaseEnvMissing(): void {
  if (warned) return;
  const { configured, reason } = getSupabaseEnvStatus();
  const isDev =
    (typeof import.meta !== "undefined" ? Boolean(import.meta?.env?.DEV) : false) ||
    (typeof process !== "undefined" ? Boolean(process.env?.DEV) : false);
  if (!configured && isDev) {
    console.warn("[Auth] Supabase env not configured:", reason);
    warned = true;
  }
}
