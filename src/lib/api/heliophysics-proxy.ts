import type {
  AuthSessionState,
  AuroraMapResponse,
  BackendHealthResponse,
  CanonicalSpaceWeatherPoint,
  DashboardLatestResponse,
  ModelSafeCommandExecuteResponse,
  ModelSafeCommandPlanResponse,
  ModelPlannerResponse,
  FeedbackSubmissionRequest,
  FeedbackSubmissionResponse,
  MissionCoreSnapshotResponse,
  MMSReconVectorPoint,
  OpsCommandJob,
  OpsCommandMetricsResponse,
  OpsCommandQueueResponse,
  OpsCommandSnapshotResponse,
  OpsDelegationApprovalRequest,
  OpsDelegationQueueResponse,
  SpaceDomainResponse,
  SourceStatus,
  ThreatSummaryResponse,
  WorkerResult,
  WorkerStatusSnapshot,
} from "@/lib/types/space-weather";
import type { SevenZoneAssessment } from "@/lib/types/seven-zone";
import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";
import {
  parseAuthSessionResponse,
  parseAuroraMapResponse,
  parseDashboardLatestResponse,
  parseMissionCoreSnapshotResponse,
  parseMmsReconnectionFeedResponse,
  parseSpaceDomainResponse,
  parseSevenZoneAssessment,
  parseSourceStatusResponse,
  parseSpaceWeatherFeedResponse,
  parseThreatSummaryResponse,
} from "@/lib/contracts/heliophysics";
import { parseOpsCommandSnapshotResponse } from "@/lib/contracts/ops-command";
import { fetchWithResilience } from "@/lib/network/resilient-fetch";

const BASE_URL = getApiBaseUrl();

function throwHelioHttpError(scope: string, status: number): never {
  if (status === 401) {
    throw new Error(`Sign in required for ${scope}.`);
  }
  if (status === 403) {
    throw new Error(`Insufficient role for ${scope}.`);
  }
  throw new Error(`${scope} HTTP ${status}`);
}

export async function fetchBackendHealth(): Promise<BackendHealthResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/health`,
    {
      method: "GET",
    },
    {
      scope: "backend health",
      timeoutMs: 8_000,
      retries: 1,
    },
  );
  if (!response.ok) {
    throwHelioHttpError("backend health", response.status);
  }
  return (await response.json()) as BackendHealthResponse;
}

export async function fetchSpaceWeather5s(
  lookback = "PT24H",
  limit = 17280,
): Promise<CanonicalSpaceWeatherPoint[]> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feed/space-weather/5s?lookback=${encodeURIComponent(lookback)}&limit=${limit}`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "space weather feed" },
  );
  if (!response.ok) {
    throwHelioHttpError("space weather feed", response.status);
  }
  const json = parseSpaceWeatherFeedResponse(await response.json());
  return json.points as CanonicalSpaceWeatherPoint[];
}

export async function fetchSpaceWeatherLatest(): Promise<CanonicalSpaceWeatherPoint> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feed/space-weather/latest`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "space weather latest" },
  );
  if (!response.ok) {
    throwHelioHttpError("space weather latest", response.status);
  }
  return (await response.json()) as CanonicalSpaceWeatherPoint;
}

export async function fetchMmsReconnection(
  lookback = "PT2H",
  limit = 1440,
): Promise<MMSReconVectorPoint[]> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feed/mms/reconnection?lookback=${encodeURIComponent(lookback)}&limit=${limit}`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "MMS reconnection feed" },
  );
  if (!response.ok) {
    throwHelioHttpError("MMS reconnection feed", response.status);
  }
  const json = parseMmsReconnectionFeedResponse(await response.json());
  return json.vectors as MMSReconVectorPoint[];
}

export async function fetchMmsReconnectionLatest(): Promise<MMSReconVectorPoint> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feed/mms/reconnection/latest`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "MMS reconnection latest" },
  );
  if (!response.ok) {
    throwHelioHttpError("MMS reconnection latest", response.status);
  }
  return (await response.json()) as MMSReconVectorPoint;
}

export async function fetchAuroraMap(): Promise<AuroraMapResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feed/aurora/map?projection=gsm`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "aurora map" },
  );
  if (!response.ok) {
    throwHelioHttpError("aurora map", response.status);
  }
  return parseAuroraMapResponse(await response.json()) as AuroraMapResponse;
}

