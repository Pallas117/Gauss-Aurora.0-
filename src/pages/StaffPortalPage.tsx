import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Calendar, CheckCircle2, ClipboardList, Database, FileText, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { fetchAuditSummary, type AuditSummaryResponse } from "@/lib/api/heliophysics-proxy";
import { nextImplementations, recentChanges } from "@/data/staff-portal";
import { cn } from "@/lib/utils";

const statusVariant = (status: string) =>
  status === "in_progress" ? "default" : status === "review" ? "secondary" : "outline";

const StaffPortalPage = () => {
  const mission = useMissionSnapshot();
  const isStaff = mission.session?.role === "admin" || mission.session?.role === "operator";
  const [auditSummary, setAuditSummary] = useState<AuditSummaryResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    if (!isStaff) return;
    setAuditLoading(true);
    setAuditError(null);
    fetchAuditSummary()
      .then(setAuditSummary)
      .catch((e) => setAuditError(e instanceof Error ? e.message : "Failed to load audit"))
      .finally(() => setAuditLoading(false));
  }, [isStaff]);

  if (!mission.session?.authRequired) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">
          Auth bypass is active. Set AUTH_REQUIRED=true to access the staff portal.
        </p>
        <Button variant="outline" size="sm" asChild className="mt-2">
          <Link to="/command">Back to Command</Link>
        </Button>
      </div>
    );
  }

  if (!mission.session?.authenticated) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">Sign in to access the staff portal.</p>
        <Button variant="outline" asChild className="mt-2">
          <Link to="/heliophysics">Go to mission console</Link>
        </Button>
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">Staff (operator or admin) role required.</p>
        <Button variant="outline" asChild className="mt-2">
          <Link to="/command">Back to Command</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/command">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Internal staff portal
          </h1>
        </div>
        <Badge variant="secondary">Staff only</Badge>
      </div>

      <p className="text-muted-foreground text-sm max-w-2xl">
        Upcoming implementations and recent changes for internal visibility. Edit{" "}
        <code className="rounded bg-muted px-1 text-xs">src/data/staff-portal.ts</code> to update.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Quick links
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Onboard data sources and satellite hardware from the Systems page.
          </p>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link to="/ops/sources">Onboard data sources and satellite hardware</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Last full audit
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Summary from <code className="text-xs">npm run audit:adherence:record</code>.
          </p>
        </CardHeader>
        <CardContent>
          {auditLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {auditError && (
            <p className="text-destructive text-sm">{auditError}</p>
          )}
          {!auditLoading && !auditError && auditSummary && (
            <div className="space-y-2 text-sm">
              {auditSummary.totals ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">PASS {auditSummary.totals.pass}</Badge>
                    <Badge variant="outline">WARN {auditSummary.totals.warn}</Badge>
                    <Badge variant={auditSummary.totals.fail > 0 ? "destructive" : "outline"}>
                      FAIL {auditSummary.totals.fail}
                    </Badge>
                    <Badge variant="outline">SKIP {auditSummary.totals.skip}</Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Generated: {auditSummary.generated_at ? new Date(auditSummary.generated_at).toLocaleString() : "—"}
                    {auditSummary.check_count != null && ` · ${auditSummary.check_count} checks`}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">{auditSummary.message ?? "No audit recorded."}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Login &amp; activation
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            One flow for staff and users; staff get Heliophysics Ops and Space Debris by role or email.
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            See <code className="rounded bg-muted px-1 text-xs">docs/LOGIN_AND_ACTIVATION_GUIDE.md</code> in the repo for step-by-step sign-in and staff-by-email setup.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Next implementations
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Planned and in-progress work across frontend, backend, and internal tooling.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {nextImplementations.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "rounded-lg border border-border/70 p-3",
                  "flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2"
                )}
              >
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  {item.description && (
                    <p className="text-muted-foreground text-xs mt-0.5">{item.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Badge variant="outline" className="text-[10px]">
                      {item.area}
                    </Badge>
                    {item.target && (
                      <Badge variant="secondary" className="text-[10px]">
                        {item.target}
                      </Badge>
                    )}
                  </div>
                </div>
                <Badge variant={statusVariant(item.status)} className="shrink-0 capitalize">
                  {item.status.replace("_", " ")}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Recent changes
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Shipped work and notable updates for context.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {recentChanges.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-border/70 p-3 flex flex-col gap-1"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{item.title}</span>
                  <span className="text-muted-foreground text-xs flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {item.date}
                  </span>
                  {item.area && (
                    <Badge variant="outline" className="text-[10px]">
                      {item.area}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">{item.summary}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default StaffPortalPage;
