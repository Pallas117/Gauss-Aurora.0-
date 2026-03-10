/**
 * Failure reporting: sends crashes, unhandled errors, and exit signals to the backend
 * for storage in failure_reports (auto-fix or ticket creation). Fire-and-forget;
 * never throws. Uses sendBeacon for pagehide when available.
 */
import { getApiBaseUrl } from "@/lib/api/base-url";

const BASE_URL = getApiBaseUrl();

const FAILURE_ENDPOINT = `${BASE_URL}/api/feedback/failure`;

const MAX_DEDUPE_KEYS = 50;
const DEDUPE_TTL_MS = 30_000;
const dedupeKeys = new Set<string>();
const dedupeTimestamps: Record<string, number> = {};

let hadErrorThisSession = false;

export function setHadErrorThisSession(): void {
  hadErrorThisSession = true;
}

export function getHadErrorThisSession(): boolean {
  return hadErrorThisSession;
}

export type FailureReportPayload = {
  type: "crash" | "error" | "unhandledrejection" | "exit";
  message: string;
  stack?: string | null;
  page?: string | null;
  payload?: Record<string, unknown> | null;
};

function dedupeKey(message: string, stack?: string | null): string {
  const s = (stack ?? "").slice(0, 200);
  return `${message.slice(0, 200)}::${s}`;
}

function isDuplicate(message: string, stack?: string | null): boolean {
  const key = dedupeKey(message, stack);
  const now = Date.now();
  if (dedupeKeys.has(key)) {
    const ts = dedupeTimestamps[key];
    if (ts != null && now - ts < DEDUPE_TTL_MS) return true;
  }
  while (dedupeKeys.size >= MAX_DEDUPE_KEYS) {
    const oldest = Object.entries(dedupeTimestamps).sort((a, b) => a[1] - b[1])[0];
    if (oldest) {
      dedupeKeys.delete(oldest[0]);
      delete dedupeTimestamps[oldest[0]];
    } else break;
  }
  dedupeKeys.add(key);
  dedupeTimestamps[key] = now;
  return false;
}

function buildBody(p: FailureReportPayload): string {
  const payload: Record<string, unknown> = {
    type: p.type,
    message: p.message.slice(0, 2000),
    stack: p.stack != null ? String(p.stack).slice(0, 8000) : null,
    page: p.page != null ? String(p.page).slice(0, 512) : null,
    user_agent: typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent.slice(0, 512) : null,
    payload: p.payload ?? null,
  };
  return JSON.stringify(payload);
}

function sendWithFetch(body: string, keepalive: boolean): void {
  try {
    fetch(FAILURE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive,
    }).catch((err) => {
      console.warn("[failure-reporting] fetch failed:", err);
    });
  } catch (e) {
    console.warn("[failure-reporting] request failed:", e);
  }
}

function sendWithBeacon(body: string): boolean {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return false;
  try {
    const blob = new Blob([body], { type: "application/json" });
    return navigator.sendBeacon(FAILURE_ENDPOINT, blob);
  } catch (e) {
    console.warn("[failure-reporting] sendBeacon failed:", e);
    return false;
  }
}

/**
 * Report a failure to the backend. Dedupes by message+stack for a short window.
 * Never throws. For use from Error Boundary, window.onerror, unhandledrejection, and pagehide.
 */
export function reportFailure(p: FailureReportPayload): void {
  if (p.type !== "exit") {
    hadErrorThisSession = true;
  }
  if (isDuplicate(p.message, p.stack)) {
    return;
  }
  const body = buildBody(p);
  if (p.type === "exit") {
    if (!sendWithBeacon(body)) {
      sendWithFetch(body, true);
    }
    return;
  }
  sendWithFetch(body, false);
}

/**
 * Call from pagehide/beforeunload to send an "exit" report only when the session
 * had already recorded an error (avoids noisy normal tab closes).
 */
export function reportExitIfDirty(): void {
  if (!hadErrorThisSession) return;
  reportFailure({
    type: "exit",
    message: "Session ended after in-session error or crash",
    page: typeof location !== "undefined" ? location.href : undefined,
  });
}
