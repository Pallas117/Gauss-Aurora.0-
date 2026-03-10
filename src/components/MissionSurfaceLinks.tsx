import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Globe2,
  Radio,
  TerminalSquare,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SurfaceLink = {
  to: string;
  label: string;
  code: string;
  description: string;
  icon: typeof Activity;
};

const SURFACE_LINKS: SurfaceLink[] = [
  {
    to: "/command",
    label: "Command",
    code: "OPS/C2",
    description: "Queue operator actions and mission decisions.",
    icon: Activity,
  },
  {
    to: "/space/sda",
    label: "SDA HUD",
    code: "SPACE/SDA",
    description: "Open orbital awareness without the full ops stack.",
    icon: Globe2,
  },
  {
    to: "/space/heliophysics",
    label: "Heliophysics",
    code: "SOLAR/OPS",
    description: "Focus on magnetic coupling, aurora, and MMS state.",
    icon: Radio,
  },
  {
    to: "/ops/chronos",
    label: "Chronos",
    code: "OPS/RUNTIME",
    description: "Check runtime health, memory pressure, and scheduler status.",
    icon: Timer,
  },
  {
    to: "/ops/dev-hud",
    label: "Dev HUD",
    code: "OPS/TTY",
    description: "Terminal-style redundancy lane for human-in-the-loop control.",
    icon: TerminalSquare,
  },
];

interface MissionSurfaceLinksProps {
  compact?: boolean;
  className?: string;
}

export function MissionSurfaceLinks({
  compact = false,
  className,
}: MissionSurfaceLinksProps) {
  const location = useLocation();

  return (
    <section className={cn("space-y-2", className)} aria-label="Mission surface links">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Mission Surfaces
          </p>
          <p className="text-sm text-muted-foreground">
            Split heavy workflows into focused route lanes to reduce scrolling and render load.
          </p>
        </div>
      </div>
      <div className={cn("grid gap-2", compact ? "sm:grid-cols-2" : "xl:grid-cols-2")}>
        {SURFACE_LINKS.map((surface) => {
          const Icon = surface.icon;
          const isActive =
            location.pathname === surface.to ||
            (surface.to === "/space/sda" && location.pathname === "/sda") ||
            (surface.to === "/space/heliophysics" && location.pathname === "/heliophysics") ||
            (surface.to === "/ops/dev-hud" && location.pathname === "/dev-hud");

          return (
            <Link
              key={surface.to}
              to={surface.to}
              className={cn(
                "group rounded-xl border border-border/70 bg-background/60 px-4 py-3 transition-colors hover:border-primary/50 hover:bg-background",
                isActive && "border-primary/60 bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="font-medium">{surface.label}</span>
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    {surface.code}
                  </p>
                  {!compact && (
                    <p className="text-sm text-muted-foreground">{surface.description}</p>
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

export default MissionSurfaceLinks;
