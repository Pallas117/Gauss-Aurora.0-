/**
 * PostgreSQL client for command_log (bxr stack). Lazy init when POSTGRES_URL is set.
 */

import { Pool } from "pg";
import type { OpsCommandType } from "./deepseek-command-bridge.js";
import type { OpsCommandJobRecord, OpsCommandJobSource, OpsCommandJobStatus } from "./ops-command-runtime.js";

let pool: Pool | null = null;
let opsCommandJobSchemaReady = false;

export function getCommandLogPool(): Pool | null {
  const url = process.env.POSTGRES_URL ?? "";
  if (!url.trim()) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: url.trim(),
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export interface CommandLogRow {
  id: number;
  created_at: Date;
  command_type: string;
  payload: Record<string, unknown>;
  role: string | null;
  user_id: string | null;
}

export interface PersistOpsCommandJobInput {
  jobId: string;
  commandType: OpsCommandType;
  payload: Record<string, unknown>;
  source: OpsCommandJobSource;
  simulate: boolean;
  idempotencyKey: string | null;
  requestedBy: string | null;
  powerConstrained: boolean;
  heavyCommand: boolean;
}

const OPS_COMMAND_JOB_COLUMNS = [
  "job_id",
  "command_type",
  "payload",
  "source",
  "status",
  "simulate",
  "idempotency_key",
  "requested_by",
  "power_constrained",
  "heavy_command",
  "created_at",
  "updated_at",
  "started_at",
  "completed_at",
  "result",
  "error",
].join(", ");

function asIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asJobStatus(value: unknown): OpsCommandJobStatus {
  const status = typeof value === "string" ? value : "";
  if (status === "planned" || status === "running" || status === "succeeded" || status === "failed") {
    return status;
  }
  return "failed";
}

function asJobSource(value: unknown): OpsCommandJobSource {
  const source = typeof value === "string" ? value : "";
  if (source === "manual" || source === "deepseek") {
    return source;
  }
  return "manual";
}

function mapOpsCommandJobRow(row: Record<string, unknown>): OpsCommandJobRecord {
  return {
    jobId: typeof row.job_id === "string" ? row.job_id : "",
    commandType: (typeof row.command_type === "string" ? row.command_type : "log-health-check") as OpsCommandType,
    payload: asObject(row.payload),
    source: asJobSource(row.source),
    status: asJobStatus(row.status),
    simulate: Boolean(row.simulate),
    idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
    requestedBy: typeof row.requested_by === "string" ? row.requested_by : null,
    powerConstrained: Boolean(row.power_constrained),
    heavyCommand: Boolean(row.heavy_command),
    createdAt: asIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: asIso(row.updated_at) ?? new Date().toISOString(),
    startedAt: asIso(row.started_at),
    completedAt: asIso(row.completed_at),
    result: row.result && typeof row.result === "object" ? (row.result as Record<string, unknown>) : null,
    error: typeof row.error === "string" ? row.error : null,
  };
}

async function ensureOpsCommandJobSchema(p: Pool): Promise<void> {
  if (opsCommandJobSchemaReady) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS ops_command_jobs (
      job_id UUID PRIMARY KEY,
      command_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      source TEXT NOT NULL CHECK (source IN ('manual', 'deepseek')),
      status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'succeeded', 'failed')),
      simulate BOOLEAN NOT NULL DEFAULT false,
      idempotency_key TEXT,
      requested_by TEXT,
      power_constrained BOOLEAN NOT NULL DEFAULT false,
      heavy_command BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      result JSONB,
      error TEXT,
      claimed_by TEXT,
      claimed_at TIMESTAMPTZ
    );
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_ops_command_jobs_created_at
      ON ops_command_jobs (created_at DESC);
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_ops_command_jobs_status_created_at
      ON ops_command_jobs (status, created_at);
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS idx_ops_command_jobs_idempotency_created_at
      ON ops_command_jobs (idempotency_key, created_at DESC);
  `);
  opsCommandJobSchemaReady = true;
}

export async function insertCommandLog(entry: {
  command_type: string;
  payload?: Record<string, unknown>;
  role?: string | null;
  user_id?: string | null;
}): Promise<CommandLogRow | null> {
  const p = getCommandLogPool();
  if (!p) {
    return null;
  }
  try {
    const result = await p.query(
      `INSERT INTO command_log (command_type, payload, role, user_id)
       VALUES ($1, $2::jsonb, $3, $4)
       RETURNING id, created_at, command_type, payload, role, user_id`,
      [
        entry.command_type,
        JSON.stringify(entry.payload ?? {}),
        entry.role ?? null,
        entry.user_id ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      created_at: row.created_at,
      command_type: row.command_type,
      payload: typeof row.payload === "object" && row.payload !== null ? row.payload as Record<string, unknown> : {},
      role: row.role,
      user_id: row.user_id,
    };
  } catch (err) {
    console.warn("[pg] command_log insert failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getCommandLogLatest(limit: number): Promise<CommandLogRow[]> {
  const p = getCommandLogPool();
  if (!p) {
    return [];
  }
  try {
    const result = await p.query(
      `SELECT id, created_at, command_type, payload, role, user_id
       FROM command_log
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      created_at: row.created_at,
      command_type: row.command_type,
      payload: typeof row.payload === "object" && row.payload !== null ? row.payload as Record<string, unknown> : {},
      role: row.role,
      user_id: row.user_id,
    }));
  } catch (err) {
    console.warn("[pg] command_log select failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function upsertOpsCommandJob(
  entry: PersistOpsCommandJobInput,
  idempotencyTtlMs: number,
): Promise<{ job: OpsCommandJobRecord; deduped: boolean } | null> {
  const p = getCommandLogPool();
  if (!p) {
    return null;
  }
  const ttlSeconds = Math.max(1, Math.min(Math.round(idempotencyTtlMs / 1000), 86400));
  const client = await p.connect();
  try {
    await ensureOpsCommandJobSchema(p);
    await client.query("BEGIN");
    if (entry.idempotencyKey) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [entry.idempotencyKey]);
      const existing = await client.query(
        `SELECT ${OPS_COMMAND_JOB_COLUMNS}
         FROM ops_command_jobs
         WHERE idempotency_key = $1
           AND created_at >= now() - make_interval(secs => $2)
         ORDER BY created_at DESC
         LIMIT 1`,
        [entry.idempotencyKey, ttlSeconds],
      );
      const row = existing.rows[0] as Record<string, unknown> | undefined;
      if (row) {
        await client.query("COMMIT");
        return {
          job: mapOpsCommandJobRow(row),
          deduped: true,
        };
      }
    }
    const inserted = await client.query(
      `INSERT INTO ops_command_jobs (
        job_id, command_type, payload, source, status, simulate, idempotency_key,
        requested_by, power_constrained, heavy_command
      )
      VALUES ($1, $2, $3::jsonb, $4, 'planned', $5, $6, $7, $8, $9)
      RETURNING ${OPS_COMMAND_JOB_COLUMNS}`,
      [
        entry.jobId,
        entry.commandType,
        JSON.stringify(entry.payload),
        entry.source,
        entry.simulate,
        entry.idempotencyKey,
        entry.requestedBy,
        entry.powerConstrained,
        entry.heavyCommand,
      ],
    );
    await client.query("COMMIT");
    const row = inserted.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      job: mapOpsCommandJobRow(row),
      deduped: false,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // noop
    }
    console.warn("[pg] ops_command_jobs upsert failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    client.release();
  }
}

