import type { Router, Response } from "express";
import { requireRole } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../auth.js";
import { getMeshStatus } from "../mesh/config.js";

/** Read-only discovery for the optional cloud-independent mesh contract. */
export function mountMeshRoutes(app: Router): void {
  app.get(
    "/api/ops/mesh/status",
    requireRole("operator"),
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({ ok: true, ...getMeshStatus(), generated_at: new Date().toISOString() });
    },
  );
}
