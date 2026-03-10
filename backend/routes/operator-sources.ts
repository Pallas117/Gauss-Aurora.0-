/**
 * Operator portal: data sources and satellite hardware CRUD.
 * All routes require operator or admin (requireRole("operator") - admin satisfies).
 */

import type { Response } from "express";
import express from "express";
import { getSupabaseAdminClient } from "../supabase.js";
import type { AuthenticatedRequest } from "../auth.js";
import { getSourceStatus, upsertSourceStatus } from "../state.js";
import { buildPersistedSourceHealthRows } from "../source-health-store.js";
import type { DataSource, SourceStatus } from "../types.js";

const DATA_SOURCE_TYPES = ["space_weather_feed", "mms_feed", "telemetry_ingest", "custom_url"] as const;
const HARDWARE_TYPES = ["ground_station", "antenna", "telemetry_source", "sensor"] as const;
const SOURCE_OVERRIDE_DECISIONS = ["primary", "validate", "sample", "suspend"] as const;
const KNOWN_SOURCE_KEYS = [
  "noaa-swpc",
  "esa-hapi",
  "jaxa-erg",
  "mms-cdaweb",
  "mms-lasp",
  "model-nowcast",
] as const;

function parseSourceKey(value: unknown): DataSource | null {
  return typeof value === "string" &&
    KNOWN_SOURCE_KEYS.includes(value as (typeof KNOWN_SOURCE_KEYS)[number])
    ? (value as DataSource)
    : null;
}

function parseOverrideDecision(
  value: unknown,
): "primary" | "validate" | "sample" | "suspend" | null {
  return value == null
    ? null
    : typeof value === "string" &&
        SOURCE_OVERRIDE_DECISIONS.includes(value as (typeof SOURCE_OVERRIDE_DECISIONS)[number])
      ? (value as "primary" | "validate" | "sample" | "suspend")
      : null;
}

function parseOptionalCadenceMs(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value == null || value === "") {
    return null;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric < 1) {
    return undefined;
  }
  return Math.round(numeric);
}

function parseOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

export type MountDeps = {
  requireRole: (role: "operator" | "admin") => (req: express.Request, res: Response, next: () => void) => void;
  withAsyncMiddleware: (
    fn: (req: AuthenticatedRequest, res: Response, next: express.NextFunction) => Promise<void>,
  ) => express.RequestHandler;
};

