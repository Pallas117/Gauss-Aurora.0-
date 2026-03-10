import type { Response } from "express";
import express from "express";
import {
    getSupabaseAdminClient
} from "../supabase.js";
import type { AuthenticatedRequest } from "../auth.js";
import { withAsyncMiddleware } from "../middleware/async.js";
import { authenticateRequest } from "../middleware/auth.js";

export function mountOnboardingRoutes(app: express.Application): void {
    const router = express.Router();
    router.use(authenticateRequest);

    router.get("/", withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const auth = req.auth;
        if (!auth?.userId) {
            res.status(401).json({ error: "Sign in required" });
            return;
        }
        const supabase = getSupabaseAdminClient();
        if (!supabase) {
            res.status(500).json({ error: "Onboarding service unavailable" });
            return;
        }
        const { data, error } = await supabase
            .from("user_onboarding")
            .select("device_step_done, plan_step_done, completed_at")
            .eq("user_id", auth.userId)
            .maybeSingle();
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        const deviceStepDone = data?.device_step_done ?? false;
        const planStepDone = data?.plan_step_done ?? false;
        const completed = Boolean(data?.completed_at);
        res.json({
            deviceStepDone,
            planStepDone,
            completed,
            completedAt: data?.completed_at ?? null,
        });
    }));

    router.patch("/", withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const auth = req.auth;
        if (!auth?.userId) {
            res.status(401).json({ error: "Sign in required" });
            return;
        }
        const body = req.body as { deviceStepDone?: boolean; planStepDone?: boolean; complete?: boolean };
        const supabase = getSupabaseAdminClient();
        if (!supabase) {
            res.status(500).json({ error: "Onboarding service unavailable" });
            return;
        }
        const now = new Date().toISOString();
        const { data: existing } = await supabase
            .from("user_onboarding")
            .select("user_id, device_step_done, plan_step_done, completed_at")
            .eq("user_id", auth.userId)
            .maybeSingle();
        const deviceStepDone = body.deviceStepDone ?? existing?.device_step_done ?? false;
        const planStepDone = body.planStepDone ?? existing?.plan_step_done ?? false;
        const complete = Boolean(body.complete);
        const completedAt = complete ? now : (existing?.completed_at ?? null);
        const { data, error } = await supabase
            .from("user_onboarding")
            .upsert(
                {
                    user_id: auth.userId,
                    device_step_done: deviceStepDone,
                    plan_step_done: planStepDone,
                    completed_at: completedAt,
                    updated_at: now,
                },
                { onConflict: "user_id" }
            )
            .select("device_step_done, plan_step_done, completed_at")
            .single();
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        res.json({
            deviceStepDone: data.device_step_done,
            planStepDone: data.plan_step_done,
            completed: Boolean(data.completed_at),
            completedAt: data.completed_at,
        });
    }));

    app.use("/api/auth/onboarding", router);
}
