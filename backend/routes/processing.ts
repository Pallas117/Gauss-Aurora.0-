import type { Router, Response } from "express";
import { requireRole } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../auth.js";
import { getProcessingStatus } from "../processing/mode.js";
import { getDataResidencyStatus } from "../security/data-residency.js";

/** Read-only contract consumed by the staff operations application. */
export function mountProcessingRoutes(app: Router): void {
  app.get(
    "/api/ops/processing/status",
    requireRole("operator"),
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({
        ok: true,
        ...getProcessingStatus(),
        data_residency: getDataResidencyStatus(),
        generated_at: new Date().toISOString(),
      });
    },
  );
}
