import { Router, type Response } from "express";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import {
    getRiskZones,
    getSatelliteObjects,
} from "../state.js";
import { getSpaceDomainSnapshot } from "../ssa/space-domain-store.js";
import { buildSpaceDomainSummary } from "../ssa/ssa-features.js";
import { toPublicSpaceDomainSnapshot } from "../ssa/space-domain-public.js";

export function mountSsaRoutes(app: Router) {
    app.get("/api/ssa/risk-zones", (_req: AuthenticatedRequest, res: Response) => {
        const snapshot = getRiskZones();
        // Cache 5 min server-side to avoid repeated external calls when ingest is the source
        res.setHeader("Cache-Control", "public, max-age=300");
        if (!snapshot) {
            res.json({ riskZones: [], updatedAt: new Date().toISOString() });
            return;
        }
        res.json(snapshot);
    });

    app.get("/api/ssa/satellites", (_req: AuthenticatedRequest, res: Response) => {
        const snapshot = getSatelliteObjects();
        res.setHeader("Cache-Control", "public, max-age=300");
        if (!snapshot) {
            res.json({
                objects: [],
                highValue: [],
                unidentified: [],
                updatedAt: new Date().toISOString(),
            });
            return;
        }
        res.json(snapshot);
    });

    app.get("/api/ssa/space-domain", (_req: AuthenticatedRequest, res: Response) => {
        const snapshot = getSpaceDomainSnapshot();
        res.setHeader("Cache-Control", "public, max-age=60");
        res.json({
            snapshot: toPublicSpaceDomainSnapshot(snapshot),
            summary: buildSpaceDomainSummary(snapshot),
        });
    });
}
