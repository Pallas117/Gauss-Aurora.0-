import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isNetworkOnlySensitiveData } from "./security/data-residency.js";

const PLACEHOLDER_SUPABASE_HOST = "your-project.supabase.co";

function isSupabaseConfigured(url: string | undefined): boolean {
  if (!url || !url.trim()) return false;
  try {
    const u = new URL(url);
    return u.hostname !== PLACEHOLDER_SUPABASE_HOST && !u.hostname.endsWith(".example.com");
  } catch {
    return false;
  }
}

function isAllowedNetworkSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return parsed.protocol === "https:" && !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

let cachedAdminClient: SupabaseClient | null = null;
let cachedAnonClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isSupabaseConfigured(url) || !serviceRole) {
    return null;
  }
  // Supabase is one of the backend's sensitive persistence paths. In the
  // hardened profile it must remain a remote TLS endpoint; the startup policy
  // separately requires the configured PQC store gateway and its attestation.
  if (isNetworkOnlySensitiveData() && !isAllowedNetworkSupabaseUrl(url)) {
    return null;
  }
  cachedAdminClient = createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedAdminClient;
}

export function getSupabaseAnonClient(accessToken?: string): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!isSupabaseConfigured(url) || !anonKey) {
    return null;
  }
  if (isNetworkOnlySensitiveData() && !isAllowedNetworkSupabaseUrl(url)) {
    return null;
  }

  if (!accessToken) {
    if (cachedAnonClient) {
      return cachedAnonClient;
    }
    cachedAnonClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    return cachedAnonClient;
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