export async function fetchSourceStatus(): Promise<SourceStatus[]> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feed/sources/status`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "source status" },
  );
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

export async function fetchSpaceDomainSnapshot(): Promise<SpaceDomainResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ssa/space-domain`,
    {
      method: "GET",
    },
    { scope: "space-domain snapshot" },
  );
  if (!response.ok) {
    throwHelioHttpError("space-domain snapshot", response.status);
  }
  return parseSpaceDomainResponse(await response.json()) as SpaceDomainResponse;
}

export async function fetchSevenZoneAssessment(): Promise<SevenZoneAssessment> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ssa/seven-zone`,
    { method: "GET" },
    { scope: "seven-zone advisory" },
  );
  if (!response.ok) {
    throwHelioHttpError("seven-zone advisory", response.status);
  }
  return parseSevenZoneAssessment(await response.json()) as SevenZoneAssessment;
}

export async function fetchThreatSummary(
  lookback = "PT30M",
  limit = 96,
  horizonMinutes = 30,
): Promise<ThreatSummaryResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feed/threats/latest?lookback=${encodeURIComponent(lookback)}&limit=${limit}&horizonMinutes=${horizonMinutes}`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "threat summary" },
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

  const response = await fetchWithResilience(
    `${BASE_URL}/api/auth/session`,
    {
      headers,
    },
    {
      scope: "auth session",
      timeoutMs: 6_000,
      retries: 1,
    },
  );
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
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feed/dashboard/latest?lookback=${encodeURIComponent(lookback)}&limit=${limit}&horizonMinutes=${horizonMinutes}`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "dashboard latest" },
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
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/command/latest?lookback=${encodeURIComponent(lookback)}&limit=${limit}&horizonMinutes=${horizonMinutes}`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "ops command latest" },
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
  const response = await fetchWithResilience(
    `${BASE_URL}/api/mission/core/latest?lookback=${encodeURIComponent(lookback)}&limit=${limit}&horizonMinutes=${horizonMinutes}`,
    {
      headers: await getAuthHeaders(),
    },
    { scope: "mission core latest" },
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
  const response = await fetchWithResilience(
    `${BASE_URL}/api/feedback`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    {
      scope: "feedback submission",
      retries: 1,
      timeoutMs: 7_000,
    },
  );

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
  const response = await fetchWithResilience(
    `${BASE_URL}/api/admin/users`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "users list",
      retries: 1,
      timeoutMs: 7_000,
    },
  );
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
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/audit/summary`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "audit summary",
      retries: 1,
      timeoutMs: 7_000,
    },
  );
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(json.error ?? json.message ?? `Audit summary HTTP ${response.status}`);
  }
  return (await response.json()) as AuditSummaryResponse;
}

export async function queueOpsCommand(
  payload: {
    command_type: string;
    payload?: Record<string, unknown>;
    execute?: boolean;
    simulate?: boolean;
    idempotency_key?: string;
    context?: Record<string, unknown>;
  },
): Promise<OpsCommandQueueResponse | Record<string, unknown>> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/command`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    {
      scope: "ops command queue",
      retries: 1,
      timeoutMs: 12_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof json.error === "string" ? json.error : `ops command HTTP ${response.status}`;
    throw new Error(error);
  }
  return json;
}

export async function planOpsCommandWithModel(
  payload: {
    prompt: string;
    context?: Record<string, unknown>;
    execute?: boolean;
    simulate?: boolean;
    model?: string;
    idempotency_key?: string;
  },
): Promise<ModelPlannerResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/command/model`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    {
      scope: "model command planner",
      retries: 1,
      timeoutMs: 20_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof json.error === "string" ? json.error : `model planner HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as ModelPlannerResponse;
}

export async function fetchOpsCommandJob(jobId: string): Promise<OpsCommandJob> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/command/job/${encodeURIComponent(jobId)}`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "ops command job",
      retries: 1,
      timeoutMs: 8_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as { error?: string; job?: OpsCommandJob };
  if (!response.ok || !json.job) {
    throw new Error(json.error ?? `ops command job HTTP ${response.status}`);
  }
  return json.job;
}

export async function fetchOpsCommandMetrics(): Promise<OpsCommandMetricsResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/command/metrics`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "ops command metrics",
      retries: 1,
      timeoutMs: 8_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof json.error === "string" ? json.error : `ops command metrics HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as OpsCommandMetricsResponse;
}

export async function planModelSafeCommand(
  payload: {
    prompt: string;
    context?: Record<string, unknown>;
    model?: string;
  },
): Promise<ModelSafeCommandPlanResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/command/model/run/plan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    {
      scope: "model safe command plan",
      retries: 1,
      timeoutMs: 20_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof json.error === "string" ? json.error : `safe command plan HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as ModelSafeCommandPlanResponse;
}

