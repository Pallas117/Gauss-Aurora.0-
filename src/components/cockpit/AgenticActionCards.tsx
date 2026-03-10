import { AlertTriangle, Brain, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAiContext } from "@/contexts/AiContext";

export function AgenticActionCards() {
    const { recommendations, dismissRecommendation } = useAiContext();

    if (recommendations.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3 pointer-events-auto w-full animate-fade-in-up">
            {recommendations.map((rec) => (
                <Card key={rec.id} className="border-purple-500/50 bg-background/90 shadow-[0_0_15px_rgba(168,85,247,0.15)] relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-purple-500" />

                    <CardHeader className="pb-2 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 pl-2">
                            <CardTitle className="text-sm flex items-center gap-2 text-purple-400">
                                <Brain className="h-4 w-4" />
                                DeepSeek-R1 Priority Action
                            </CardTitle>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="border-purple-500/30 text-purple-300 bg-purple-500/10 hover:bg-purple-500/20">
                                    <span className="flex items-center gap-1.5">
                                        <AlertTriangle className="h-3 w-3" />
                                        Threat: {rec.type}
                                    </span>
                                </Badge>
                                <button
                                    type="button"
                                    onClick={() => dismissRecommendation(rec.id, "Operator dismissed.")}
                                    className="text-muted-foreground hover:text-foreground transition-colors p-1"
                                >
                                    <X className="h-3.5 w-3.5" />
                                    <span className="sr-only">Dismiss</span>
                                </button>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-3 pl-6 text-sm">
                        <div className="rounded border border-purple-500/30 bg-purple-500/5 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-purple-400/80 mb-1">
                                Suggested Co-Pilot Mitigation
                            </p>
                            <p className="font-mono font-semibold text-purple-100 tracking-tight">
                                {rec.recommended_action}
                            </p>
                            <p className="mt-2 text-[11px] text-muted-foreground font-mono">
                                Probability: {(rec.probability * 100).toFixed(1)}% · CI [{((rec.confidence_interval?.[0] ?? 0) * 100).toFixed(0)}%–{((rec.confidence_interval?.[1] ?? 0) * 100).toFixed(0)}%]
                            </p>
                        </div>

                        {rec.factors && rec.factors.length > 0 && (
                            <div className="pt-1">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                                    Identified Causality Factors
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {rec.factors.map((f, i) => (
                                        <Badge key={i} variant="secondary" className="text-[10px] font-mono bg-secondary/50">
                                            {f.name} (w={f.contribution.toFixed(2)})
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 pt-2">
                            <Button
                                type="button"
                                variant="tactile"
                                onClick={() => dismissRecommendation(rec.id, "EXECUTED")}
                                className="w-full text-xs font-bold font-mono tracking-widest uppercase py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border-purple-500/50"
                            >
                                Execute
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => dismissRecommendation(rec.id, "REJECTED (Standby)")}
                                className="w-full text-xs font-bold font-mono tracking-widest uppercase py-2"
                            >
                                Standby
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
