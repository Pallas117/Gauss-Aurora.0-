import type { Router, Response } from "express";
import { requireRole } from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import type { AuthenticatedRequest } from "../auth.js";
import { discoverNetworkAdapters } from "../network/adapters.js";

/** Read-only adapter discovery for this host and its observed Tailscale peers. */
export function mountNetworkRoutes(app: Router): void {
  app.get(
    "/api/ops/network/adapters",
    requireRole("operator"),
    withAsyncMiddleware(async (_req: AuthenticatedRequest, res: Response) => {
      const adapters = await discoverNetworkAdapters();
      res.json({
        ok: true,
        protocol: "gauss-network-adapters-v1",
        adapters,
        generated_at: new Date().toISOString(),
      });
    }),
  );
}
