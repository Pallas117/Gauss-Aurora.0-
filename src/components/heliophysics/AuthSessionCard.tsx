import { Link } from "react-router-dom";
import { LockKeyhole, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AuthSessionCardProps {
    session: any;
    authSummary: string;
    billingMessage: string | null;
    inferenceMessage: string | null;
    missionError: string | null;
    onOpenAuthModal: () => void;
    onOpenStripeCheckout: () => void;
}

export const AuthSessionCard = ({
    session,
    authSummary,
    billingMessage,
    inferenceMessage,
    missionError,
    onOpenAuthModal,
    onOpenStripeCheckout,
}: AuthSessionCardProps) => {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Auth Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                    {session?.authRequired === false ? (
                        <Badge variant="secondary">Dev bypass</Badge>
                    ) : (
                        <Badge variant="outline">RBAC enforced</Badge>
                    )}
                    <Badge variant="outline">
                        {session?.authenticated ? session.role ?? "viewer" : "signed out"}
                    </Badge>
                    {session?.clearance ? (
                        <Badge variant="outline">clearance:{session.clearance}</Badge>
                    ) : null}
                    {session?.email ? <Badge variant="outline">{session.email}</Badge> : null}
                    {session?.emailVerified === false ? (
                        <Badge variant="destructive">email verification pending</Badge>
                    ) : null}
                </div>

                <p className="text-muted-foreground">{authSummary}</p>

                <div className="grid gap-2 sm:grid-cols-2">
                    <Button onClick={onOpenAuthModal}>
                        <LockKeyhole className="mr-2 h-4 w-4" />
                        {session?.authenticated ? "Manage session" : "Open login portal"}
                    </Button>
                    <Button variant="outline" asChild>
                        <Link to="/signup">Sign up + SSO</Link>
                    </Button>
                </div>

                <Button variant="outline" className="w-full" onClick={onOpenStripeCheckout}>
                    <Wallet className="mr-2 h-4 w-4" />
                    Open subscription checkout
                </Button>

                {billingMessage ? (
                    <p className="text-xs text-muted-foreground">{billingMessage}</p>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Stripe-ready: set <code>VITE_STRIPE_CHECKOUT_URL</code> to wire paid plans.
                    </p>
                )}

                {(missionError || inferenceMessage) && (
                    <p className="text-xs text-muted-foreground">{inferenceMessage ?? missionError}</p>
                )}
            </CardContent>
        </Card>
    );
};
