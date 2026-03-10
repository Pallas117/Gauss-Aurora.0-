import { Link } from "react-router-dom";
import { RefreshCw, LayoutDashboard, Play, ShieldCheck, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

type AuthRole = "viewer" | "operator" | "admin" | null;

interface ActionRailProps {
  role: AuthRole;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  className?: string;
}

export function ActionRail({
  role,
  onRefresh,
  refreshDisabled = false,
  className = "",
}: ActionRailProps) {
  const isOperator = role === "operator" || role === "admin";
  const isAdmin = role === "admin";

  return (
    <div
      className={`flex flex-wrap items-center gap-2  border border-border/70 bg-background/50 p-2 ${className}`}
      role="toolbar"
      aria-label="Quick actions"
    >
      <Button
        size="sm"
        variant="outline"
        disabled={refreshDisabled}
        onClick={() => onRefresh?.()}
        aria-label="Refresh snapshot"
      >
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Refresh
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link to="/heliophysics">
          <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
          Dashboard
        </Link>
      </Button>
      {isOperator && (
        <Button size="sm" variant="outline" asChild>
          <Link to="/heliophysics?infer=1">
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Run nowcast
          </Link>
        </Button>
      )}
      {isAdmin && (
        <>
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/users">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Team
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/chronos">
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              Chronos
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
