import { useState } from "react";
import { Link } from "react-router-dom";
import { LockKeyhole, Share2 } from "lucide-react";
import { AuthSessionModal } from "@/components/heliophysics/AuthSessionModal";
import { ThreatActionCards } from "@/components/heliophysics/ThreatActionCards";
import { GaussRagPanel } from "@/components/GaussRagPanel";
import { MemoryGraphExplorer } from "@/components/MemoryGraphExplorer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useThreatSummary } from "@/hooks/useThreatSummary";
import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";
import type { AuthClearance } from "@/lib/types/space-weather";

const BASE_URL = getApiBaseUrl();

function hasMissionClearance(clearance: AuthClearance | null | undefined): boolean {
  return clearance === "mission" || clearance === "restricted";
}

export default function IntelPage() {
  const mission = useMissionSnapshot();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [inferenceState, setInferenceState] = useState<"loading" | "ready" | "disabled" | "error">("ready");

  const canViewProtectedFeeds = mission.session ? !mission.session.authRequired || mission.session.authenticated : false;
  const canRunInference =
    (mission.session?.role === "operator" || mission.session?.role === "admin") &&
    hasMissionClearance(mission.session?.clearance);
  const canShare = canViewProtectedFeeds && hasMissionClearance(mission.session?.clearance);

  const threatSummary = useThreatSummary({ enabled: canViewProtectedFeeds });

  const runManualInference = async () => {
    const latest = mission.snapshot?.canonicalLatest;
    if (!latest || !canRunInference) {
      setInferenceState("disabled");
      return;
    }

    setInferenceState("loading");
    try {
      const response = await fetch(`${BASE_URL}/api/ai/nowcast/infer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify({
          horizonMinutes: 30,
          sequence: [latest],
        }),
      });

      if (response.status === 403) {
        setInferenceState("disabled");
        return;
      }
      if (!response.ok) {
        throw new Error(`Manual inference HTTP ${response.status}`);
      }

      setInferenceState("ready");
    } catch {
      setInferenceState("error");
    }
  };

  const onSovereignShare = () => {
    if (!canShare) {
      setShareMessage("Sign in with mission clearance to enable Sovereign Share.");
      return;
    }
    setShareMessage("Sovereign Share handoff prepared. Export endpoint pending final legal controls.");
  };

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]" data-testid="intel-page">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">RAG + Threat Intelligence</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <GaussRagPanel className="rounded-none border-0 bg-transparent shadow-none" />
          </CardContent>
        </Card>

        <MemoryGraphExplorer />

        <ThreatActionCards
          threatSummary={threatSummary.data}
          stormTier={mission.snapshot?.canonicalLatest.alerts.stormTier ?? "unknown"}
          loading={threatSummary.loading}
          error={threatSummary.error}
          role={mission.session?.role ?? null}
          clearance={mission.session?.clearance ?? null}
          inferenceState={canRunInference ? inferenceState : "disabled"}
          onRunInference={canRunInference ? runManualInference : undefined}
        />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mission Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant={mission.session?.authenticated ? "secondary" : "destructive"}>
                {mission.session?.authenticated ? mission.session?.role ?? "viewer" : "signed out"}
              </Badge>
              <Badge variant="outline">clearance {mission.session?.clearance ?? "public"}</Badge>
            </div>
            <Button className="w-full" onClick={() => setAuthModalOpen(true)}>
              <LockKeyhole className="mr-2 h-4 w-4" />
              {mission.session?.authenticated ? "Manage session" : "Open login portal"}
            </Button>
            <Button className="w-full" variant="outline" asChild>
              <Link to="/signup">Signup + SSO</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sovereign Share</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Share curated mission packets with role-gated provenance and export controls.
            </p>
            <Button className="w-full" variant="outline" onClick={onSovereignShare}>
              <Share2 className="mr-2 h-4 w-4" />
              Prepare share package
            </Button>
            {shareMessage ? <p className="text-xs text-muted-foreground">{shareMessage}</p> : null}
          </CardContent>
        </Card>
      </div>

      <AuthSessionModal
        open={authModalOpen}
        onOpenChange={setAuthModalOpen}
        session={mission.session}
        loading={mission.loading}
        onSessionRefresh={mission.refreshSession}
      />
    </section>
  );
}
