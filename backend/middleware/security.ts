import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../auth.js";
import type { CyberTigerDaemon } from "../cybertiger/daemon.js";

/**
 * Middleware to set security-related HTTP headers.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    next();
}

/**
 * Custom request type for CyberTiger inspection.
 */
export type CyberTigerRequest = AuthenticatedRequest & {
    security?: {
        requestId: string;
        ip: string;
        startedAtMs: number;
        path: string;
        method: string;
    };
};

/**
 * Middleware factory for CyberTiger request inspection and response recording.
 */
export function createCyberTigerMiddleware(cyberTiger: CyberTigerDaemon) {
    return (req: Request, res: Response, next: NextFunction) => {
        const start = Date.now();
        const decision = cyberTiger.inspectRequest(req);
        const tracked = req as CyberTigerRequest;

        tracked.security = {
            requestId: decision.requestId,
            ip: decision.ip,
            startedAtMs: start,
            path: req.originalUrl ?? req.url,
            method: req.method,
        };
        res.setHeader("x-request-id", decision.requestId);

        res.on("finish", () => {
            const detail = tracked.security;
            if (!detail) return;
            cyberTiger.recordResponse({
                requestId: detail.requestId,
                ip: detail.ip,
                method: detail.method,
                path: detail.path,
                status: res.statusCode,
                role: tracked.auth?.role,
                userId: tracked.auth?.userId,
                latencyMs: Date.now() - detail.startedAtMs,
            });
        });

        if (!decision.allowed) {
            res.status(decision.status ?? 429).json({
                error: decision.message ?? "Blocked by CyberTiger",
                requestId: decision.requestId,
            });
            return;
        }
        next();
    };
}
