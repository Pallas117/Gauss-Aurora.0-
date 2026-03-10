import type { IncomingMessage } from "node:http";
import type { NextFunction, Response } from "express";
import { getSupabaseAdminClient } from "../supabase.js";
import {
    type AuthRole,
    type AuthClearance,
    type AuthContext,
    type AuthenticatedRequest,
    isAuthRequired,
    getTokenFromRequest,
    resolveAuthRoleFromMetadata,
    resolveAuthClearanceFromMetadata,
    roleSatisfies,
    clearanceSatisfies
} from "../auth.js";

/**
 * Middleware to authenticate a request using Supabase.
 */
export async function authenticateRequest(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const ok = await hydrateRequestAuth(req, res, false);
    if (!ok) {
        return;
    }
    next();
}

export async function authenticateRequestOptional(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const ok = await hydrateRequestAuth(req, res, true);
    if (!ok) {
        return;
    }
    next();
}

async function hydrateRequestAuth(
    req: AuthenticatedRequest,
    res: Response,
    allowAnonymous: boolean,
): Promise<boolean> {
    const serviceToken = (req.header("x-gauss-service-token") || "").trim();
    const authHeader = req.header("authorization") || "";
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

    const tokenToMatch = serviceToken || bearerToken;
    const configuredIngestToken = (process.env.ORCHESTRATOR_INGEST_API_TOKEN ?? "").trim();

    if (configuredIngestToken && tokenToMatch === configuredIngestToken) {
        req.auth = {
            userId: "orchestrator-service",
            email: null,
            role: "admin",
            clearance: "restricted",
            rawRoles: ["admin"],
            rawClearances: ["restricted"],
            emailVerified: true,
            token: tokenToMatch || "orchestrator-service",
        };
        return true;
    }

    if (!isAuthRequired()) {
        req.auth = {
            userId: "development",
            email: null,
            role: "admin",
            clearance: "restricted",
            rawRoles: ["admin"],
            rawClearances: ["restricted"],
            emailVerified: true,
            token: "dev-bypass",
        };
        return true;
    }

    const token = getTokenFromRequest(req);
    if (!token) {
        if (allowAnonymous) {
            return true;
        }
        res.status(401).json({ error: "Missing bearer token" });
        return false;
    }

    const supabase = getSupabaseAdminClient();
    if (!supabase) {
        res.status(500).json({ error: "Supabase admin credentials not configured" });
        return false;
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
        res.status(401).json({ error: "Invalid or expired token" });
        return false;
    }

    const emailVerified = Boolean(data.user.email_confirmed_at);
    const requireVerifiedEmail = (process.env.AUTH_REQUIRE_EMAIL_VERIFIED ?? "true").toLowerCase() !== "false";

    if (requireVerifiedEmail && !emailVerified) {
        res.status(401).json({ error: "Email verification required" });
        return false;
    }

    const role = resolveAuthRoleFromMetadata(data.user);
    const clearance = resolveAuthClearanceFromMetadata(data.user);

    req.auth = {
        userId: data.user.id,
        email: data.user.email ?? null,
        role,
        clearance,
        rawRoles: [role], // Simplification for context
        rawClearances: [clearance],
        emailVerified,
        token,
    };

    return true;
}

/**
 * Middleware to require a specific role.
 */
export function requireRole(minRole: AuthRole) {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.auth) {
            const ok = await hydrateRequestAuth(req, res, false);
            if (!ok) {
                return;
            }
        }
        const role = req.auth?.role;
        if (!role) {
            res.status(401).json({ error: "Missing auth context" });
            return;
        }
        if (!roleSatisfies(role, minRole)) {
            res.status(403).json({ error: `Requires ${minRole} role` });
            return;
        }
        next();
    };
}

/**
 * Middleware to require a specific clearance level.
 */
export function requireClearance(minClearance: AuthClearance) {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.auth) {
            const ok = await hydrateRequestAuth(req, res, false);
            if (!ok) {
                return;
            }
        }
        const clearance = req.auth?.clearance;
        if (!clearance) {
            res.status(401).json({ error: "Missing auth context" });
            return;
        }
        if (!clearanceSatisfies(clearance, minClearance)) {
            res.status(403).json({ error: `Requires ${minClearance} clearance` });
            return;
        }
        next();
    };
}

/**
 * Helper to authenticate WebSocket connections.
 */
export async function authenticateSocket(req: IncomingMessage): Promise<AuthContext | null> {
    if (!isAuthRequired()) {
        return {
            userId: "development",
            email: null,
            role: "admin",
            clearance: "restricted",
            rawRoles: ["admin"],
            rawClearances: ["restricted"],
            emailVerified: true,
            token: "dev-bypass",
        };
    }

    let token: string | null = null;
    const url = req.url ? new URL(req.url, "http://localhost") : null;
    if (url) {
        const qToken = url.searchParams.get("token");
        if (qToken && qToken.trim()) {
            token = qToken.trim();
        }
    }

    if (!token) {
        const authHeader = req.headers.authorization;
        if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
            token = authHeader.slice(7).trim();
        }
    }

    if (!token) return null;

    const supabase = getSupabaseAdminClient();
    if (!supabase) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;

    const role = resolveAuthRoleFromMetadata(data.user);
    const clearance = resolveAuthClearanceFromMetadata(data.user);

    return {
        userId: data.user.id,
        email: data.user.email ?? null,
        role,
        clearance,
        rawRoles: [role],
        rawClearances: [clearance],
        emailVerified: Boolean(data.user.email_confirmed_at),
        token,
    };
}
