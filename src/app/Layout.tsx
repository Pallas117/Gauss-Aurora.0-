import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { Activity, Bot, ClipboardList, Cpu, Globe2, Radio, Server, Shield, Timer, Users, Zap, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useOfflineMode } from "@/hooks/useOfflineMode";
import { useTuringSummary } from "@/hooks/useTuringDevices";
import { DisplayCustomizer } from "@/components/DisplayCustomizer";
import { RiskHudBanner } from "@/components/cockpit/RiskHudBanner";
import { OfflineResilienceBanner } from "@/components/cockpit/OfflineResilienceBanner";
import { OnboardingGuard } from "@/components/OnboardingGuard";
import { cn } from "@/lib/utils";
import { getSupabaseEnvStatus } from "@/lib/auth-env-check";
import { rollupSources } from "@/lib/source-truth";

const NAV_ITEMS = [
  { to: "/platform", label: "Platform", icon: Sparkles, hint: "HOME" },
  { to: "/command", label: "Command", icon: Activity, hint: "C2" },
  { to: "/sda", label: "SDA", icon: Globe2, hint: "HUD" },
  { to: "/systems", label: "Systems", icon: Server, hint: "Infra" },
  { to: "/intel", label: "Intel", icon: Bot, hint: "RAG" },
  { to: "/heliophysics", label: "Heliophysics", icon: Radio, hint: "Ops" },
  { to: "/admin/users", label: "Team", icon: Users, hint: "Admin", adminOnly: true },
  { to: "/staff/portal", label: "Staff portal", icon: ClipboardList, hint: "Roadmap", staffOnly: true },
];

function statusTone(ok: boolean): "default" | "secondary" | "destructive" {
  return ok ? "secondary" : "destructive";
}

export function Layout() {
  const mission = useMissionSnapshot();
  const offline = useOfflineMode({
    lastSuccessfulSyncAt: mission.lastSuccessfulSyncAt,
    staleAfterMs: 90_000,
  });
  const turing = useTuringSummary();
  const authEnv = getSupabaseEnvStatus();
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const isPublicSdaSurface = location.pathname === "/sda" || location.pathname === "/space/sda";
  const presentation =
    location.pathname === "/sda" && new URLSearchParams(location.search).get("presentation") === "1";
  const stormTier = mission.snapshot?.canonicalLatest.alerts.stormTier ?? "unknown";
  // Probes are left out, and no measuring source is unknown rather than healthy (GAU-81).
  const sources = rollupSources(mission.snapshot?.sourceStatus ?? []);
  const publicLaneActive = isPublicSdaSurface && !mission.session?.authenticated;
  const feedOperational = publicLaneActive || !mission.pollingPaused;

  if (isLanding) {
    return <Outlet />;
  }

  return (
    <>
      {mission.session?.authRequired && mission.session?.authenticated && <OnboardingGuard />}
      <div
      className={cn("gauss-shell min-h-screen bg-background text-foreground", presentation && "gauss-shell--presentation")}
    >
      {!authEnv.configured && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-center text-xs text-amber-800 dark:text-amber-200" role="alert">
          Auth config: {authEnv.reason} See docs/AUTH_TROUBLESHOOTING.md.
        </div>
      )}
      {offline.isOffline && (
        <OfflineResilienceBanner
          staleData={offline.staleData}
          staleAgeMinutes={offline.staleAgeMs != null ? Math.round(offline.staleAgeMs / 60_000) : null}
          className="mx-4 mt-2"
        />
      )}
      {mission.snapshot?.threatSummary && (
        <div className="px-4 pt-2">
          <RiskHudBanner threatSummary={mission.snapshot.threatSummary} />
        </div>
      )}
      <div className="gauss-shell__frame">
        <aside className="gauss-shell__nav">
          <div className="gauss-shell__brand">
            <Cpu className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold tracking-wide">GAUSS AURORA</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Mission Shell</p>
            </div>
          </div>

          <nav className="gauss-shell__links" aria-label="Primary">
            {NAV_ITEMS.filter((item) => {
              if ("adminOnly" in item && item.adminOnly) {
                return mission.session?.role === "admin";
              }
              if ("staffOnly" in item && item.staffOnly) {
                return mission.session?.role === "admin" || mission.session?.role === "operator";
              }
              return true;
            }).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/command"}
                  className={({ isActive }) =>
                    cn("gauss-shell__link", isActive && "gauss-shell__link--active")
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  <span className="gauss-shell__link-hint">{item.hint}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="gauss-shell__nav-footer">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Security posture</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant={statusTone(feedOperational)}>
                {publicLaneActive ? "public active" : `feed ${mission.pollingPaused ? "paused" : "active"}`}
              </Badge>
              {offline.isOffline && (
                <Badge variant="destructive">offline</Badge>
              )}
              <Badge variant={statusTone((mission.session?.authRequired ?? true) ? Boolean(mission.session?.authenticated) : true)}>
                {mission.session?.authRequired === false
                  ? "dev bypass"
                  : mission.session?.authenticated
                    ? mission.session?.role ?? "viewer"
                    : "signed out"}
              </Badge>
              <Badge variant={sources.state === "unknown" ? "outline" : statusTone(sources.state === "healthy")}>
                {sources.state === "healthy" ? "sources healthy" : sources.state === "degraded" ? `${sources.degraded} degraded` : "sources unknown"}
              </Badge>
            </div>
          </div>
        </aside>

        <div className="gauss-shell__main">
          <header className="gauss-shell__header">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Unified operations</p>
              <h1 className="text-base font-semibold">Mission Command Surface</h1>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <DisplayCustomizer />
              <Badge variant="outline">tier: {stormTier}</Badge>
              <Badge variant="outline">
                <Shield className="mr-1 h-3 w-3" />
                {mission.session?.clearance ?? "public"}
              </Badge>
            </div>
          </header>

          <main className="gauss-shell__content" data-testid="gauss-shell-content">
            <Outlet />
          </main>

          <footer className="gauss-shell__footer">
            <span>Project Gauss mission shell</span>
            <span className="flex items-center gap-3">
              <Link
                to="/ops/dev-hud"
                className="text-muted-foreground hover:text-foreground text-[10px]"
              >
                Dev HUD
              </Link>
              {turing.summary && <Link
                to="/ops/turing"
                className="text-muted-foreground hover:text-foreground text-[10px]"
              >
                Turing: {turing.summary.total} device{turing.summary.total !== 1 ? "s" : ""} ({turing.summary.healthy} healthy{(turing.summary.pending ?? 0) > 0 ? `, ${turing.summary.pending} pending` : ""})
              </Link>
              }
              <span>{mission.snapshot?.timestamp ? new Date(mission.snapshot.timestamp).toLocaleTimeString() : "waiting for feed"}</span>
            </span>
          </footer>
        </div>
      </div>
    </div>
    </>
  );
}

export default Layout;
