import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