export async function getOpsCommandJob(jobId: string): Promise<OpsCommandJobRecord | null> {
  const p = getCommandLogPool();
  if (!p || !jobId.trim()) return null;
  try {
    await ensureOpsCommandJobSchema(p);
    const result = await p.query(
      `SELECT ${OPS_COMMAND_JOB_COLUMNS}
       FROM ops_command_jobs
       WHERE job_id = $1`,
      [jobId.trim()],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapOpsCommandJobRow(row) : null;
  } catch (err) {
    console.warn("[pg] ops_command_jobs get failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listOpsCommandJobs(limit: number, statuses?: OpsCommandJobStatus[]): Promise<OpsCommandJobRecord[]> {
  const p = getCommandLogPool();
  if (!p) return [];
  const max = Math.max(1, Math.min(limit, 500));
  const validStatuses = Array.isArray(statuses)
    ? statuses.filter((status) => status === "planned" || status === "running" || status === "succeeded" || status === "failed")
    : [];
  try {
    await ensureOpsCommandJobSchema(p);
    const result = validStatuses.length > 0
      ? await p.query(
          `SELECT ${OPS_COMMAND_JOB_COLUMNS}
           FROM ops_command_jobs
           WHERE status = ANY($1::text[])
           ORDER BY created_at DESC
           LIMIT $2`,
          [validStatuses, max],
        )
      : await p.query(
          `SELECT ${OPS_COMMAND_JOB_COLUMNS}
           FROM ops_command_jobs
           ORDER BY created_at DESC
           LIMIT $1`,
          [max],
        );
    return result.rows.map((row) => mapOpsCommandJobRow(row as Record<string, unknown>));
  } catch (err) {
    console.warn("[pg] ops_command_jobs list failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function claimOpsCommandJob(jobId: string, workerId: string): Promise<boolean> {
  const p = getCommandLogPool();
  if (!p || !jobId.trim()) return false;
  try {
    await ensureOpsCommandJobSchema(p);
    const result = await p.query(
      `UPDATE ops_command_jobs
       SET status = 'running',
           started_at = COALESCE(started_at, now()),
           updated_at = now(),
           claimed_by = $2,
           claimed_at = now()
       WHERE job_id = $1
         AND status = 'planned'`,
      [jobId.trim(), workerId.slice(0, 120)],
    );
    return result.rowCount > 0;
  } catch (err) {
    console.warn("[pg] ops_command_jobs claim failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function finalizeOpsCommandJob(entry: {
  jobId: string;
  status: OpsCommandJobStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<OpsCommandJobRecord | null> {
  const p = getCommandLogPool();
  if (!p || !entry.jobId.trim()) return null;
  try {
    await ensureOpsCommandJobSchema(p);
    const status = entry.status === "planned" || entry.status === "running" || entry.status === "succeeded" || entry.status === "failed"
      ? entry.status
      : "failed";
    const result = await p.query(
      `UPDATE ops_command_jobs
       SET status = $2,
           result = $3::jsonb,
           error = $4,
           updated_at = now(),
           completed_at = CASE WHEN $2 IN ('succeeded', 'failed') THEN now() ELSE completed_at END
       WHERE job_id = $1
       RETURNING ${OPS_COMMAND_JOB_COLUMNS}`,
      [
        entry.jobId.trim(),
        status,
        JSON.stringify(entry.result ?? null),
        entry.error ?? null,
      ],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapOpsCommandJobRow(row) : null;
  } catch (err) {
    console.warn("[pg] ops_command_jobs finalize failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function reclaimStaleRunningOpsCommandJobs(staleAfterMs: number): Promise<number> {
  const p = getCommandLogPool();
  if (!p) return 0;
  const staleSeconds = Math.max(30, Math.min(Math.round(staleAfterMs / 1000), 86_400));
  try {
    await ensureOpsCommandJobSchema(p);
    const result = await p.query(
      `UPDATE ops_command_jobs
       SET status = 'planned',
           updated_at = now(),
           claimed_by = NULL,
           claimed_at = NULL,
           error = COALESCE(error, 'Recovered stale running job after worker restart')
       WHERE status = 'running'
         AND updated_at < now() - make_interval(secs => $1)`,
      [staleSeconds],
    );
    return result.rowCount;
  } catch (err) {
    console.warn("[pg] ops_command_jobs reclaim failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
