import type { Router, Response } from "express";
import { requireClearance, requireRole } from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import type { AuthenticatedRequest } from "../auth.js";
import { getLatestCanonical } from "../state.js";
import { isTuringPoolEnabled } from "../turing/pool.js";
import { getTuringAutoscaler, toTuringAutoscaleWirePlan } from "../turing/autoscaler.js";
import { buildFleetCoverageVerdict, buildFleetExposureAssessments, buildRiskActivity, countFreshRadiationFeeds, spaceWeatherState } from "./ssa.js";
import {
  drainRadiationWorkQueue,
  enqueueRadiationWork,
  getRadiationWorkCapacitySnapshot,
  getRadiationWorkJob,
  getRadiationWorkSummary,
  listRadiationWorkJobs,
  type RadiationWorkRequest,
} from "../turing/radiation-work.js";

function requireTuringPool(res: Response): boolean {
  if (isTuringPoolEnabled()) return true;
  res.status(503).json({ error: "Turing pool is disabled" });
  return false;
}

/** Operator control plane for sharing bounded radiation-analysis work. */
export function mountRadiationWorkRoutes(app: Router): void {
  app.get(
    "/api/ops/turing/radiation/risk-activity",
    requireRole("operator"),
    requireClearance("mission"),
    withAsyncMiddleware(async (_req: AuthenticatedRequest, res: Response) => {
      if (!requireTuringPool(res)) return;
      const { snapshot, assessments, profiles } = await buildFleetExposureAssessments();
      const riskActivity = buildRiskActivity(assessments, 50);
      const fleetReadiness = buildFleetCoverageVerdict({
        catalog: {
          available: snapshot !== null,
          complete: snapshot?.coverage.complete ?? false,
          truncated: snapshot?.coverage.truncated ?? true,
          sourceFailures: snapshot?.coverage.sourceFailures ?? [],
          fetchedAt: snapshot?.coverage.fetchedAt ?? null,
        },
        assessments,
        profiles,
      });
      const queueDepth = riskActivity.candidateCount;
      const autoscalerPlan = await getTuringAutoscaler().runOnce(queueDepth);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ok: true,
        protocol: riskActivity.protocol,
        generated_at: new Date().toISOString(),
        monitoring: {
          monitored_objects: riskActivity.monitoredObjects,
          state_counts: riskActivity.stateCounts,
          candidate_count: riskActivity.candidateCount,
          candidate_limit: riskActivity.candidateLimit,
          system_counts: riskActivity.systemCounts,
          critical_system_count: riskActivity.criticalSystemCount,
          high_system_count: riskActivity.highSystemCount,
          candidates: riskActivity.candidates,
          scope: "authenticated_fleet_screening",
          catalog_available: snapshot !== null,
          approved_profiles: profiles.length,
        },
        source_evidence: {
          environment_state: spaceWeatherState(getLatestCanonical()),
          environment_observed_at: getLatestCanonical()?.timestamp ?? null,
          fresh_radiation_feed_count: countFreshRadiationFeeds(getLatestCanonical()),
          catalog_complete: snapshot?.coverage.complete ?? false,
          catalog_truncated: snapshot?.coverage.truncated ?? true,
          catalog_source_failures: snapshot?.coverage.sourceFailures ?? [],
          readiness: fleetReadiness,
        },
        work_exchange: {
          protocol: "gauss-radiation-work-v1",
          queued_jobs: getRadiationWorkSummary().queued,
          admission: "observe_only",
          raw_payload_dispatch: false,
          note: "Risk candidates are measured for capacity planning; explicit operator admission is required before creating radiation work.",
        },
        autoscaler: toTuringAutoscaleWirePlan(autoscalerPlan),
        limitations: [
          "Public catalog screening is not proof of complete operational-fleet identity.",
          "Risk candidates are environmental screening signals, not spacecraft dose, damage, or failure probabilities.",
          "This endpoint does not issue spacecraft commands or automatically enqueue mission work.",
        ],
      });
    }),
  );

  app.get(
    "/api/ops/turing/radiation/work",
    requireRole("operator"),
    (_req: AuthenticatedRequest, res: Response) => {
      if (!requireTuringPool(res)) return;
      const rawLimit = Number.parseInt(String(_req.query.limit ?? "50"), 10);
      res.json({
        ok: true,
        summary: getRadiationWorkSummary(),
        jobs: listRadiationWorkJobs(Number.isFinite(rawLimit) ? rawLimit : 50),
      });
    },
  );

  app.get(
    "/api/ops/turing/radiation/capacity",
    requireRole("operator"),
    (_req: AuthenticatedRequest, res: Response) => {
      if (!requireTuringPool(res)) return;
      res.json({
        ok: true,
        protocol: "gauss-radiation-work-v1",
        capacity: getRadiationWorkCapacitySnapshot(),
        generated_at: new Date().toISOString(),
      });
    },
  );

  app.post(
    "/api/ops/turing/radiation/work/drain",
    requireRole("operator"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
      if (!requireTuringPool(res)) return;
      const body = (req.body ?? {}) as { max_jobs?: number };
      const maxJobs = typeof body.max_jobs === "number" && Number.isFinite(body.max_jobs)
        ? Math.max(1, Math.min(16, Math.floor(body.max_jobs)))
        : undefined;
      const drain = await drainRadiationWorkQueue(maxJobs);
      res.json({ ok: true, drain, summary: getRadiationWorkSummary() });
    }),
  );

  app.post(
    "/api/ops/turing/radiation/work",
    requireRole("operator"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
      if (!requireTuringPool(res)) return;
      const body = (req.body ?? {}) as Partial<RadiationWorkRequest> & { dispatch?: boolean };
      try {
        const job = enqueueRadiationWork({
          samples: Array.isArray(body.samples) ? body.samples : [],
          source: body.source,
          window_start: body.window_start,
          window_end: body.window_end,
          priority: body.priority,
          required_memory_mb: body.required_memory_mb,
          min_battery_percent: body.min_battery_percent,
          max_attempts: body.max_attempts,
        });
        const dispatch = body.dispatch !== false
          ? await drainRadiationWorkQueue(1)
          : null;
        res.status(202).json({
          ok: true,
          job: getRadiationWorkJob(job.id) ?? job,
          dispatch,
          summary: getRadiationWorkSummary(),
        });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid radiation work request" });
      }
    }),
  );

  app.get(
    "/api/ops/turing/radiation/work/:id",
    requireRole("operator"),
    (_req: AuthenticatedRequest, res: Response) => {
      if (!requireTuringPool(res)) return;
      const job = getRadiationWorkJob(String(_req.params.id ?? ""));
      if (!job) {
        res.status(404).json({ error: "Radiation work item not found" });
        return;
      }
      res.json({ ok: true, job });
    },
  );
}
