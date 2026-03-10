import type { Request, Response } from "express";
import express from "express";
import {
    isAuthRequired,
    isVerifiedEmailRequired,
    getTokenFromRequest,
    resolveAuthRoleFromMetadata,
    resolveAuthClearanceFromMetadata,
    getSessionFeatures
} from "../auth.js";
import { getSupabaseAdminClient } from "../supabase.js";

export function mountAuthRoutes(app: express.Application): void {
    const router = express.Router();

    router.get("/session", async (req: Request, res: Response) => {
        const authRequired = isAuthRequired();
        if (!authRequired) {
            res.json({
                authRequired: false,
                authenticated: true,
                role: "admin",
                clearance: "restricted",
                userId: "development",
                email: null,
                emailVerified: true,
                message: "Development auth bypass active",
                features: { heliophysics: true, debris: true },
            });
            return;
        }

        const token = getTokenFromRequest(req);
        if (!token) {
            res.json({
                authRequired: true,
                authenticated: false,
                role: null,
                clearance: null,
                userId: null,
                email: null,
                emailVerified: false,
                features: { heliophysics: false, debris: false },
            });
            return;
        }

        const supabase = getSupabaseAdminClient();
        if (!supabase) {
            res.status(500).json({
                authRequired: true,
                authenticated: false,
                role: null,
                clearance: null,
                userId: null,
                email: null,
                emailVerified: false,
                features: { heliophysics: false, debris: false },
                error: "Supabase admin credentials not configured",
            });
            return;
        }

        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) {
            res.json({
                authRequired: true,
                authenticated: false,
                role: null,
                clearance: null,
                userId: null,
                email: null,
                emailVerified: false,
                features: { heliophysics: false, debris: false },
            });
            return;
        }

        const role = resolveAuthRoleFromMetadata(data.user);
        const clearance = resolveAuthClearanceFromMetadata(data.user);
        const emailVerified = Boolean(data.user.email_confirmed_at);
        const requireVerifiedEmail = isVerifiedEmailRequired();
        const effectiveRole = (!requireVerifiedEmail || emailVerified) ? role : null;
        const email = data.user.email ?? null;
        const features = getSessionFeatures(effectiveRole, email);

        res.json({
            authRequired: true,
            authenticated: !requireVerifiedEmail || emailVerified,
            role: effectiveRole,
            clearance: (!requireVerifiedEmail || emailVerified) ? clearance : null,
            userId: (!requireVerifiedEmail || emailVerified) ? data.user.id : null,
            email,
            emailVerified,
            message: (requireVerifiedEmail && !emailVerified) ? "Verify your email to unlock protected mission feeds." : undefined,
            features,
        });
    });

    router.post("/signup", async (req: Request, res: Response) => {
        const supabase = getSupabaseAdminClient();
        if (!supabase) {
            res.status(500).json({ error: "Auth service not configured" });
            return;
        }

        const { email, password, data } = req.body;
        if (!email || !password) {
            res.status(400).json({ error: "email and password required" });
            return;
        }

        try {
            const { data: signUpData, error } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: !isVerifiedEmailRequired(),
                user_metadata: data || {},
            });
            
            if (error || !signUpData.user) {
                res.status(400).json({ error: error?.message || "Signup failed" });
                return;
            }

            res.json({
                user: {
                    id: signUpData.user.id,
                    email: signUpData.user.email,
                    email_confirmed_at: signUpData.user.email_confirmed_at,
                    user_metadata: signUpData.user.user_metadata,
                },
            });
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : "Signup error" });
        }
    });

    router.post("/signin", async (req: Request, res: Response) => {
        const supabase = getSupabaseAdminClient();
        if (!supabase) {
            res.status(500).json({ error: "Auth service not configured" });
            return;
        }

        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ error: "email and password required" });
            return;
        }

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            
            if (error || !data.session) {
                res.status(401).json({ error: error?.message || "Signin failed" });
                return;
            }

            res.json({
                session: {
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token || "",
                    user: {
                        id: data.user.id,
                        email: data.user.email,
                        email_confirmed_at: data.user.email_confirmed_at,
                        user_metadata: data.user.user_metadata,
                    },
                },
            });
        } catch (err) {
            res.status(500).json({ error: err instanceof Error ? err.message : "Signin error" });
        }
    });

    app.use("/api/auth", router);
}
