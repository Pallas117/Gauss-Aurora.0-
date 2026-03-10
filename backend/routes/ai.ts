import { Router, type Response, type Request } from "express";
import {
    requireRole,
    requireClearance,
} from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import { inferNowcast, triggerTraining } from "../ml-client/client.js";
import { getLatestCanonical } from "../state.js";
import { type NowcastInferenceRequest } from "../types.js";

export function mountAiRoutes(app: Router) {
    const SURYA_SERVICE_URL = (process.env.SURYA_SERVICE_URL ?? "").trim();

    app.post(
        "/api/ai/nowcast/infer",
        requireRole("operator"),
        requireClearance("mission"),
        async (req: AuthenticatedRequest, res: Response) => {
            try {
                const body = req.body as Partial<NowcastInferenceRequest>;
                const sequence = Array.isArray(body.sequence) ? body.sequence : [];
                const horizonMinutes = Math.max(5, Math.min(Number(body.horizonMinutes ?? 60), 180));

                if (sequence.length === 0) {
                    const current = getLatestCanonical();
                    if (!current) {
                        res.status(400).json({ error: "No sequence provided and no live feed available" });
                        return;
                    }
                    const fallbackResponse = await inferNowcast({
                        horizonMinutes,
                        sequence: [current],
                    });
                    res.json(fallbackResponse);
                    return;
                }

                const response = await inferNowcast({
                    horizonMinutes,
                    sequence,
                });
                res.json(response);
            } catch (error) {
                res.status(500).json({ error: error instanceof Error ? error.message : "Inference failed" });
            }
        });

    app.post(
        "/api/ai/nowcast/train",
        requireRole("admin"),
        requireClearance("restricted"),
        async (_req: Request, res: Response) => {
            try {
                const result = await triggerTraining();
                if (!result.started) {
                    res.status(500).json(result);
                    return;
                }
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error instanceof Error ? error.message : "Training trigger failed" });
            }
        });

    app.post(
        "/api/ai/surya/forecast",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
            if (SURYA_SERVICE_URL) {
                try {
                    const proxyRes = await fetch(`${SURYA_SERVICE_URL.replace(/\/$/, "")}/surya/forecast`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(req.body ?? {}),
                        signal: AbortSignal.timeout(30_000),
                    });
                    const data = await proxyRes.json().catch(() => ({}));
                    res.status(proxyRes.status).json(data);
                    return;
                } catch (err) {
                    const message = err instanceof Error ? err.message : "Surya service unavailable";
                    res.status(502).json({ error: "Surya proxy failed", detail: message, forecast: [], model: "surya.366m.v1", horizonHours: 0 });
                    return;
                }
            }
            res.status(501).json({
                forecast: [],
                model: "surya.366m.v1",
                horizonHours: 12,
            });
        }),
    );

    app.post(
        "/api/ai/surya/flare",
        requireRole("operator"),
        requireClearance("mission"),
        withAsyncMiddleware(async (req: AuthenticatedRequest, res) => {
            if (SURYA_SERVICE_URL) {
                try {
                    const proxyRes = await fetch(`${SURYA_SERVICE_URL.replace(/\/$/, "")}/surya/flare`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(req.body ?? {}),
                        signal: AbortSignal.timeout(15_000),
                    });
                    const data = await proxyRes.json().catch(() => ({}));
                    res.status(proxyRes.status).json(data);
                    return;
                } catch (err) {
                    const message = err instanceof Error ? err.message : "Surya service unavailable";
                    res.status(502).json({ error: "Surya proxy failed", detail: message, flare_probability_24h: 0, model: "surya.366m.v1" });
                    return;
                }
            }
            res.status(501).json({
                flare_probability_24h: 0,
                model: "surya.366m.v1",
            });
        }),
    );
}
