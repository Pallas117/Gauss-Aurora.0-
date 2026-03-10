/**
 * Triad (Surya + DeepSeek) mission assessment panel.
 * Run Triad pipeline and show last report; optionally push summary as a recommendation to AgenticActionCards.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTriadReport, type TriadReport } from "@/hooks/useTriadReport";
import { useAiContext } from "@/contexts/AiContext";
import { Play, Sun, Brain } from "lucide-react";

const DEFAULT_SOURCE_PATH = "telemetry_drop/latest.csv";

function triadReportToRecommendation(report: TriadReport) {
  const summary = report.summary ?? report.deepseek?.recommendation ?? "";
  const suryaVal =
    report.surya?.forecast?.length > 0
      ? report.surya.forecast.reduce((a, p) => a + (p?.value ?? 0), 0) / report.surya.forecast.length
      : 0;
  return {
    id: `triad-${report.timestamp ?? Date.now()}`,
    type: "mission_assessment",
    probability: Math.max(0.5, Math.min(0.95, 0.6 + suryaVal * 0.2)),
    confidence_interval: [0.7, 0.9] as [number, number],
    recommended_action: summary.slice(0, 300),
    factors: [
      { name: "Surya", contribution: suryaVal },
      { name: "DeepSeek", contribution: report.deepseek?.stub === false ? 0.9 : 0.5 },
    ],
  };
}

export function TriadPanel() {
  const { report, loading, error, runTriad } = useTriadReport();
  const { recommendations, setRecommendations, logOperatorAction } = useAiContext();

  const handleRunTriad = async () => {
    const result = await runTriad(DEFAULT_SOURCE_PATH);
    if (result) {
      const rec = triadReportToRecommendation(result);
      setRecommendations([...recommendations, rec]);
      logOperatorAction("TRIAD", `Triad assessment: ${result.summary?.slice(0, 80) ?? "—"}…`);
    }
  };

  return (
    <Card data-testid="triad-panel" className="border-purple-500/30 bg-background/90">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sun className="h-4 w-4 text-amber-400" />
            <Brain className="h-4 w-4 text-purple-400" />
            Surya + DeepSeek Triad
          </CardTitle>
          <Button
            size="sm"
            variant="tactile"
            onClick={handleRunTriad}
            disabled={loading}
            className="gap-1"
          >
            <Play className="h-3 w-3" />
            {loading ? "Running…" : "Run Triad"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && (
          <p className="text-destructive font-mono text-xs">{error}</p>
        )}
        {report && (
          <>
            <div className="rounded border border-purple-500/20 bg-purple-500/5 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Assessment
              </p>
              <p className="font-mono text-purple-200">{report.summary || report.deepseek?.recommendation || "—"}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="text-[10px]">
                Surya: {report.surya?.stub ? "stub" : "live"}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                DeepSeek: {report.deepseek?.stub ? "stub" : "live"}
              </Badge>
            </div>
          </>
        )}
        {!report && !error && !loading && (
          <p className="text-muted-foreground text-xs">
            Run Triad to get a mission assessment from Surya forecast + DeepSeek. Result will appear in priority actions.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
