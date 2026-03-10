/**
 * Feedback routes: submit and list with in-memory cap (memory-safe for 8GB M1).
 */

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import express from "express";
import type { AuthenticatedRequest } from "../auth.js";
import { getSupabaseAdminClient } from "../supabase.js";

const MAX_FEEDBACK_EVENTS = 500;

type FeedbackCategory = "bug" | "feature" | "operations" | "security" | "billing";
type FeedbackSentiment = "positive" | "neutral" | "negative";

export type FeedbackEvent = {
  id: string;
  submittedAt: string;
  category: FeedbackCategory;
  sentiment: FeedbackSentiment;
  rating: number | null;
  message: string;
  contactEmail: string | null;
  page: string | null;
  auth: {
    userId: string | null;
    role: string | null;
    email: string | null;
  };
};

const feedbackEvents: FeedbackEvent[] = [];

function asFeedbackCategory(value: unknown): FeedbackCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "bug" ||
    normalized === "feature" ||
    normalized === "operations" ||
    normalized === "security" ||
    normalized === "billing"
  ) {
    return normalized;
  }
  return null;
}

function asFeedbackSentiment(value: unknown): FeedbackSentiment {
  if (typeof value !== "string") return "neutral";
  const normalized = value.trim().toLowerCase();
  if (normalized === "positive" || normalized === "negative") {
    return normalized;
  }
  return "neutral";
}

function normalizeMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 8) return null;
  return trimmed.slice(0, 1500);
}

function normalizeOptionalText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

const FAILURE_TYPES = ["crash", "error", "unhandledrejection", "exit"] as const;
function asFailureType(v: unknown): (typeof FAILURE_TYPES)[number] | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return FAILURE_TYPES.includes(t as (typeof FAILURE_TYPES)[number])
    ? (t as (typeof FAILURE_TYPES)[number])
    : null;
}
function truncate(s: string | null | undefined, max: number): string | null {
  if (s == null || typeof s !== "string") return null;
  const t = s.trim();
  return t.length ? t.slice(0, max) : null;
}

export type FeedbackRoutesDeps = {
  requireRole: (role: "viewer" | "operator") => (req: Request, res: Response, next: () => void) => void;
  feedbackEvents?: FeedbackEvent[];
};

export function mountFeedbackRoutes(app: express.Router, deps: FeedbackRoutesDeps): void {
  const router = express.Router();

  router.post("/", deps.requireRole("viewer"), (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      category?: unknown;
      sentiment?: unknown;
      rating?: unknown;
      message?: unknown;
      contactEmail?: unknown;
      page?: unknown;
    };

    const category = asFeedbackCategory(body.category);
    const message = normalizeMessage(body.message);
    if (!category || !message) {
      res.status(400).json({
        error: "Invalid feedback payload. category and message are required.",
      });
      return;
    }

    const ratingValue = Number(body.rating);
    const rating =
      Number.isFinite(ratingValue) && ratingValue >= 1 && ratingValue <= 5
        ? Math.round(ratingValue)
        : null;

    const feedbackEvent: FeedbackEvent = {
      id: randomUUID(),
      submittedAt: new Date().toISOString(),
      category,
      sentiment: asFeedbackSentiment(body.sentiment),
      rating,
      message,
      contactEmail: normalizeOptionalText(body.contactEmail, 240),
      page: normalizeOptionalText(body.page, 160),
      auth: {
        userId: req.auth?.userId ?? null,
        role: req.auth?.role ?? null,
        email: req.auth?.email ?? null,
      },
    };

    feedbackEvents.push(feedbackEvent);
    if (feedbackEvents.length > MAX_FEEDBACK_EVENTS) {
      feedbackEvents.splice(0, feedbackEvents.length - MAX_FEEDBACK_EVENTS);
    }

    res.status(201).json({
      ok: true,
      id: feedbackEvent.id,
      submittedAt: feedbackEvent.submittedAt,
    });
  });

  router.get("/latest", deps.requireRole("operator"), (req: AuthenticatedRequest, res: Response) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50), 200));
    const events = feedbackEvents.slice(Math.max(0, feedbackEvents.length - limit)).reverse();
    res.json({
      timestamp: new Date().toISOString(),
      count: events.length,
      events,
      auth: {
        role: req.auth?.role ?? null,
        userId: req.auth?.userId ?? null,
      },
    });
  });

  router.post("/failure", (req: Request, res: Response) => {
    const body = req.body as {
      type?: unknown;
      message?: unknown;
      stack?: unknown;
      page?: unknown;
      user_agent?: unknown;
      payload?: unknown;
    };
    const type = asFailureType(body.type);
    const messageRaw = body.message;
    const message = truncate(String(messageRaw ?? ""), 2000) || "Unknown failure";
    if (!type) {
      res.status(400).json({
        error: "Invalid or missing type. Must be one of: crash, error, unhandledrejection, exit.",
      });
      return;
    }
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      res.status(503).json({ error: "Failure reporting unavailable." });
      return;
    }
    const row = {
      type,
      message,
      stack: truncate(String(body.stack ?? ""), 8000),
      page: truncate(String(body.page ?? ""), 512),
      user_agent: truncate(String(body.user_agent ?? ""), 512),
      payload: typeof body.payload === "object" && body.payload !== null ? body.payload : null,
      user_id: (req as AuthenticatedRequest).auth?.userId ?? null,
    };
    (async () => {
      try {
        const { error } = await supabase.from("failure_reports").insert(row);
        if (error) {
          console.error("[feedback/failure] insert error:", error);
          res.status(500).json({ error: "Failed to store failure report." });
          return;
        }
        res.status(200).json({ ok: true });
      } catch (err) {
        console.error("[feedback/failure]", err);
        res.status(500).json({ error: "Failed to store failure report." });
      }
    })();
  });

  app.use("/api/feedback", router);
}
