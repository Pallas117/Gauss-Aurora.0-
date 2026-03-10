import { useState } from "react";
import { MessageSquareMore, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { submitFeedback } from "@/lib/api/heliophysics-proxy";
import type { FeedbackSubmissionRequest } from "@/lib/types/space-weather";

type FeedbackState = "idle" | "submitting" | "success" | "error";

interface FeedbackPanelProps {
  compact?: boolean;
}

export function FeedbackPanel({ compact = false }: FeedbackPanelProps) {
  const [category, setCategory] = useState<FeedbackSubmissionRequest["category"]>("feature");
  const [sentiment, setSentiment] = useState<FeedbackSubmissionRequest["sentiment"]>("neutral");
  const [rating, setRating] = useState<string>("4");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [state, setState] = useState<FeedbackState>("idle");
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const onSubmit = async () => {
    if (message.trim().length < 8) {
      setState("error");
      setServerMessage("Please include at least 8 characters so the team can act.");
      return;
    }
    setState("submitting");
    setServerMessage(null);
    try {
      await submitFeedback({
        category,
        sentiment,
        message: message.trim(),
        contactEmail: contactEmail.trim() || null,
        rating: Number.isFinite(Number(rating)) ? Number(rating) : null,
        page: compact ? "/" : "/heliophysics",
      });
      setState("success");
      setServerMessage("Feedback received. Thank you for helping shape operator UX.");
      setMessage("");
    } catch (error) {
      setState("error");
      setServerMessage(error instanceof Error ? error.message : "Feedback submission failed.");
    }
  };

  return (
    <Card>
      <CardHeader className={compact ? "pb-1" : "pb-2"}>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareMore className="h-4 w-4" />
          Product Feedback
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!compact ? (
          <p className="text-xs text-muted-foreground">
            Share bugs, feature requests, operator pain points, or billing feedback.
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Category</span>
            <select
              className="h-9 w-full  border border-input bg-background px-3 text-sm"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as FeedbackSubmissionRequest["category"])
              }
            >
              <option value="feature">Feature</option>
              <option value="bug">Bug</option>
              <option value="operations">Operations</option>
              <option value="security">Security</option>
              <option value="billing">Billing</option>
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Sentiment</span>
            <select
              className="h-9 w-full  border border-input bg-background px-3 text-sm"
              value={sentiment}
              onChange={(event) =>
                setSentiment(event.target.value as FeedbackSubmissionRequest["sentiment"])
              }
            >
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </select>
          </label>
        </div>

        {!compact ? (
          <div className="grid gap-2 sm:grid-cols-[90px_1fr]">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Rating</span>
              <Input
                type="number"
                min={1}
                max={5}
                value={rating}
                onChange={(event) => setRating(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Contact (optional)</span>
              <Input
                type="email"
                value={contactEmail}
                placeholder="ops@your-org.com"
                onChange={(event) => setContactEmail(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Message</span>
          <textarea
            className={compact
              ? "min-h-20 w-full  border border-input bg-background px-3 py-2 text-sm"
              : "min-h-24 w-full  border border-input bg-background px-3 py-2 text-sm"}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe the issue, desired behavior, or workflow friction."
          />
        </label>

        <Button
          className="w-full"
          disabled={state === "submitting"}
          onClick={() => void onSubmit()}
        >
          <Send className="mr-2 h-4 w-4" />
          {state === "submitting" ? "Submitting..." : "Send feedback"}
        </Button>

        {serverMessage ? (
          <p className={`text-xs ${state === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {serverMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
