import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CreditCard, Loader2, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JoinNetworkOnboarding } from "@/components/onboarding/JoinNetworkOnboarding";
import { signInWithOAuth, signUpWithPassword } from "@/lib/api/auth";
import { getViteEnv } from "@/lib/heliophysics-utils";

type RequestedRole = "viewer" | "operator";
type FormState = "idle" | "submitting" | "success" | "error";

const Signup = () => {
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
        navigate("/onboarding");
        return;
      }
      setMessage("Account created. Verify your email, then sign in to continue to onboarding.");
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
    <main className="min-h-screen bg-background px-4 py-6 text-foreground lg:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Mission Access Portal</h1>
            <p className="text-sm text-muted-foreground">
              Establish your credentials and connect to the heliospheric monitoring network.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/heliophysics">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to mission console
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Signup + Subscription Portal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="Password (min 8 characters)"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="text"
                  placeholder="Full name (optional)"
                  value={fullName}
                  disabled={busy}
                  onChange={(event) => setFullName(event.target.value)}
                />
                <Input
                  type="text"
                  placeholder="Company (optional)"
                  value={company}
                  disabled={busy}
                  onChange={(event) => setCompany(event.target.value)}
                />
              </div>

              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Requested role (reviewed, not auto-granted)</span>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={requestedRole}
                  disabled={busy}
                  onChange={(event) => setRequestedRole(event.target.value as RequestedRole)}
                >
                  <option value="viewer">Viewer</option>
                  <option value="operator">Operator</option>
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Operator access is assigned by backend RBAC or staff activation after signup or billing confirmation.
              </p>

              <Button className="w-full" disabled={busy} onClick={() => void onSignUp()}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Establishing connection...
                  </>
                ) : (
                  "Sign up with email"
                )}
              </Button>

              <div className="grid gap-2 sm:grid-cols-3">
                <Button variant="outline" disabled={busy} onClick={() => void onOAuth("google")}>
                  Google SSO
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void onOAuth("github")}>
                  GitHub SSO
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void onOAuth("azure")}>
                  Azure SSO
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">2. Operator plan (optional)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Use this portal to move from free access to paid mission operations when Stripe is enabled.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Supabase Auth</Badge>
                <Badge variant="outline">SSO-ready</Badge>
                <Badge variant="outline">Stripe-ready</Badge>
              </div>
              <div className="rounded-md border border-border/70 bg-background/40 p-3">
                <p className="font-medium">Operator plan</p>
                <p className="text-xs text-muted-foreground">
                  Includes protected feeds, alerting, and AI inference controls. Billing does not auto-assign RBAC until entitlement wiring confirms the subscription.
                </p>
              </div>
              <Button variant="outline" className="w-full" onClick={openStripeCheckout}>
                <CreditCard className="mr-2 h-4 w-4" />
                Open Stripe checkout
              </Button>
              <p className="text-xs text-muted-foreground">
                Configure <code>VITE_STRIPE_CHECKOUT_URL</code> to activate this button.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Step 3: Join a device (onboarding after sign up) */}
        {state === "success" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4" />
                3. Join a device to the network
              </CardTitle>
            </CardHeader>
            <CardContent>
              <JoinNetworkOnboarding
                variant="compact"
                showGenerateCode={true}
                showTuringLink={true}
              />
            </CardContent>
          </Card>
        )}

        {message ? (
          <div
            className={`rounded-md border p-3 text-sm ${
              state === "error"
                ? "border-destructive/50 text-destructive"
                : "border-border/70 text-muted-foreground"
            }`}
          >
            <div className="flex items-center gap-2">
              {state === "success" ? <CheckCircle2 className="h-4 w-4" /> : null}
              <span>{message}</span>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
};

export default Signup;
