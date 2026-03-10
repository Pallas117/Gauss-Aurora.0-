/**
 * HUD banner shown when threat fusion indicates high risk.
 * Surfaces top recommended action and an AI-style suggestion for critical operations.
 */

import { AlertTriangle, Lightbulb } from "lucide-react";
import { Link } from "react-router-dom";
import type { ThreatSummaryResponse } from "@/lib/types/space-weather";

const HIGH_RISK_PROB_THRESHOLD = 0.6;

function isHighRisk(summary: ThreatSummaryResponse): boolean {
  const gate = summary.gate;
  if (gate.action === "TRIGGER_LLM" || gate.is_urgent) return true;
  const top = summary.threats[0];
  if (top && top.probability >= HIGH_RISK_PROB_THRESHOLD) return true;
  const rec = summary.summary?.top_recommended_action ?? "";
  if (/IMMEDIATE|EVASION|ALERT|CRITICAL/i.test(rec)) return true;
  return false;
}

function suggestionFromSummary(summary: ThreatSummaryResponse): string {
  const top = summary.threats[0];
  const rec = summary.summary?.top_recommended_action ?? top?.recommended_action ?? summary.gate.reason;
  if (rec) return rec;
  if (summary.gate.action === "TRIGGER_LLM") {
    return "Review threat fusion and consider escalating to LLM reasoning. Check Command for full decision cards.";
  }
  return "Review one-screen decision summary on Command. Monitor threat factors.";
}

export interface RiskHudBannerProps {
  threatSummary: ThreatSummaryResponse | null;
  className?: string;
}

export function RiskHudBanner({ threatSummary, className = "" }: RiskHudBannerProps) {
  if (!threatSummary || !isHighRisk(threatSummary)) return null;

  const suggestion = suggestionFromSummary(threatSummary);
  const topRec = threatSummary.summary?.top_recommended_action ?? threatSummary.threats[0]?.recommended_action ?? null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={
        "flex flex-wrap items-center gap-3 rounded-lg border-2 border-destructive/60 bg-destructive/10 px-4 py-2.5 text-sm " +
        className
      }
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-destructive">High risk</p>
        {topRec && (
          <p className="text-foreground mt-0.5">{topRec}</p>
        )}
        <p className="mt-1 flex items-start gap-2 text-muted-foreground">
          <Lightbulb className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span><strong className="text-foreground">Suggestion:</strong> {suggestion}</span>
        </p>
      </div>
      <Link
        to="/command"
        className="shrink-0 rounded border border-destructive/50 bg-destructive/20 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/30"
      >
        View Command
      </Link>
    </div>
  );
}
