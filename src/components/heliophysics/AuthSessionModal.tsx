import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { signInWithOAuth, signInWithPassword, signOutSession } from "@/lib/api/auth";
import type { AuthSessionState } from "@/lib/types/space-weather";

interface AuthSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AuthSessionState | null;
  loading?: boolean;
  onSessionRefresh: () => Promise<unknown>;
}

function roleVariant(role: AuthSessionState["role"]): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "operator") return "secondary";
  return "outline";
}

function clearanceVariant(
  clearance: AuthSessionState["clearance"],
): "default" | "secondary" | "outline" {
  if (clearance === "restricted") return "default";
  if (clearance === "mission") return "secondary";
  return "outline";
}

export function AuthSessionModal({
  open,
  onOpenChange,
  session,
  loading = false,
  onSessionRefresh,
}: AuthSessionModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const authRequired = session?.authRequired ?? true;
  const authenticated = session?.authenticated ?? false;

  const helpText = useMemo(() => {
    if (session?.error) {
      if (session.error.toLowerCase().includes("supabase admin") || session.error.toLowerCase().includes("not configured")) {
        return "Server auth not configured. Ask your admin to set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend.";
      }
      return session.error;
    }
    if (!authRequired) {
      return "Development auth bypass is enabled. For production simulation, sign in with RBAC enabled.";
    }
    if (authenticated) {
      if (session?.emailVerified === false) {
        return "Email verification required. Confirm your email to unlock protected mission feeds.";
      }
      return "Session active. Protected mission feeds and controls are unlocked by role.";
    }
    return "Sign in with password or SSO. New users can register via the signup portal.";
  }, [authRequired, authenticated, session?.emailVerified, session?.error]);

  const runWithSubmitState = async (task: () => Promise<void>) => {
    setSubmitting(true);
    setLocalError(null);
    try {
      await task();
      await onSessionRefresh();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Authentication action failed");
    } finally {
      setSubmitting(false);
    }
  };

  const onSignIn = async () => {
    await runWithSubmitState(async () => {
      await signInWithPassword(email.trim(), password);
      setPassword("");
      onOpenChange(false);
    });
  };

  const onOAuth = async (provider: "google" | "github" | "azure") => {
    await runWithSubmitState(async () => {
      await signInWithOAuth(provider);
    });
  };

  const onSignOut = async () => {
    await runWithSubmitState(async () => {
      await signOutSession();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Mission Access Portal</DialogTitle>
          <DialogDescription>{helpText}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {authRequired ? (
              <Badge variant="outline">RBAC enforced</Badge>
            ) : (
              <Badge variant="secondary">Dev bypass mode</Badge>
            )}
            {authenticated ? (
              <Badge variant={roleVariant(session?.role ?? null)}>{session?.role ?? "viewer"}</Badge>
            ) : (
              <Badge variant="outline">signed out</Badge>
            )}
            {session?.clearance ? (
              <Badge variant={clearanceVariant(session.clearance)}>
                clearance:{session.clearance}
              </Badge>
            ) : null}
            {session?.email ? <Badge variant="outline">{session.email}</Badge> : null}
            {session?.emailVerified === false ? (
              <Badge variant="destructive">verify email</Badge>
            ) : null}
          </div>

          {authenticated ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You are signed in. Use sign out to test role/session transitions.
              </p>
              <Button
                variant="outline"
                className="w-full"
                disabled={loading || submitting}
                onClick={() => void onSignOut()}
              >
                {submitting ? "Signing out..." : "Sign out"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                type="email"
                autoComplete="username"
                placeholder="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={loading || submitting}
              />
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading || submitting}
              />
              <Button
                className="w-full"
                disabled={loading || submitting || !email.trim() || password.length === 0}
                onClick={() => void onSignIn()}
              >
                {submitting ? "Signing in..." : "Sign in with password"}
              </Button>

              <div className="grid gap-2 sm:grid-cols-3">
                <Button
                  variant="outline"
                  disabled={loading || submitting}
                  onClick={() => void onOAuth("google")}
                >
                  Google SSO
                </Button>
                <Button
                  variant="outline"
                  disabled={loading || submitting}
                  onClick={() => void onOAuth("github")}
                >
                  GitHub SSO
                </Button>
                <Button
                  variant="outline"
                  disabled={loading || submitting}
                  onClick={() => void onOAuth("azure")}
                >
                  Azure SSO
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Need an account?{" "}
                <Link className="font-semibold text-primary underline-offset-4 hover:underline" to="/signup">
                  Open signup portal
                </Link>
              </p>
            </div>
          )}

          {localError ? <p className="text-xs text-destructive">{localError}</p> : null}
          {session?.error && !localError ? (
            <p className="text-xs text-destructive">{session.error}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
