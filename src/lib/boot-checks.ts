/**
 * Boot-time status checks. Run during app load; failures are reported via toast.
 */

import { getSupabaseEnvStatus } from "@/lib/auth-env-check";
import { fetchAuthSession, fetchBackendHealth } from "@/lib/api/heliophysics-proxy";

export type BootStepId = "backend" | "auth-config" | "session" | "ready";

export interface BootStepResult {
  id: BootStepId;
  label: string;
  ok: boolean;
  message?: string;
  durationMs?: number;
}

export async function checkBackendHealth(): Promise<BootStepResult> {
  const start = Date.now();
  const label = "Backend health";
  try {
    const health = await fetchBackendHealth();
    const memoryLevel = health.memory?.level ?? "nominal";
    const message =
      memoryLevel === "nominal"
        ? undefined
        : `Backend RAM is ${memoryLevel}; lightweight surfaces are recommended.`;
    return {
      id: "backend",
      label,
      ok: health.ok !== false,
      message,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Backend unreachable. Using offline cache if available.";
    return {
      id: "backend",
      label,
      ok: false,
      message,
      durationMs: Date.now() - start,
    };
  }
}

export function checkAuthConfig(): BootStepResult {
  const status = getSupabaseEnvStatus();
  return {
    id: "auth-config",
    label: "Auth config",
    ok: status.configured,
    message: status.configured ? undefined : status.reason ?? "Supabase env not set. Sign-in will be unavailable.",
  };
}

export async function checkAuthSession(): Promise<BootStepResult> {
  const start = Date.now();
  const label = "Auth session";
  try {
    const session = await fetchAuthSession();
    const ok = !session.authRequired || session.authenticated;
    return {
      id: "session",
      label,
      ok,
      message: ok ? undefined : "Sign in for full mission data and protected feeds.",
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Session check failed. You may need to sign in.";
    return {
      id: "session",
      label,
      ok: false,
      message,
      durationMs: Date.now() - start,
    };
  }
}
