/**
 * Decoder status route: exposes packet decoder status (cap enforced in decoder-status module).
 */

import type { Request, Response } from "express";
import express from "express";
import { buildDecoderStatus } from "../decoder-status.js";

export type DecoderRoutesDeps = {
  requireRole: (role: "operator") => (req: Request, res: Response, next: () => void) => void;
};

export function mountDecoderRoutes(app: express.Application, deps: DecoderRoutesDeps): void {
  const router = express.Router();

  router.get("/status", deps.requireRole("operator"), (_req, res) => {
    res.json(buildDecoderStatus());
  });

  app.use("/api/ops/decoder", router);
}
