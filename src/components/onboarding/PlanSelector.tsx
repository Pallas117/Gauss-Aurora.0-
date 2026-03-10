/**
 * Partner plan selection: Student, Professional, Academic, Operator.
 * "Start 90-day pilot" and "Subscribe now" per tier; Skip for now.
 * Stripe checkout redirect wired in when backend create-checkout-session is available.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";
import { CreditCard, Loader2 } from "lucide-react";

export type PlanId = "student" | "professional" | "academic" | "operator";

const PLANS: { id: PlanId; label: string; price: string; description: string }[] = [
  { id: "student", label: "Student / young professional", price: "From $5/mo", description: "Learning and early-career access." },
  { id: "professional", label: "Professional", price: "TBD", description: "Individual operator and tools." },
  { id: "academic", label: "Academic licence", price: "TBD", description: "Research and institutional use." },
  { id: "operator", label: "Operator", price: "$1,500–$5,000/mo", description: "Mission operations and full stack." },
];

export interface PlanSelectorProps {
  onComplete: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
}

export function PlanSelector({ onComplete, onSkip }: PlanSelectorProps) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [pilot, setPilot] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async () => {
    if (!selectedPlan) return;
    setLoading(true);
    setError(null);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ planId: selectedPlan, pilot }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Checkout could not be started.");
        return;
      }
      if (!data.url) {
        setError("Checkout session did not return a redirect URL.");
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout could not be started.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => setSelectedPlan(plan.id)}
            className={`rounded-lg border p-4 text-left transition-colors ${
              selectedPlan === plan.id
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <p className="font-medium">{plan.label}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{plan.price}</p>
            <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pilot}
            onChange={(e) => setPilot(e.target.checked)}
            className="rounded border-input"
          />
          90-day pilot (trial, then convert to paid)
        </label>
      </div>
      <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
        <Button
          onClick={() => void handleSubscribe()}
          disabled={!selectedPlan || loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <CreditCard className="h-4 w-4 mr-2" />
          )}
          {pilot ? "Start 90-day pilot" : "Subscribe now"}
        </Button>
        <Button variant="outline" onClick={() => void onSkip()} disabled={loading}>
          Skip for now
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Billing starts checkout only. Access role changes remain subject to backend entitlement and RBAC activation.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
