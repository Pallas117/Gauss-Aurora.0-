import type {
  AuthSessionState,
  AuroraMapResponse,
  CanonicalSpaceWeatherPoint,
  DashboardLatestResponse,
  FeedbackSubmissionRequest,
  FeedbackSubmissionResponse,
  MissionCoreSnapshotResponse,
  MMSReconVectorPoint,
  OpsCommandSnapshotResponse,
  SourceStatus,
  ThreatSummaryResponse,
} from "@/lib/types/space-weather";
import { getAuthHeaders } from "@/lib/api/auth";
import {
  parseAuthSessionResponse,
  parseAuroraMapResponse,
  parseDashboardLatestResponse,
  parseMissionCoreSnapshotResponse,
  parseMmsReconnectionFeedResponse,
  parseSourceStatusResponse,
  parseSpaceWeatherFeedResponse,
  parseThreatSummaryResponse,
} from "@/lib/contracts/heliophysics";
import { parseOpsCommandSnapshotResponse } from "@/lib/contracts/ops-command";

// @ts-ignore
const envUrl = typeof import_meta !== 'undefined' ? import_meta?.env?.VITE_HELIO_PROXY_URL : typeof process !== 'undefined' ? process.env?.VITE_HELIO_PROXY_URL : undefined;
const BASE_URL = envUrl ?? "http://localhost:3001";

function throwHelioHttpError(scope: string, status: number): never {
  if (status === 401) {
    throw new Error(`Sign in required for ${scope}.`);
  }
  if (status === 403) {
    throw new Error(`Insufficient role for ${scope}.`);
  }
  throw new Error(`${scope} HTTP ${status}`);
}

export async function fetchSpaceWeather5s(
  lookback = "PT24H",
  limit = 17280,
): Promise<CanonicalSpaceWeatherPoint[]> {
  const response = await fetch(
    `${BASE_URL}/api/feed/space-weather/5s?lookback=${encodeURIComponent(lookback)}&limit=${limit}`,
    {
      headers: await getAuthHeaders(),
    },
  );
  if (!response.ok) {
    throwHelioHttpError("space weather feed", response.status);
  }
  const json = parseSpaceWeatherFeedResponse(await response.json());
  return json.points as CanonicalSpaceWeatherPoint[];
}

export async function fetchSpaceWeatherLatest(): Promise<CanonicalSpaceWeatherPoint> {
  const response = await fetch(`${BASE_URL}/api/feed/space-weather/latest`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    throwHelioHttpError("space weather latest", response.status);
  }
  return (await response.json()) as CanonicalSpaceWeatherPoint;
}

export async function fetchMmsReconnection(
  lookback = "PT2H",
  limit = 1440,
): Promise<MMSReconVectorPoint[]> {
  const response = await fetch(
    `${BASE_URL}/api/feed/mms/reconnection?lookback=${encodeURIComponent(lookback)}&limit=${limit}`,
    {
      headers: await getAuthHeaders(),
    },
  );
  if (!response.ok) {
    throwHelioHttpError("MMS reconnection feed", response.status);
  }
  const json = parseMmsReconnectionFeedResponse(await response.json());
  return json.vectors as MMSReconVectorPoint[];
}

export async function fetchMmsReconnectionLatest(): Promise<MMSReconVectorPoint> {
  const response = await fetch(`${BASE_URL}/api/feed/mms/reconnection/latest`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    throwHelioHttpError("MMS reconnection latest", response.status);
  }
  return (await response.json()) as MMSReconVectorPoint;
}

export async function fetchAuroraMap(): Promise<AuroraMapResponse> {
  const response = await fetch(`${BASE_URL}/api/feed/aurora/map?projection=gsm`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    throwHelioHttpError("aurora map", response.status);
  }
  return parseAuroraMapResponse(await response.json()) as AuroraMapResponse;
}

export async function fetchSourceStatus(): Promise<SourceStatus[]> {
  const response = await fetch(`${BASE_URL}/api/feed/sources/status`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    throwHelioHttpError("source status", response.status);
  }
  const json = parseSourceStatusResponse(await response.json());
  const sources: SourceStatus[] = json.sources.map((s) => ({
    source: s.source ?? "",
    lastSeen: s.lastSeen ?? null,
    latencySeconds: s.latencySeconds ?? null,
    healthy: s.healthy ?? false,
    ...(s.message !== undefined && { message: s.message }),
  }));
  return sources;
}

export async function fetchThreatSummary(
  lookback = "PT30M",
  limit = 96,
  horizonMinutes = 30,
): Promise<ThreatSummaryResponse> {
  const response = await fetch(
    `${BASE_URL}/api/feed/threats/latest?lookback=${encodeURIComponent(lookback)}&limit=${limit}&horizonMinutes=${horizonMinutes}`,
    {
      headers: await getAuthHeaders(),
    },
  );
  if (!response.ok) {
    throwHelioHttpError("threat summary", response.status);
  }
  return parseThreatSummaryResponse(await response.json()) as ThreatSummaryResponse;
}

