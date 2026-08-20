import { getViteEnv } from "@/lib/heliophysics-utils";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeEnvBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hasExplicitScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
}

function isRootRelative(value: string): boolean {
  return value.startsWith("/");
}

function shouldPreserveExplicitOrigin(rawEnvBaseUrl: string): boolean {
  return hasExplicitScheme(rawEnvBaseUrl) || isRootRelative(rawEnvBaseUrl);
}

function resolveEnvBaseUrl(): string | null {
  const envValue =
    getViteEnv("VITE_HELIO_PROXY_URL") ??
    (typeof process !== "undefined" ? process.env?.VITE_HELIO_PROXY_URL : undefined) ??
    null;
  return normalizeEnvBaseUrl(envValue);
}

export function resolveHostAwareBaseUrl(envBaseUrlInput: string | null | undefined, defaultPort: number): string {
  const envBaseUrl = normalizeEnvBaseUrl(envBaseUrlInput);
  if (typeof window === "undefined") {
    return stripTrailingSlash(envBaseUrl ?? `http://localhost:${defaultPort}`);
  }

  return resolveClientBaseUrl(new URL(window.location.href), envBaseUrlInput, defaultPort);
}

export function resolveClientBaseUrl(
  pageUrl: URL,
  envBaseUrlInput: string | null | undefined,
  defaultPort: number,
): string {
  const envBaseUrl = normalizeEnvBaseUrl(envBaseUrlInput);
  const fallback = `${pageUrl.protocol}//${pageUrl.hostname}:${defaultPort}`;
  if (!envBaseUrl) {
    return stripTrailingSlash(fallback);
  }

  // In same-origin proxy mode callers still append `/api/...`, so the base must
  // remain the page origin instead of preserving a literal `/api` suffix.
  if (isRootRelative(envBaseUrl)) {
    return stripTrailingSlash(pageUrl.origin);
  }

  try {
    const target = new URL(envBaseUrl, pageUrl.origin);
    const preserveExplicitOrigin = shouldPreserveExplicitOrigin(envBaseUrl);
    if (!target.port && !preserveExplicitOrigin) {
      target.port = String(defaultPort);
    }

    // If frontend runs on hotspot/tailnet/LAN but env still points to localhost,
    // route API calls to the current host with the same backend port.
    if (!isLoopbackHost(pageUrl.hostname) && isLoopbackHost(target.hostname)) {
      target.hostname = pageUrl.hostname;
      if (!target.port && !preserveExplicitOrigin) {
        target.port = String(defaultPort);
      }
    }

    return stripTrailingSlash(target.toString());
  } catch {
    return stripTrailingSlash(fallback);
  }
}

export function getApiBaseUrl(defaultPort = 3001): string {
  return resolveHostAwareBaseUrl(resolveEnvBaseUrl(), defaultPort);
}
