import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, CreditCard, Loader2, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { JoinNetworkOnboarding } from "@/components/onboarding/JoinNetworkOnboarding";
import { signInWithOAuth, signUpWithPassword } from "@/lib/api/auth";
import { getViteEnv } from "@/lib/heliophysics-utils";

type RequestedRole = "viewer" | "operator";
type FormState = "idle" | "submitting" | "success" | "error";

export interface SignUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after successful sign-up (e.g. close and navigate). */
  onSuccess?: () => void;
}

export function SignUpModal({ open, onOpenChange, onSuccess }: SignUpModalProps) {
  const navigate = useNavigate();
  const stripeCheckoutUrl = (getViteEnv("VITE_STRIPE_CHECKOUT_URL") ?? "").trim();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [requestedRole, setRequestedRole] = useState<RequestedRole>("viewer");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const onSignUp = async () => {
    if (email.trim().length === 0 || password.length < 8) {
      setState("error");
      setMessage("Use a valid email and password with at least 8 characters.");
      return;
    }

    setState("submitting");
    setMessage(null);
    try {
      const result = await signUpWithPassword({
        email: email.trim(),
        password,
        fullName: fullName.trim() || undefined,
        company: company.trim() || undefined,
        requestedRole,
      });
      setState("success");
      if (result.signedIn) {
        setMessage("Account created. Session active. Continue to onboarding.");
        onSuccess?.();
        return;
      }
      setMessage("Account created. Confirm your email, then sign in to activate access.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Signup failed.");
    }
  };

  const onOAuth = async (provider: "google" | "github" | "azure") => {
    setState("submitting");
    setMessage(null);
    try {
      await signInWithOAuth(provider);
      onOpenChange(false);
      navigate("/onboarding");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "SSO sign-in failed.");
    } finally {
      setState("idle");
    }
  };

  const openStripeCheckout = () => {
    if (!stripeCheckoutUrl) {
      setState("error");
      setMessage(
        "Stripe checkout is not configured. Set VITE_STRIPE_CHECKOUT_URL to activate paid plans.",
      );
      return;
    }
    window.open(stripeCheckoutUrl, "_blank", "noopener,noreferrer");
    setMessage("Opened Stripe checkout in a new tab.");
  };

  const busy = state === "submitting";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sign up</DialogTitle>
          <DialogDescription>
            Create an account and optionally subscribe to the Operator plan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Step 1: Create account */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">1. Create account</h3>
            <Input
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Password (min 8 characters)"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                type="text"
                placeholder="Full name (optional)"
                value={fullName}
                disabled={busy}
                onChange={(e) => setFullName(e.target.value)}
              />
              <Input
                type="text"
                placeholder="Company (optional)"
                value={company}
                disabled={busy}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Requested role (reviewed, not auto-granted)</span>
              <select
                className="h-9 w-full  border border-input bg-background px-3 text-sm"
                value={requestedRole}
                disabled={busy}
                onChange={(e) => setRequestedRole(e.target.value as RequestedRole)}
              >
                <option value="viewer">Viewer</option>
                <option value="operator">Operator</option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              Operator access is assigned separately by RBAC or staff activation after signup or billing confirmation.
            </p>
            <Button className="w-full" disabled={busy} onClick={() => void onSignUp()}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Sign up with email"
              )}
            </Button>
            <div className="grid gap-2 grid-cols-3">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void onOAuth("google")}>
                Google SSO
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void onOAuth("github")}>
                GitHub SSO
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void onOAuth("azure")}>
                Azure SSO
              </Button>
            </div>
          </section>

          {/* Step 2: Operator plan (optional) */}
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">2. Operator plan (optional)</h3>
            <p className="text-xs text-muted-foreground">
              Includes protected feeds, alerting, and AI inference controls. Billing does not auto-promote account role until entitlement wiring confirms the subscription.
            </p>
            <Button variant="outline" className="w-full" onClick={openStripeCheckout}>
              <CreditCard className="mr-2 h-4 w-4" />
              Check out with Stripe
            </Button>
            {!stripeCheckoutUrl && (
              <p className="text-xs text-muted-foreground">
                Configure <code>VITE_STRIPE_CHECKOUT_URL</code> to activate this button.
              </p>
            )}
          </section>

          {/* Step 3: Join a device (onboarding after sign up) */}
          {state === "success" && (
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Server className="h-4 w-4" />
                3. Next: Join a device to the network
              </h3>
              <JoinNetworkOnboarding
                variant="compact"
                showGenerateCode={true}
                showTuringLink={true}
              />
            </section>
          )}

          {message && (
            <div
              className={` border p-3 text-sm ${
                state === "error"
                  ? "border-destructive/50 text-destructive"
                  : "border-border/70 text-muted-foreground"
              }`}
            >
              <div className="flex items-center gap-2">
                {state === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
                <span>{message}</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
