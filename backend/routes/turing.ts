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
    getTuringDevicePort,
    getDeviceById,
    generateJoinCode,
    hasValidJoinCode,
    register as registerTuringDevice,
    heartbeat as heartbeatTuringDevice,
    approveDevice,
    revokeDevice,
    removeDevice,
} from "../turing/pool.js";
import type { TuringDeviceRegistration, TuringHeartbeat } from "../turing/types.js";
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

function getTuringRegisterSecret(): string {
    return (process.env.TURING_REGISTER_SECRET ?? "").trim();
}

function requestTuringSecret(req: Request): string {
    const bodySecret = typeof req.body?.secret === "string" ? req.body.secret.trim() : "";
    return (req.header("x-turing-secret") ?? bodySecret).trim();
}

function hasValidTuringSecret(req: Request): boolean {
    const configured = getTuringRegisterSecret();
    if (!configured) {
        return true;
    }
    return requestTuringSecret(req) === configured;
}

function deviceBaseUrl(tailscaleIp: string): string {
    const port = getTuringDevicePort();
    return `http://${tailscaleIp}:${port}`;
}

export function mountTuringRoutes(app: Router) {
    app.post("/api/turing/register", (req: Request, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }

        const body = (req.body ?? {}) as Partial<TuringDeviceRegistration>;
        const joinCode = typeof body.join_code === "string" ? body.join_code.trim() : "";
        if (getTuringRegisterSecret() && !hasValidTuringSecret(req) && !hasValidJoinCode(joinCode)) {
            res.status(403).json({ error: "Valid join code or Turing secret required" });
            return;
        }

        try {
            const registration: TuringDeviceRegistration = {
                hostname: typeof body.hostname === "string" ? body.hostname : "",
                tailscale_ip: typeof body.tailscale_ip === "string" ? body.tailscale_ip : "",
                ram_mb: typeof body.ram_mb === "number" ? body.ram_mb : undefined,
                capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined,
                join_code: joinCode || undefined,
            };
            const result = registerTuringDevice(registration);
            res.status(201).json(result);
        } catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : "Invalid registration" });
        }
    });

    app.post("/api/turing/heartbeat", (req: Request, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        if (!hasValidTuringSecret(req)) {
            res.status(403).json({ error: "Valid Turing secret required" });
            return;
        }
        const body = (req.body ?? {}) as Partial<TuringHeartbeat>;
        const result = heartbeatTuringDevice(body);
        if (!result.ok || !result.id) {
            res.status(404).json({ error: "Device not found" });
            return;
        }
        res.json(result);
    });

    app.post("/api/turing/join-code", requireRole("operator"), (_req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        res.json(generateJoinCode());
    });

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

    app.post("/api/turing/devices/:id/approve", requireRole("operator"), (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const deviceId = String(req.params.id ?? "").trim();
        if (!approveDevice(deviceId)) {
            res.status(404).json({ error: "Device not found" });
            return;
        }
        res.json({ ok: true, id: deviceId });
    });

    app.post("/api/turing/devices/:id/revoke", requireRole("operator"), (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const deviceId = String(req.params.id ?? "").trim();
        if (!revokeDevice(deviceId)) {
            res.status(404).json({ error: "Device not found" });
            return;
        }
        res.json({ ok: true, id: deviceId });
    });

    app.delete("/api/turing/devices/:id", requireRole("operator"), (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const deviceId = String(req.params.id ?? "").trim();
        if (!removeDevice(deviceId)) {
            res.status(404).json({ error: "Device not found" });
            return;
        }
        res.status(204).send();
    });

    app.get("/api/turing/devices/:id/health", requireRole("operator"), withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const deviceId = String(req.params.id ?? "").trim();
        const device = getDeviceById(deviceId);
        if (!device) {
            res.status(404).json({ error: "Device not found" });
            return;
        }
        try {
            const response = await fetch(`${deviceBaseUrl(device.tailscale_ip)}/health`, {
                signal: AbortSignal.timeout(3_000),
            });
            if (!response.ok) {
                res.status(502).json({ error: "Device health unreachable" });
                return;
            }
            const payload = await response.json();
            res.json({
                device_id: device.id,
                ...payload,
            });
        } catch {
            res.status(502).json({ error: "Device health unreachable" });
        }
    }));

    app.post("/api/turing/devices/:id/heal", requireRole("operator"), withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        if (!isTuringPoolEnabled()) {
            res.status(503).json({ error: "Turing pool is disabled" });
            return;
        }
        const deviceId = String(req.params.id ?? "").trim();
        const device = getDeviceById(deviceId);
        if (!device) {
            res.status(404).json({ error: "Device not found" });
            return;
        }
        try {
            const response = await fetch(`${deviceBaseUrl(device.tailscale_ip)}/heal`, {
                method: "POST",
                signal: AbortSignal.timeout(3_000),
            });
            if (!response.ok) {
                res.status(502).json({ error: "Device heal unreachable" });
                return;
            }
            const payload = await response.json();
            res.json({
                device_id: device.id,
                ...payload,
            });
        } catch {
            res.status(502).json({ error: "Device heal unreachable" });
        }
    }));

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
