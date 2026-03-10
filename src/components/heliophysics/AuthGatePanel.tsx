import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { AuthSessionState } from "@/lib/types/space-weather";
import { signInWithPassword, signOutSession } from "@/lib/api/auth";

interface AuthGatePanelProps {
  session: AuthSessionState | null;
  loading?: boolean;
  error?: string | null;
  onSessionRefresh: () => Promise<unknown>;
}

function roleBadgeVariant(role: AuthSessionState["role"]): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "operator") return "secondary";
  return "outline";
}

export function AuthGatePanel({
  session,
  loading = false,
  error,
  onSessionRefresh,
}: AuthGatePanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const authRequired = session?.authRequired ?? true;
  const authenticated = session?.authenticated ?? false;
  const role = session?.role ?? null;

  const helperText = useMemo(() => {
    if (session?.error) {
      if (session.error.toLowerCase().includes("supabase admin") || session.error.toLowerCase().includes("not configured")) {
        return "Server auth not configured. Ask your admin to set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend.";
      }
      return session.error;
    }
    if (!authRequired) {
      return "Development auth bypass is active. Feed access is running in local read-only mode.";
    }
    if (authenticated) {
      return "Authenticated session active. Protected feeds and controls are available based on role.";
    }
    return "Sign in with your Supabase credentials to unlock protected heliophysics feeds.";
  }, [authRequired, authenticated, session?.error]);

  const onSignIn = async () => {
    setSubmitting(true);
    setLocalError(null);
    try {
      await signInWithPassword(email.trim(), password);
      setPassword("");
      await onSessionRefresh();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const onSignOut = async () => {
    setSubmitting(true);
    setLocalError(null);
    try {
      await signOutSession();
      await onSessionRefresh();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Sign-out failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Auth Session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {authRequired ? (
            <Badge variant="outline">RBAC enforced</Badge>
          ) : (
            <Badge variant="secondary">Dev bypass</Badge>
          )}
          {authenticated ? (
            <Badge variant={roleBadgeVariant(role)}>{role ?? "viewer"}</Badge>
          ) : (
            <Badge variant="outline">signed out</Badge>
          )}
        </div>

        <p className="text-muted-foreground">{helperText}</p>

        {authenticated ? (
          <div className="space-y-2">
            <p>
              User: <span className="font-semibold">{session?.email ?? "unknown"}</span>
            </p>
            <Button
              onClick={onSignOut}
              disabled={submitting || loading}
              variant="outline"
              className="w-full"
            >
              {submitting ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        ) : authRequired ? (
          <div className="space-y-2">
            <Input
              type="email"
              autoComplete="username"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting || loading}
            />
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting || loading}
            />
            <Button
              onClick={onSignIn}
              disabled={submitting || loading || email.trim().length === 0 || password.length === 0}
              className="w-full"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        ) : null}

        {(error || localError || session?.error) && (
          <p className="text-xs text-destructive">{localError ?? error ?? session?.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
