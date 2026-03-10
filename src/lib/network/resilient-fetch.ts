const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 350;
const DEFAULT_RETRY_MAX_MS = 2_500;
const DEFAULT_TRANSITION_GRACE_MS = 1_500;

const DEFAULT_RETRIABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

let trackingInitialized = false;
let lastNetworkTransitionAt = 0;

export interface ResilientFetchOptions {
  scope?: string;
  timeoutMs?: number;
  retries?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  transitionGraceMs?: number;
  failFastOffline?: boolean;
  retriableStatuses?: readonly number[];
}

function nowMs(): number {
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function jitteredBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * (2 ** attempt));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp * 0.25)));
  return exp + jitter;
}

function isOffline(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return navigator.onLine === false;
}

function initNetworkTracking(): void {
  if (trackingInitialized || typeof window === "undefined") {
    return;
  }
  trackingInitialized = true;
  const mark = () => {
    lastNetworkTransitionAt = nowMs();
  };
  window.addEventListener("online", mark);
  window.addEventListener("offline", mark);
}

async function waitForTransitionClear(graceMs: number): Promise<void> {
  if (graceMs <= 0) {
    return;
  }
  initNetworkTracking();
  const elapsed = nowMs() - lastNetworkTransitionAt;
  if (elapsed >= graceMs) {
    return;
  }
  await sleep(graceMs - elapsed);
}

function createTimedSignal(
  parentSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void; parentAborted: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  let parentWasAborted = false;

  const onParentAbort = () => {
    parentWasAborted = true;
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, Math.max(1, timeoutMs));

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    parentAborted: () => parentWasAborted,
    cleanup: () => {
      clearTimeout(timeout);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    },
  };
}

function shouldRetryStatus(status: number, custom: readonly number[] | undefined): boolean {
  if (Array.isArray(custom) && custom.length > 0) {
    return custom.includes(status);
  }
  return DEFAULT_RETRIABLE_STATUSES.has(status);
}

function shouldRetryError(
  error: unknown,
  timedOut: boolean,
  parentAborted: boolean,
): boolean {
  if (parentAborted) {
    return false;
  }
  if (timedOut) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof DOMException) {
    return (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      error.name === "NetworkError"
    );
  }
  return false;
}

function normalizeErrorMessage(scope: string, error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`${scope}: ${error.message}`);
  }
  return new Error(`${scope}: request failed`);
}

export async function fetchWithResilience(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ResilientFetchOptions = {},
): Promise<Response> {
  const {
    scope = "request",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    retryMaxMs = DEFAULT_RETRY_MAX_MS,
    transitionGraceMs = DEFAULT_TRANSITION_GRACE_MS,
    failFastOffline = true,
    retriableStatuses,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt === 0) {
      await waitForTransitionClear(transitionGraceMs);
    }

    if (failFastOffline && isOffline()) {
      throw new Error(`${scope}: offline`);
    }

    const timed = createTimedSignal(init.signal, timeoutMs);
    try {
      const response = await fetch(input, {
        ...init,
        signal: timed.signal,
      });

      if (
        !response.ok &&
        attempt < retries &&
        shouldRetryStatus(response.status, retriableStatuses)
      ) {
        await sleep(jitteredBackoff(attempt, retryBaseMs, retryMaxMs));
        continue;
      }

      return response;
    } catch (error) {
      const retryable = shouldRetryError(error, timed.didTimeout(), timed.parentAborted());
      if (attempt < retries && retryable) {
        await sleep(jitteredBackoff(attempt, retryBaseMs, retryMaxMs));
        continue;
      }
      lastError = normalizeErrorMessage(scope, error);
      break;
    } finally {
      timed.cleanup();
    }
  }

  throw lastError ?? new Error(`${scope}: request failed`);
}

