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
  const url = (typeof import.meta !== 'undefined' ? import.meta?.env?.VITE_SUPABASE_URL : typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL : undefined);
  const key = (typeof import.meta !== 'undefined' ? import.meta?.env?.VITE_SUPABASE_PUBLISHABLE_KEY : typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_PUBLISHABLE_KEY : undefined);

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
  if (!configured && (typeof import.meta !== 'undefined' ? import.meta?.env?.DEV : typeof process !== 'undefined' ? process.env?.DEV : undefined)) {
    console.warn("[Auth] Supabase env not configured:", reason);
    warned = true;
  }
}
