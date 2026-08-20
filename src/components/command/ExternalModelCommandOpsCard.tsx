import { Bot, CheckCircle2, Play, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
    BackendMemoryPressureLevel,
    OpsCommandJob,
    OpsCommandPlan,
} from "@/lib/types/space-weather";

interface ExternalModelCommandOpsCardProps {
    plannerPrompt: string;
    setPlannerPrompt: (value: string) => void;
    plannerContextRaw: string;
    setPlannerContextRaw: (value: string) => void;
    plannerPlan: OpsCommandPlan | null;
    activeJob: OpsCommandJob | null;
    plannerBusy: boolean;
    plannerError: string | null;
    plannerInfo: string | null;
    metricsInfo: {
        queueDepth: number;
        plannerAvgMs: number;
        successRate: number;
        batteryThrottleHits: number;
    } | null;
    canViewProtectedFeeds: boolean;
    memoryLevel: BackendMemoryPressureLevel;
    plannerMode?: string;
    onPlanPreview: () => void;
    onEnqueue: (simulate: boolean) => void;
    onDeny: () => void;
    onReplay: (simulate: boolean) => void;
}

export function ExternalModelCommandOpsCard({
    plannerPrompt,
    setPlannerPrompt,
    plannerContextRaw,
    setPlannerContextRaw,
    plannerPlan,
    activeJob,
    plannerBusy,
    plannerError,
    plannerInfo,
    metricsInfo,
    canViewProtectedFeeds,
    memoryLevel,
    plannerMode,
    onPlanPreview,
    onEnqueue,
    onDeny,
    onReplay,
}: ExternalModelCommandOpsCardProps) {
    const isContextInvalid = !plannerContextRaw.trim() || (() => {
        try {
            JSON.parse(plannerContextRaw);
            return false;
        } catch {
            return true;
        }
    })();

    const plannerDisabled = !canViewProtectedFeeds || memoryLevel === "critical";
    const previewLabel = memoryLevel === "constrained" ? "Request Analysis" : "Plan Preview";

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">External Model Ops</CardTitle>
                    <Badge variant="outline">{memoryLevel}</Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
                <div className="space-y-1">
                    <p className="text-muted-foreground">Prompt</p>
                    <Textarea
                        value={plannerPrompt}
                        onChange={(e) => setPlannerPrompt(e.target.value)}
                        rows={3}
                        className="font-mono text-[11px]"
                    />
                </div>
                <div className="space-y-1">
                    <p className="text-muted-foreground">Context JSON</p>
                    <Textarea
                        value={plannerContextRaw}
                        onChange={(e) => setPlannerContextRaw(e.target.value)}
                        rows={2}
                        className="font-mono text-[11px]"
                    />
                    {isContextInvalid && <p className="text-destructive">Context JSON is invalid.</p>}
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={onPlanPreview}
                        disabled={plannerBusy || plannerDisabled}
                    >
                        <Bot className="mr-2 h-4 w-4" />
                        {previewLabel}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onEnqueue(true)}
                        disabled={plannerBusy || !plannerPlan || plannerDisabled}
                    >
                        <Play className="mr-2 h-4 w-4" />
                        Simulate
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => onEnqueue(false)}
                        disabled={plannerBusy || !plannerPlan || plannerDisabled}
                    >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Approve + Execute
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={onDeny}
                        disabled={plannerBusy || !plannerPlan}
                    >
                        <XCircle className="mr-2 h-4 w-4" />
                        Deny
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onReplay(true)}
                        disabled={
                            plannerBusy ||
                            !activeJob ||
                            activeJob.status === "planned" ||
                            activeJob.status === "running" ||
                            plannerDisabled
                        }
                    >
                        <Play className="mr-2 h-4 w-4" />
                        Replay (Sim)
                    </Button>
                </div>

                {memoryLevel === "constrained" ? (
                    <p className="text-muted-foreground">
                        RAM is constrained. External model integration stays cold until an operator explicitly requests analysis.
                    </p>
                ) : null}

                {memoryLevel === "critical" ? (
                    <p className="text-destructive">
                        External model requests are disabled while RAM is critical. Deterministic controls remain available.
                    </p>
                ) : null}

                {plannerPlan ? (
                    <div className="rounded border border-border/70 bg-background/40 p-2 font-mono text-[11px]">
                        <p>command: {plannerPlan.command_type}</p>
                        <p>confidence: {plannerPlan.confidence == null ? "n/a" : plannerPlan.confidence.toFixed(2)}</p>
                        <p>reason: {plannerPlan.reason ?? "n/a"}</p>
                        <pre className="mt-1 overflow-auto text-[10px]">{JSON.stringify(plannerPlan.payload, null, 2)}</pre>
                    </div>
                ) : (
                    <p className="text-muted-foreground">No plan yet.</p>
                )}

                {activeJob && (
                    <div className="rounded border border-border/70 bg-background/40 p-2">
                        <div className="flex items-center justify-between">
                            <span className="font-medium">Job {activeJob.jobId.slice(0, 8)}</span>
                            <Badge
                                variant={
                                    activeJob.status === "succeeded"
                                        ? "secondary"
                                        : activeJob.status === "failed"
                                            ? "destructive"
                                            : "outline"
                                }
                            >
                                {activeJob.status}
                            </Badge>
                        </div>
                        <p className="text-muted-foreground">
                            mode: {activeJob.simulate ? "simulate" : "live"} | command: {activeJob.commandType}
                        </p>
                        {activeJob.error ? <p className="text-destructive">{activeJob.error}</p> : null}
                    </div>
                )}

                {metricsInfo && (
                    <div className="rounded border border-border/70 bg-background/40 p-2 text-muted-foreground">
                        <p>queue depth: {metricsInfo.queueDepth}</p>
                        <p>planner avg latency: {metricsInfo.plannerAvgMs.toFixed(0)} ms</p>
                        <p>execution success: {metricsInfo.successRate.toFixed(1)}%</p>
                        <p>battery throttles: {metricsInfo.batteryThrottleHits}</p>
                    </div>
                )}

                {plannerInfo ? <p className="text-muted-foreground">{plannerInfo}</p> : null}
                {plannerError ? <p className="text-destructive">{plannerError}</p> : null}
            </CardContent>
        </Card>
    );
}
