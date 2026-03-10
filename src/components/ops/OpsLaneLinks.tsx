import { Link, useLocation } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Database,
  LayoutDashboard,
  Server,
  TerminalSquare,
  Timer,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type OpsLaneId = "automation" | "chronos" | "turing" | "sources" | "dev-hud";

type OpsLane = {
  id: OpsLaneId;
  to: string;
  label: string;
  code: string;
  description: string;
  icon: typeof Zap;
};

export const OPS_LANES: OpsLane[] = [
  {
    id: "automation",
    to: "/ops/automation",
    label: "Automation",
    code: "OPS/AUTO",
    description: "Source policy overrides, power posture, and security telemetry.",
    icon: Zap,
  },
  {
    id: "chronos",
    to: "/ops/chronos",
    label: "Chronos",
    code: "OPS/TIME",
    description: "Runtime diagnostics, RAM pressure, and canonical feed timing.",
    icon: Timer,
  },
  {
    id: "turing",
    to: "/ops/turing",
    label: "Turing",
    code: "OPS/MESH",
    description: "Join codes, device approvals, health, and healing actions.",
    icon: Server,
  },
  {
    id: "sources",
    to: "/ops/sources",
    label: "Sources",
    code: "OPS/IO",
    description: "Feed and hardware onboarding with staff-only control surfaces.",
    icon: Database,
  },
  {
    id: "dev-hud",
    to: "/ops/dev-hud",
    label: "Dev HUD",
    code: "OPS/TTY",
    description: "Terminal redundancy lane for human-in-the-loop operations.",
    icon: Bot,
  },
];

function resolveActiveLane(pathname: string, search: string): OpsLaneId | null {
  const directMatch = OPS_LANES.find((lane) => pathname === lane.to);
  if (directMatch) {
    return directMatch.id;
  }

  if (pathname !== "/systems") {
    return null;
  }

  const tab = new URLSearchParams(search).get("tab");
  if (
    tab === "automation" ||
    tab === "chronos" ||
    tab === "turing" ||
    tab === "sources"
  ) {
    return tab;
  }

  return null;
}

interface OpsLaneLinksProps {
  compact?: boolean;
  className?: string;
  showHub?: boolean;
}

export function OpsLaneLinks({
  compact = false,
  className,
  showHub = false,
}: OpsLaneLinksProps) {
  const location = useLocation();
  const activeLane = resolveActiveLane(location.pathname, location.search);

  return (
    <section className={cn("space-y-2", className)} aria-label="Operations lane links">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Ops Lanes
          </p>
          <p className="text-sm text-muted-foreground">
            Narrow route lanes for infra work so operators do not carry one long systems page.
          </p>
        </div>
      </div>
      <div className={cn("grid gap-2", compact ? "sm:grid-cols-2 xl:grid-cols-3" : "xl:grid-cols-3")}>
        {showHub ? (
          <Link
            to="/systems"
            className={cn(
              "group rounded-xl border border-border/70 bg-background/60 px-4 py-3 transition-colors hover:border-primary/50 hover:bg-background",
              location.pathname === "/systems" && activeLane == null && "border-primary/60 bg-primary/5",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <LayoutDashboard className="h-4 w-4 text-primary" />
                  <span className="font-medium">Systems Hub</span>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  OPS/HUB
                </p>
                {!compact && (
                  <p className="text-sm text-muted-foreground">
                    Overview lane with fast links into each operational subsystem.
                  </p>
                )}
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          </Link>
        ) : null}
        {OPS_LANES.map((lane) => {
          const Icon = lane.icon;
          const isActive = activeLane === lane.id;

          return (
            <Link
              key={lane.id}
              to={lane.to}
              className={cn(
                "group rounded-xl border border-border/70 bg-background/60 px-4 py-3 transition-colors hover:border-primary/50 hover:bg-background",
                isActive && "border-primary/60 bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="font-medium">{lane.label}</span>
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    {lane.code}
                  </p>
                  {!compact && (
                    <p className="text-sm text-muted-foreground">{lane.description}</p>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default OpsLaneLinks;
