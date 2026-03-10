import { Router, type Response } from "express";
import { withAsyncMiddleware } from "../middleware/async.js";
import { authenticateRequest } from "../middleware/auth.js";
import {
    type AuthenticatedRequest,
} from "../auth.js";
import Stripe from "stripe";

export function mountBillingRoutes(app: Router) {
    const stripeSecret = (process.env.STRIPE_SECRET_KEY ?? "").trim();
    const stripePriceIds: Record<string, string> = {
        student: (process.env.STRIPE_PRICE_STUDENT ?? "").trim(),
        professional: (process.env.STRIPE_PRICE_PROFESSIONAL ?? "").trim(),
        academic: (process.env.STRIPE_PRICE_ACADEMIC ?? "").trim(),
        operator: (process.env.STRIPE_PRICE_OPERATOR ?? "").trim(),
    };

    app.post("/api/stripe/create-checkout-session", authenticateRequest, withAsyncMiddleware(async (req: AuthenticatedRequest, res: Response) => {
        const auth = req.auth;
        if (!auth?.userId) {
            res.status(401).json({ error: "Sign in required" });
            return;
        }
        if (!stripeSecret) {
            res.status(503).json({ error: "Stripe is not configured. Set STRIPE_SECRET_KEY." });
            return;
        }
        const body = req.body as { planId?: string; pilot?: boolean };
        const planId = typeof body.planId === "string" ? body.planId : "";
        const priceId = stripePriceIds[planId];
        if (!priceId) {
            res.status(400).json({ error: "Invalid or missing planId. Use student, professional, academic, or operator." });
            return;
        }
        const pilot = Boolean(body.pilot);
        const origin = (req.header("origin") ?? req.header("referer") ?? "").replace(/\/$/, "") || undefined;
        const successUrl = (process.env.STRIPE_SUCCESS_URL ?? "").trim() || (origin ? `${origin}/onboarding?success=1` : undefined);
        const cancelUrl = (process.env.STRIPE_CANCEL_URL ?? "").trim() || (origin ? `${origin}/onboarding` : undefined);
        if (!successUrl || !cancelUrl) {
            res.status(500).json({ error: "Stripe success/cancel URLs not configured. Set STRIPE_SUCCESS_URL and STRIPE_CANCEL_URL or send Origin header." });
            return;
        }
        const stripe = new Stripe(stripeSecret);
        const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            line_items: [{ price: priceId, quantity: 1 }],
            subscription_data: pilot ? { trial_period_days: 90 } : undefined,
            success_url: successUrl,
            cancel_url: cancelUrl,
            client_reference_id: auth.userId,
        });
        res.json({ url: session.url ?? null });
    }));
}
