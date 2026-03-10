import { Suspense, lazy, useMemo, type ComponentType, type LazyExoticComponent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, Database, Server, Timer, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpsLaneLinks, type OpsLaneId } from "@/components/ops/OpsLaneLinks";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useTuringSummary } from "@/hooks/useTuringDevices";

const AutomationPage = lazy(() => import("./AutomationPage"));
const ChronosPage = lazy(() => import("./ChronosPage"));
const TuringDevicesPage = lazy(() => import("./TuringDevicesPage"));
const OperatorSourcesPage = lazy(() => import("./OperatorSourcesPage"));

const VALID_TABS = ["automation", "chronos", "turing", "sources"] as const satisfies ReadonlyArray<OpsLaneId>;
type TabValue = (typeof VALID_TABS)[number];

const LANE_COMPONENTS: Record<TabValue, LazyExoticComponent<ComponentType>> = {
  automation: AutomationPage,
  chronos: ChronosPage,
  turing: TuringDevicesPage,
  sources: OperatorSourcesPage,
};

function parseTab(searchParams: URLSearchParams): TabValue | null {
  const tab = searchParams.get("tab") ?? "";
  if (VALID_TABS.includes(tab as TabValue)) {
    return tab as TabValue;
  }
  return null;
}

export default function SystemsPage() {
  const [searchParams] = useSearchParams();
  const tab = parseTab(searchParams);
  const mission = useMissionSnapshot();
  const backendHealth = useBackendHealth();
  const turing = useTuringSummary();
  const sourceStatus = mission.snapshot?.sourceStatus ?? [];
  const healthySources = sourceStatus.filter((source) => source.healthy).length;
  const degradedSources = sourceStatus.length - healthySources;

  const laneCards = useMemo(
    () => [
      {
        key: "automation",
        title: "Automation controls",
        to: "/ops/automation",
        icon: Zap,
        summary: `${healthySources}/${sourceStatus.length || 0} sources nominal`,
        detail: "Source overrides, cadence policy, and CyberTiger telemetry.",
        badge: mission.pollingPaused ? "polling paused" : "adaptive active",
      },
      {
        key: "chronos",
        title: "Chronos runtime",
        to: "/ops/chronos",
        icon: Timer,
        summary: backendHealth.health?.ok ? "backend linked" : "backend degraded",
        detail: "Memory pressure, health pings, and canonical timing diagnostics.",
        badge: `RAM ${backendHealth.memoryLevel}`,
      },
      {
        key: "turing",
        title: "Turing mesh",
        to: "/ops/turing",
        icon: Server,
        summary: turing.summary ? `${turing.summary.total} devices tracked` : "device summary pending",
        detail: "Join codes, device approvals, health probes, and heal actions.",
        badge: turing.summary ? `${turing.summary.healthy} healthy` : "loading",
      },
      {
        key: "sources",
        title: "Source onboarding",
        to: "/ops/sources",
        icon: Database,
        summary: degradedSources > 0 ? `${degradedSources} degraded feeds` : "feeds nominal",
        detail: "Staff-only feed and hardware registration for mission IO.",
        badge: mission.session?.authenticated ? mission.session.role ?? "viewer" : "signed out",
      },
    ],
    [
      backendHealth.health?.ok,
      backendHealth.memoryLevel,
      degradedSources,
      healthySources,
      mission.pollingPaused,
      mission.session?.authenticated,
      mission.session?.role,
      sourceStatus.length,
      turing.summary,
    ],
  );

  if (tab) {
    const LaneComponent = LANE_COMPONENTS[tab];
    return (
      <div className="space-y-4" data-testid="systems-page">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight">Systems Overview</h2>
          <p className="text-muted-foreground">
            Focused operational lane view. Use direct ops routes to keep render cost and scrolling down.
          </p>
        </div>
        <OpsLaneLinks compact showHub />
        <Suspense
          fallback={
            <div className="flex min-h-[20vh] items-center justify-center text-xs text-muted-foreground">
              Awaiting Node...
            </div>
          }
        >
          <LaneComponent />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="systems-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Systems Overview</h2>
          <p className="text-muted-foreground">
            Split infra work into direct ops lanes to reduce scroll depth and startup load.
          </p>
        </div>
      </div>
      <OpsLaneLinks showHub />
      <div className="grid gap-4 xl:grid-cols-2">
        {laneCards.map((lane) => {
          const Icon = lane.icon;
          return (
            <Card key={lane.key}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="h-4 w-4 text-primary" />
                      {lane.title}
                    </CardTitle>
                    <p className="mt-2 text-sm text-muted-foreground">{lane.detail}</p>
                  </div>
                  <Badge variant="outline">{lane.badge}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm font-medium">{lane.summary}</p>
                <Link
                  to={lane.to}
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Activity className="h-4 w-4" />
                  Open lane
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
