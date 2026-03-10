/**
 * Conjunction interoperability endpoints for CDM/OMM/OEM/OCM ingestion.
 * Includes ethical-purpose gating and bounded in-memory retention.
 */

import type { Response } from "express";
import express from "express";
import type { AuthenticatedRequest } from "../auth.js";
import {
  buildConjunctionRecord,
  ConjunctionInteropError,
} from "../ssa/conjunction-interop.js";
import { appendConjunctionRecord, getConjunctionEvents } from "../ssa/space-domain-store.js";
import { persistConjunctionRecord } from "../ssa/conjunction-store.js";

type MountDeps = {
  requireRole: (role: "viewer" | "operator" | "admin") => any;
  requireClearance: (level: "public" | "mission" | "restricted") => any;
  withAsyncMiddleware: (
    fn: (req: AuthenticatedRequest, res: Response, next: express.NextFunction) => Promise<void>,
  ) => any;
};

export function mountConjunctionInteropRoutes(app: express.Application, deps: MountDeps): void {
  const { requireRole, requireClearance, withAsyncMiddleware } = deps;

  app.post(
    "/api/ssa/conjunctions/ingest",
    requireRole("operator"),
    requireClearance("mission"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const body = req.body as {
        format?: unknown;
        content?: unknown;
        purpose?: unknown;
        source?: unknown;
      };

      try {
        const record = buildConjunctionRecord({
          format: body.format,
          content: body.content,
          purpose: body.purpose,
          source: body.source,
        });

        appendConjunctionRecord(record);
        const persisted = await persistConjunctionRecord(record).catch(() => false);
        const retained = getConjunctionEvents(200).length;

        res.status(201).json({
          ok: true,
          record,
          persisted,
          retained,
        });
      } catch (error) {
        if (error instanceof ConjunctionInteropError) {
          res.status(error.status).json({ error: error.message, code: error.code });
          return;
        }
        res.status(400).json({ error: "Invalid conjunction ingest payload", code: "invalid_payload" });
      }
    }),
  );

  app.get(
    "/api/ssa/conjunctions/latest",
    requireRole("operator"),
    requireClearance("mission"),
    withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50), 200));
      const events = getConjunctionEvents(limit);

      res.setHeader("Cache-Control", "no-store");
      res.json({
        timestamp: new Date().toISOString(),
        count: events.length,
        events,
      });
    }),
  );
}
