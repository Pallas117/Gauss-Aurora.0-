import { useMemo } from "react";
import { Clock, Satellite, AlertCircle, CheckCircle } from "lucide-react";
import type { MissionPassWindow } from "@/lib/types/space-weather";
import type { ThreatSummaryResponse } from "@/lib/types/space-weather";
import type { SourceHealth } from "@/lib/source-truth";

export interface TimelineEvent {
  id: string;
  type: "pass" | "alert" | "action";
  label: string;
  detail?: string;
  time: string;
  status?: "planned" | "scheduled" | "active" | "completed";
}

interface OperatorTimelineProps {
  passes: MissionPassWindow[];
  gateAction: "TRIGGER_LLM" | "LOG_AND_SLEEP" | null;
  stormTier: string;
  topRecommendedAction: string | null;
  /** "unknown" when no measuring source is present (GAU-81). */
  sourceHealth: SourceHealth;
  className?: string;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function OperatorTimeline({
  passes,
  gateAction,
  stormTier,
  topRecommendedAction,
  sourceHealth,
  className = "",
}: OperatorTimelineProps) {
  const events = useMemo((): TimelineEvent[] => {
    const out: TimelineEvent[] = [];

    passes.slice(0, 8).forEach((p) => {
      out.push({
        id: p.passId,
        type: "pass",
        label: `${p.target} @ ${p.station}`,
        detail: `${p.status}`,
        time: formatTime(p.aos),
        status: p.status,
      });
    });

    out.push({
      id: "alert-gate",
      type: "alert",
      label: "Gate",
      detail: gateAction ?? "—",
      time: "now",
    });
    out.push({
      id: "alert-storm",
      type: "alert",
      label: "Storm",
      detail: stormTier,
      time: "now",
    });
    if (sourceHealth !== "healthy") {
      out.push({
        id: "alert-sources",
        type: "alert",
        label: "Sources",
        detail: sourceHealth === "degraded" ? "Degraded" : "Unknown (no measuring source)",
        time: "now",
      });
    }
    if (topRecommendedAction) {
      out.push({
        id: "action-top",
        type: "action",
        label: "Recommended",
        detail: topRecommendedAction,
        time: "now",
      });
    }

    return out;
  }, [passes, gateAction, stormTier, topRecommendedAction, sourceHealth]);

  return (
    <div
      className={`space-y-2 overflow-x-auto  border border-border/70 bg-background/50 p-3 ${className}`}
      role="region"
      aria-label="Operator timeline"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        Timeline
      </div>
      <ul className="flex flex-col gap-1.5 text-xs">
        {events.length === 0 ? (
          <li className="text-muted-foreground">No events. Timeline updates from mission snapshot.</li>
        ) : (
          events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start gap-2 rounded border border-border/50 bg-background/30 px-2 py-1.5"
              data-testid={`timeline-event-${ev.type}-${ev.id}`}
            >
              <span className="mt-0.5 shrink-0 text-muted-foreground">{ev.time}</span>
              {ev.type === "pass" && <Satellite className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              {ev.type === "alert" && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
              {ev.type === "action" && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-primary" />}
              <div className="min-w-0 flex-1">
                <span className="font-medium">{ev.label}</span>
                {ev.detail ? (
                  <span className="ml-1 text-muted-foreground">· {ev.detail}</span>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
