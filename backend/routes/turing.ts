import { Router, type Response, type Request } from "express";
import {
    requireRole,
} from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import {
    isTuringPoolEnabled,
    getDevices as turingGetDevices,
    getSummary as turingGetSummary,
} from "../turing/pool.js";
import {
    proxyCacheGet,
    proxyCacheSet,
    proxyCacheDelete,
} from "../turing/cache-proxy.js";
import {
    type ComputeJobType,
    dispatchComputeJob,
    getComputeJobStatus,
} from "../turing/compute-dispatcher.js";

export function mountTuringRoutes(app: Router) {
    // Turing pool: device list and summary (authenticated)
    app.get("/api/turing/devices", (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const devices = turingGetDevices();
        res.json({
            devices,
            generated_at: new Date().toISOString(),
        });
    });

    app.get("/api/turing/devices/summary", (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const summary = turingGetSummary();
        res.json({
            ...summary,
            generated_at: new Date().toISOString(),
        });
    });

    app.get("/api/ops/turing/devices", requireRole("operator"), (_req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const devices = turingGetDevices();
        res.json({
            devices,
            generated_at: new Date().toISOString(),
        });
    });

    // Turing pool: cache proxy (authenticated)
    app.post("/api/turing/cache", withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const body = req.body as { key?: string; value?: unknown; ttl_sec?: number; preferred_device_id?: string };
        const key = typeof body.key === "string" ? body.key.trim() : "";
        if (!key) {
            res.status(400).json({ error: "key is required" });
            return;
        }
        const result = await proxyCacheSet(
            key,
            body.value,
            typeof body.ttl_sec === "number" ? body.ttl_sec : undefined,
            body.preferred_device_id ?? null
        );
        if (!result) {
            res.status(503).json({ error: "No healthy cache-capable device" });
            return;
        }
        res.json({ device_id: result.device_id, key });
    }));

    app.get("/api/turing/cache/:key", withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const key = String(req.params.key ?? "").trim();
        const preferredDeviceId = typeof req.query.preferred_device_id === "string" ? req.query.preferred_device_id : null;
        const result = await proxyCacheGet(key, preferredDeviceId);
        if (!result) {
            res.status(404).json({ error: "Not found or no device" });
            return;
        }
        res.json({ ...result, key });
    }));

    app.delete("/api/turing/cache/:key", withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const key = String(req.params.key ?? "").trim();
        const preferredDeviceId = typeof req.query.preferred_device_id === "string" ? req.query.preferred_device_id : null;
        const ok = await proxyCacheDelete(key, preferredDeviceId);
        res.status(ok ? 204 : 503).send();
    }));

    // Turing pool: compute dispatch (operator)
    app.post("/api/turing/compute", requireRole("operator"), withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const body = req.body as { type?: string; payload?: unknown; preferred_device_id?: string };
        const allowed: ComputeJobType[] = [
            "inference",
            "batch",
            "surya_forecast",
            "surya_flare",
            "surya_finetune",
            "nowcast_retrain",
        ];
        const type: ComputeJobType =
            typeof body.type === "string" && allowed.includes(body.type as ComputeJobType)
                ? (body.type as ComputeJobType)
                : "batch";
        const result = await dispatchComputeJob(type, body.payload ?? {}, body.preferred_device_id ?? null);
        if (!result) {
            res.status(503).json({ error: "No healthy compute-capable device" });
            return;
        }
        res.json({
            device_id: result.device_id,
            job_id: result.job_id,
            response: result.response,
        });
    }));

    app.get("/api/turing/compute/job/:deviceId/:jobId", requireRole("operator"), withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const deviceId = String(req.params.deviceId ?? "").trim();
        const jobId = String(req.params.jobId ?? "").trim();
        const status = await getComputeJobStatus(deviceId, jobId);
        if (!status) {
            res.status(404).json({ error: "Job not found or device unreachable" });
            return;
        }
        res.json(status);
    }));
}
