import { Router, type Response, type Request } from "express";
import {
    requireRole,
    requireClearance,
} from "../middleware/auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import { getSupabaseAdminClient } from "../supabase.js";
import { type CyberTigerDaemon } from "../cybertiger/daemon.js";

export function mountSecurityRoutes(app: Router, deps: {
    cyberTiger: CyberTigerDaemon;
}) {
    const { cyberTiger } = deps;

    app.get("/api/security/cybertiger/status", requireRole("operator"), (_req: AuthenticatedRequest, res: Response) => {
        res.json({
            timestamp: new Date().toISOString(),
            status: cyberTiger.getStatus(),
        });
    });

    app.get(
        "/api/admin/users",
        requireRole("admin"),
        withAsyncMiddleware(async (_req: AuthenticatedRequest, res) => {
            const supabase = getSupabaseAdminClient();
            if (!supabase) {
                res.status(500).json({ error: "Supabase admin credentials not configured" });
                return;
            }
            const perPage = Math.max(1, Math.min(Number(process.env.ADMIN_USERS_PAGE_SIZE ?? 100), 500));
            const all: Array<{ id: string; email: string | null; createdAt: string; role?: string }> = [];
            for (let page = 1; page <= 20; page += 1) {
                const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
                if (error) {
                    res.status(500).json({ error: error.message });
                    return;
                }
                const users = data?.users ?? [];
                for (const u of users) {
                    const role =
                        typeof (u.app_metadata as Record<string, unknown>)?.role === "string"
                            ? ((u.app_metadata as Record<string, unknown>).role as string)
                            : undefined;
                    all.push({
                        id: u.id,
                        email: u.email ?? null,
                        createdAt: u.created_at ?? new Date().toISOString(),
                        role,
                    });
                }
                if (users.length < perPage) break;
            }
            res.json({ users: all });
        }),
    );

    app.get(
        "/api/security/cybertiger/events",
        requireRole("admin"),
        requireClearance("restricted"),
        (req: AuthenticatedRequest, res) => {
            const limit = Math.max(1, Math.min(Number(req.query.limit ?? 200), 2000));
            res.json({
                timestamp: new Date().toISOString(),
                count: limit,
                events: cyberTiger.getEvents(limit),
            });
        });

    app.post(
        "/api/security/cybertiger/block",
        requireRole("admin"),
        requireClearance("restricted"),
        (req: AuthenticatedRequest, res) => {
            const input = req.body as { ip?: string; reason?: string; seconds?: number };
            const ip = (input.ip ?? "").trim();
            if (!ip) {
                res.status(400).json({ error: "Missing ip" });
                return;
            }
            const reason = (input.reason ?? "manual-admin-action").trim();
            const seconds = Number(input.seconds);
            cyberTiger.blockIp(
                ip,
                reason.length > 0 ? reason : "manual-admin-action",
                Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
                {
                    actorRole: req.auth?.role,
                    actorUserId: req.auth?.userId,
                },
            );
            res.json({ ok: true, ip, reason, seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null });
        });

    app.post(
        "/api/security/cybertiger/unblock",
        requireRole("admin"),
        requireClearance("restricted"),
        (req: AuthenticatedRequest, res) => {
            const input = req.body as { ip?: string };
            const ip = (input.ip ?? "").trim();
            if (!ip) {
                res.status(400).json({ error: "Missing ip" });
                return;
            }
            const removed = cyberTiger.unblockIp(ip, {
                actorRole: req.auth?.role,
                actorUserId: req.auth?.userId,
            });
            res.json({ ok: removed, ip });
        });
}