export async function executeModelSafeCommand(
  payload: {
    approval_token?: string;
    simulate?: boolean;
    plan?: Record<string, unknown>;
  },
): Promise<ModelSafeCommandExecuteResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/command/model/run/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    {
      scope: "model safe command execute",
      retries: 0,
      timeoutMs: 30_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof json.error === "string" ? json.error : `safe command execute HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as ModelSafeCommandExecuteResponse;
}

export interface OpsWorkerDispatchResponse {
  task: Record<string, unknown>;
  result: WorkerResult;
  workers: WorkerStatusSnapshot[];
  queuedApprovals: OpsDelegationQueueResponse["queuedApprovals"];
  brokerPolicy: NonNullable<OpsDelegationQueueResponse["brokerPolicy"]>;
}

export async function fetchOpsWorkers(): Promise<{
  workers: WorkerStatusSnapshot[];
  brokerPolicy: NonNullable<OpsDelegationQueueResponse["brokerPolicy"]>;
}> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/control/workers`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "ops workers",
      retries: 1,
      timeoutMs: 8_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof json.error === "string" ? json.error : `ops workers HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as {
    workers: WorkerStatusSnapshot[];
    brokerPolicy: NonNullable<OpsDelegationQueueResponse["brokerPolicy"]>;
  };
}

export async function fetchOpsDelegationQueue(): Promise<OpsDelegationQueueResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/control/delegation/queue`,
    {
      headers: await getAuthHeaders(),
    },
    {
      scope: "ops delegation queue",
      retries: 1,
      timeoutMs: 8_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      typeof json.error === "string"
        ? json.error
        : `ops delegation queue HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as OpsDelegationQueueResponse;
}

export async function dispatchOpsWorkerTask(payload: {
  workerId?: string;
  lane?: string;
  kind: string;
  priority?: string;
  source?: string;
  payload?: Record<string, unknown>;
  relatedArtifacts?: string[];
}): Promise<OpsWorkerDispatchResponse> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/control/delegation/dispatch`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    {
      scope: "ops delegation dispatch",
      retries: 1,
      timeoutMs: 20_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      typeof json.error === "string"
        ? json.error
        : `ops delegation dispatch HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as OpsWorkerDispatchResponse;
}

export async function approveOpsDelegationTask(
  payload: OpsDelegationApprovalRequest,
): Promise<{
  result: WorkerResult;
  workers: WorkerStatusSnapshot[];
  queuedApprovals: OpsDelegationQueueResponse["queuedApprovals"];
  brokerPolicy: NonNullable<OpsDelegationQueueResponse["brokerPolicy"]>;
}> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/control/delegation/approve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    {
      scope: "ops delegation approve",
      retries: 1,
      timeoutMs: 12_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      typeof json.error === "string"
        ? json.error
        : `ops delegation approve HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as {
    result: WorkerResult;
    workers: WorkerStatusSnapshot[];
    queuedApprovals: OpsDelegationQueueResponse["queuedApprovals"];
    brokerPolicy: NonNullable<OpsDelegationQueueResponse["brokerPolicy"]>;
  };
}

export async function rejectOpsDelegationTask(
  payload: OpsDelegationApprovalRequest,
): Promise<{
  result: WorkerResult;
  workers: WorkerStatusSnapshot[];
  queuedApprovals: OpsDelegationQueueResponse["queuedApprovals"];
  brokerPolicy: NonNullable<OpsDelegationQueueResponse["brokerPolicy"]>;
}> {
  const response = await fetchWithResilience(
    `${BASE_URL}/api/ops/control/delegation/reject`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    {
      scope: "ops delegation reject",
      retries: 1,
      timeoutMs: 12_000,
    },
  );
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      typeof json.error === "string"
        ? json.error
        : `ops delegation reject HTTP ${response.status}`;
    throw new Error(error);
  }
  return json as unknown as {
    result: WorkerResult;
    workers: WorkerStatusSnapshot[];
    queuedApprovals: OpsDelegationQueueResponse["queuedApprovals"];
    brokerPolicy: NonNullable<OpsDelegationQueueResponse["brokerPolicy"]>;
  };
}