export async function fetchAuthSession(
  token?: string | null,
): Promise<AuthSessionState> {
  const headers: HeadersInit = {};
  const bearer = token?.trim();
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  } else {
    Object.assign(headers, await getAuthHeaders());
  }

  const response = await fetch(`${BASE_URL}/api/auth/session`, {
    headers,
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const serverError =
      typeof json.error === "string"
        ? json.error
        : response.status === 500
          ? "Server auth not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend."
          : `auth session HTTP ${response.status}`;
    return {
      authRequired: true,
      authenticated: false,
      role: null,
      clearance: null,
      userId: null,
      email: null,
      emailVerified: false,
      features: { heliophysics: false, debris: false },
      message: typeof json.message === "string" ? json.message : undefined,
      error: serverError,
    };
  }

  const parsed = parseAuthSessionResponse(json) as Partial<AuthSessionState>;
  return {
    authRequired: Boolean(parsed.authRequired),
    authenticated: Boolean(parsed.authenticated),
    role: parsed.role ?? null,
    clearance: parsed.clearance ?? null,
    userId: parsed.userId ?? null,
    email: parsed.email ?? null,
    emailVerified: parsed.emailVerified ?? false,
    features: parsed.features ?? { heliophysics: false, debris: false },
    message: parsed.message,
    error: parsed.error,
  };
}

export async function fetchDashboardLatest(
  lookback = "PT30M",
  limit = 96,
  horizonMinutes = 30,
): Promise<DashboardLatestResponse> {
  const response = await fetch(
    `${BASE_URL}/api/feed/dashboard/latest?lookback=${encodeURIComponent(lookback)}&limit=${limit}&horizonMinutes=${horizonMinutes}`,
    {
      headers: await getAuthHeaders(),
    },
  );
  if (!response.ok) {
    throwHelioHttpError("dashboard latest", response.status);
  }
  const parsed = parseDashboardLatestResponse(await response.json()) as DashboardLatestResponse;
  return {
    ...parsed,
    auth: {
      ...parsed.auth,
      clearance: parsed.auth.clearance ?? null,
    },
  };
}

export async function fetchOpsCommandLatest(
  lookback = "PT30M",
  limit = 96,
  horizonMinutes = 30,
): Promise<OpsCommandSnapshotResponse> {
  const response = await fetch(
    `${BASE_URL}/api/ops/command/latest?lookback=${encodeURIComponent(lookback)}&limit=${limit}&horizonMinutes=${horizonMinutes}`,
    {
      headers: await getAuthHeaders(),
    },
  );
  if (!response.ok) {
    throwHelioHttpError("ops command latest", response.status);
  }

  const parsed = parseOpsCommandSnapshotResponse(await response.json()) as OpsCommandSnapshotResponse;
  return {
    ...parsed,
    session: {
      ...parsed.session,
      clearance: parsed.session.clearance ?? null,
    },
  };
}

export async function fetchMissionCoreLatest(
  lookback = "PT30M",
  limit = 96,
  horizonMinutes = 30,
): Promise<MissionCoreSnapshotResponse> {
  const response = await fetch(
    `${BASE_URL}/api/mission/core/latest?lookback=${encodeURIComponent(lookback)}&limit=${limit}&horizonMinutes=${horizonMinutes}`,
    {
      headers: await getAuthHeaders(),
    },
  );
  if (!response.ok) {
    throwHelioHttpError("mission core latest", response.status);
  }
  const parsed = parseMissionCoreSnapshotResponse(await response.json()) as MissionCoreSnapshotResponse;
  return {
    ...parsed,
    auth: {
      ...parsed.auth,
      clearance: parsed.auth.clearance ?? null,
    },
  };
}

export async function submitFeedback(
  payload: FeedbackSubmissionRequest,
): Promise<FeedbackSubmissionResponse> {
  const response = await fetch(`${BASE_URL}/api/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throwHelioHttpError("feedback submission", response.status);
  }

  const json = (await response.json()) as Partial<FeedbackSubmissionResponse>;
  return {
    ok: Boolean(json.ok),
    id: String(json.id ?? ""),
    submittedAt: String(json.submittedAt ?? new Date().toISOString()),
  };
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  createdAt: string;
  role?: string;
}

export async function fetchAdminUsers(): Promise<{ users: AdminUserRow[] }> {
  const response = await fetch(`${BASE_URL}/api/admin/users`, {
    headers: await getAuthHeaders(),
  });
  if (response.status === 401) {
    throw new Error("Sign in required.");
  }
  if (response.status === 403) {
    throw new Error("Admin role required to view registered users.");
  }
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `Users list HTTP ${response.status}`);
  }
  const json = (await response.json()) as { users?: AdminUserRow[] };
  return { users: Array.isArray(json.users) ? json.users : [] };
}

export interface AuditSummaryResponse {
  generated_at: string | null;
  totals: { pass: number; warn: number; fail: number; skip: number } | null;
  check_count?: number;
  message?: string;
}

export async function fetchAuditSummary(): Promise<AuditSummaryResponse> {
  const response = await fetch(`${BASE_URL}/api/ops/audit/summary`, {
    headers: await getAuthHeaders(),
  });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(json.error ?? json.message ?? `Audit summary HTTP ${response.status}`);
  }
  return (await response.json()) as AuditSummaryResponse;
}