export function mountOperatorSourcesRoutes(app: express.Application, deps: MountDeps): void {
  const { requireRole, withAsyncMiddleware } = deps;
  const op = requireRole("operator");

  app.patch(
    "/api/ops/source-health/:source/override",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const source = parseSourceKey(req.params.source);
      if (!source) {
        res.status(400).json({ error: "source must be one of the known ingest sources" });
        return;
      }

      const body = req.body as {
        overrideDecision?: unknown;
        overrideTargetCadenceMs?: unknown;
        overrideReason?: unknown;
      };

      const overrideDecision = parseOverrideDecision(body.overrideDecision);
      if (body.overrideDecision !== undefined && body.overrideDecision !== null && overrideDecision == null) {
        res.status(400).json({ error: "overrideDecision must be primary, validate, sample, suspend, or null" });
        return;
      }

      const overrideTargetCadenceMs = parseOptionalCadenceMs(body.overrideTargetCadenceMs);
      if (body.overrideTargetCadenceMs !== undefined && overrideTargetCadenceMs === undefined) {
        res.status(400).json({ error: "overrideTargetCadenceMs must be a positive number or null" });
        return;
      }

      const overrideReason = parseOptionalText(body.overrideReason, 240);
      if (body.overrideReason !== undefined && overrideReason === undefined) {
        res.status(400).json({ error: "overrideReason must be a string or null" });
        return;
      }

      const existing = getSourceStatus().find((entry) => entry.source === source);
      const nextDecision =
        body.overrideDecision === undefined
          ? (existing?.overrideDecision ?? null)
          : overrideDecision;
      const nextCadenceMs =
        overrideTargetCadenceMs === undefined
          ? (existing?.overrideTargetCadenceMs ?? null)
          : overrideTargetCadenceMs;
      const nextReason =
        overrideReason === undefined
          ? (existing?.overrideReason ?? null)
          : overrideReason;
      const overrideActive = nextDecision != null || nextCadenceMs != null || Boolean(nextReason);
      const updatedAt = overrideActive ? new Date().toISOString() : null;
      const updatedBy = overrideActive
        ? req.auth?.userId ?? req.auth?.email ?? req.auth?.role ?? "operator"
        : null;

      const nextStatus: SourceStatus = {
        source,
        lastSeen: existing?.lastSeen ?? null,
        latencySeconds: existing?.latencySeconds ?? null,
        healthy: existing?.healthy ?? false,
        message: existing?.message ?? "No runtime health observed yet.",
        powerDecision: existing?.powerDecision,
        utilityScore: existing?.utilityScore,
        targetCadenceMs: existing?.targetCadenceMs ?? null,
        policyReason: existing?.policyReason,
        observedCostScore: existing?.observedCostScore,
        avgFetchDurationMs: existing?.avgFetchDurationMs,
        avgCpuMs: existing?.avgCpuMs,
        avgPayloadKb: existing?.avgPayloadKb,
        sampleCount: existing?.sampleCount,
        overrideDecision: nextDecision,
        overrideTargetCadenceMs: nextCadenceMs,
        overrideReason: overrideActive ? (nextReason ?? "operator-override") : null,
        overrideUpdatedAt: updatedAt,
        overrideUpdatedBy: updatedBy,
      };

      const supabase = getSupabaseAdminClient();
      let persisted = false;
      if (supabase) {
        await supabase.from("source_health").upsert(buildPersistedSourceHealthRows([nextStatus])).throwOnError();
        persisted = true;
      }

      upsertSourceStatus(nextStatus);
      res.json({
        sourceStatus: nextStatus,
        persisted,
      });
    }),
  );

  // --- Data sources ---
  app.get(
    "/api/ops/data-sources",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(500).json({ error: "Supabase not configured" });
        return;
      }
      const { data, error } = await supabase.from("operator_data_sources").select("*").order("created_at", { ascending: false });
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.json({ data_sources: data ?? [] });
    }),
  );

  app.post(
    "/api/ops/data-sources",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(500).json({ error: "Supabase not configured" });
        return;
      }
      const body = req.body as { name?: unknown; type?: unknown; endpoint_url?: unknown; config?: unknown; enabled?: unknown };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const type = typeof body.type === "string" && DATA_SOURCE_TYPES.includes(body.type as (typeof DATA_SOURCE_TYPES)[number]) ? body.type : "custom_url";
      const endpoint_url = typeof body.endpoint_url === "string" ? body.endpoint_url.trim() || null : null;
      const config = body.config != null && typeof body.config === "object" ? body.config : null;
      const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const row = {
        name,
        type,
        endpoint_url,
        config,
        enabled,
        updated_at: new Date().toISOString(),
        created_by: req.auth?.userId ?? null,
      };
      const { data, error } = await supabase.from("operator_data_sources").insert(row).select().single();
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.status(201).json(data);
    }),
  );

  app.patch(
    "/api/ops/data-sources/:id",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(500).json({ error: "Supabase not configured" });
        return;
      }
      const id = (req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const body = req.body as { name?: unknown; type?: unknown; endpoint_url?: unknown; config?: unknown; enabled?: unknown };
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string") updates.name = body.name.trim();
      if (typeof body.type === "string" && DATA_SOURCE_TYPES.includes(body.type as (typeof DATA_SOURCE_TYPES)[number])) updates.type = body.type;
      if (body.endpoint_url !== undefined) updates.endpoint_url = typeof body.endpoint_url === "string" ? body.endpoint_url.trim() || null : null;
      if (body.config !== undefined) updates.config = body.config != null && typeof body.config === "object" ? body.config : null;
      if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
      const { data, error } = await supabase.from("operator_data_sources").update(updates).eq("id", id).select().single();
      if (error) {
        res.status(error.code === "PGRST116" ? 404 : 500).json({ error: error.message });
        return;
      }
      res.json(data);
    }),
  );

  app.delete(
    "/api/ops/data-sources/:id",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(500).json({ error: "Supabase not configured" });
        return;
      }
      const id = (req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const { error } = await supabase.from("operator_data_sources").delete().eq("id", id);
      if (error) {
        res.status(error.code === "PGRST116" ? 404 : 500).json({ error: error.message });
        return;
      }
      res.status(204).send();
    }),
  );

  // --- Satellite hardware ---
  app.get(
    "/api/ops/satellite-hardware",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(500).json({ error: "Supabase not configured" });
        return;
      }
      const { data, error } = await supabase.from("operator_satellite_hardware").select("*").order("created_at", { ascending: false });
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.json({ satellite_hardware: data ?? [] });
    }),
  );

  app.post(
    "/api/ops/satellite-hardware",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(500).json({ error: "Supabase not configured" });
        return;
      }
      const body = req.body as { name?: unknown; type?: unknown; data_source_id?: unknown; connection_hint?: unknown; enabled?: unknown };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const type = typeof body.type === "string" && HARDWARE_TYPES.includes(body.type as (typeof HARDWARE_TYPES)[number]) ? body.type : "telemetry_source";
      const data_source_id = typeof body.data_source_id === "string" ? body.data_source_id.trim() || null : null;
      const connection_hint = typeof body.connection_hint === "string" ? body.connection_hint.trim() || null : null;
      const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const row = {
        name,
        type,
        data_source_id,
        connection_hint,
        enabled,
        updated_at: new Date().toISOString(),
        created_by: req.auth?.userId ?? null,
      };
      const { data, error } = await supabase.from("operator_satellite_hardware").insert(row).select().single();
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.status(201).json(data);
    }),
  );

  app.patch(
    "/api/ops/satellite-hardware/:id",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(500).json({ error: "Supabase not configured" });
        return;
      }
      const id = (req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const body = req.body as { name?: unknown; type?: unknown; data_source_id?: unknown; connection_hint?: unknown; enabled?: unknown };
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string") updates.name = body.name.trim();
      if (typeof body.type === "string" && HARDWARE_TYPES.includes(body.type as (typeof HARDWARE_TYPES)[number])) updates.type = body.type;
      if (body.data_source_id !== undefined) updates.data_source_id = typeof body.data_source_id === "string" ? body.data_source_id.trim() || null : null;
      if (body.connection_hint !== undefined) updates.connection_hint = typeof body.connection_hint === "string" ? body.connection_hint.trim() || null : null;
      if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
      const { data, error } = await supabase.from("operator_satellite_hardware").update(updates).eq("id", id).select().single();
      if (error) {
        res.status(error.code === "PGRST116" ? 404 : 500).json({ error: error.message });
        return;
      }
      res.json(data);
    }),
  );

  app.delete(
    "/api/ops/satellite-hardware/:id",
    op,
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const supabase = getSupabaseAdminClient();
      if (!supabase) {
        res.status(500).json({ error: "Supabase not configured" });
        return;
      }
      const id = (req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const { error } = await supabase.from("operator_satellite_hardware").delete().eq("id", id);
      if (error) {
        res.status(error.code === "PGRST116" ? 404 : 500).json({ error: error.message });
        return;
      }
      res.status(204).send();
    }),
  );
}
