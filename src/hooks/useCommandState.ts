import { useEffect, useMemo, useState } from "react";
import { useBackendHealth } from "@/hooks/useBackendHealth";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useMissionCoreSnapshot } from "@/hooks/useMissionCoreSnapshot";
import { useOpsCommandSnapshot } from "@/hooks/useOpsCommandSnapshot";
import { usePowerProfile } from "@/hooks/usePowerProfile";
import { useSolarWind5s } from "@/hooks/useSolarWind5s";
import { useThreatSummary } from "@/hooks/useThreatSummary";
import {
    fetchOpsCommandJob,
    fetchOpsCommandMetrics,
    planOpsCommandWithModel,
    queueOpsCommand,
} from "@/lib/api/heliophysics-proxy";
import type { OpsCommandJob, OpsCommandPlan } from "@/lib/types/space-weather";
import { rollupSources } from "@/lib/source-truth";

export function useCommandState() {
    const [plannerPrompt, setPlannerPrompt] = useState("Assess current ops state and propose the next mission command.");
    const [plannerContextRaw, setPlannerContextRaw] = useState("{\"station\":\"GAUSS-GS-1\",\"origin\":\"command-page\"}");
    const [plannerPlan, setPlannerPlan] = useState<OpsCommandPlan | null>(null);
    const [activeJob, setActiveJob] = useState<OpsCommandJob | null>(null);
    const [plannerBusy, setPlannerBusy] = useState(false);
    const [plannerError, setPlannerError] = useState<string | null>(null);
    const [plannerInfo, setPlannerInfo] = useState<string | null>(null);
    const [metricsInfo, setMetricsInfo] = useState<{
        queueDepth: number;
        plannerAvgMs: number;
        successRate: number;
        batteryThrottleHits: number;
    } | null>(null);

    const mission = useMissionSnapshot();
    const backendHealth = useBackendHealth({ basePollMs: 30_000 });
    const { profile: uiPowerProfile } = usePowerProfile();
    const opsEnabled = mission.session ? !mission.session.authRequired || mission.session.authenticated : true;
    const criticalOpsMode = backendHealth.memoryLevel === "critical";
    const ops = useOpsCommandSnapshot(opsEnabled, backendHealth.memoryLevel);

    const session = ops.data?.session ?? mission.session;
    const canViewProtectedFeeds = session ? !session.authRequired || session.authenticated : false;

    const solarWind = useSolarWind5s({ enabled: canViewProtectedFeeds && !criticalOpsMode });
    const threats = useThreatSummary({
        enabled: canViewProtectedFeeds && !criticalOpsMode,
        governorLevel: backendHealth.memoryLevel,
    });
    const missionCore = useMissionCoreSnapshot({
        enabled: canViewProtectedFeeds && !criticalOpsMode,
        governorLevel: backendHealth.memoryLevel,
    });

    const canonical = ops.data?.canonicalLatest ?? mission.snapshot?.canonicalLatest ?? solarWind.latest;
    const summary = ops.data?.threatSummary ?? threats.data;
    const sourceStatus = ops.data?.sourceStatus ?? mission.snapshot?.sourceStatus ?? [];
    const passes = missionCore.data?.passes ?? [];
    // Probes and an empty list are unknown, never healthy (GAU-81).
    const sourceHealth = rollupSources(sourceStatus);
    const sourceStatusHealthy = sourceHealth.state === "healthy";

    const telemetryRows = solarWind.points.slice(-10).reverse();
    const workers = ops.data?.workers ?? [];
    const queuedApprovals = ops.data?.queuedApprovals ?? [];
    const brokerPolicy = ops.data?.brokerPolicy ?? null;

    const handleRefresh = () => {
        void mission.refresh();
        void ops.refresh();
        void missionCore.refresh();
    };

    const plannerContext = useMemo(() => {
        try {
            const parsed = JSON.parse(plannerContextRaw) as unknown;
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : null;
        } catch {
            return null;
        }
    }, [plannerContextRaw]);

    const buildCommandContext = async (): Promise<Record<string, unknown> | null> => {
        if (!plannerContext) return null;
        const merged: Record<string, unknown> = {
            ...plannerContext,
            power: {
                uiProfile: uiPowerProfile,
            },
        };
        try {
            const nav = navigator as Navigator & {
                getBattery?: () => Promise<{
                    level: number;
                    charging: boolean;
                }>;
            };
            if (typeof nav.getBattery === "function") {
                const battery = await nav.getBattery();
                const power = merged.power && typeof merged.power === "object" && !Array.isArray(merged.power)
                    ? (merged.power as Record<string, unknown>)
                    : {};
                power.batteryPercent = Math.round((battery.level ?? 1) * 100);
                power.charging = Boolean(battery.charging);
                merged.power = power;
            }
        } catch {
            // Battery API is optional
        }
        return merged;
    };

    useEffect(() => {
        if (!canViewProtectedFeeds) return;
        let cancelled = false;
        let timer: number | null = null;

        const load = async () => {
            try {
                const data = await fetchOpsCommandMetrics();
                if (cancelled) return;
                const metrics = (data.metrics ?? {}) as Record<string, unknown>;
                const queueDepth = Number(metrics.queue_depth ?? 0);
                const plannerAvgMs = Number(metrics.planner_latency_avg_ms ?? 0);
                const executionTotal = Number(metrics.execution_total ?? 0);
                const executionSucceeded = Number(metrics.execution_succeeded_total ?? 0);
                const successRate = executionTotal > 0 ? (executionSucceeded / executionTotal) * 100 : 100;
                const batteryThrottleHits = Number(metrics.battery_throttle_hits_total ?? 0);
                setMetricsInfo({
                    queueDepth: Number.isFinite(queueDepth) ? queueDepth : 0,
                    plannerAvgMs: Number.isFinite(plannerAvgMs) ? plannerAvgMs : 0,
                    successRate: Number.isFinite(successRate) ? successRate : 0,
                    batteryThrottleHits: Number.isFinite(batteryThrottleHits) ? batteryThrottleHits : 0,
                });
            } catch {
                // keep UI running
            } finally {
                if (!cancelled) {
                    timer = window.setTimeout(load, 12_000);
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
            if (timer !== null) window.clearTimeout(timer);
        };
    }, [canViewProtectedFeeds]);

    useEffect(() => {
        if (!activeJob || (activeJob.status !== "planned" && activeJob.status !== "running")) return;
        let cancelled = false;
        let timer: number | null = null;

        const poll = async () => {
            try {
                const job = await fetchOpsCommandJob(activeJob.jobId);
                if (cancelled) return;
                setActiveJob(job);
            } catch (error) {
                if (!cancelled) {
                    setPlannerError(error instanceof Error ? error.message : "Failed to poll command job.");
                }
            } finally {
                if (!cancelled) {
                    timer = window.setTimeout(poll, 1_500);
                }
            }
        };

        timer = window.setTimeout(poll, 1_200);
        return () => {
            cancelled = true;
            if (timer !== null) window.clearTimeout(timer);
        };
    }, [activeJob?.jobId, activeJob?.status]);

    const handlePlanPreview = async () => {
        const runtimeContext = await buildCommandContext();
        if (!runtimeContext) {
            setPlannerError("Context JSON is invalid.");
            return;
        }
        setPlannerBusy(true);
        setPlannerError(null);
        setPlannerInfo(null);
        try {
            const response = await planOpsCommandWithModel({
                prompt: plannerPrompt,
                context: runtimeContext,
                execute: false,
            });
            setPlannerPlan(response.command);
            setPlannerInfo("Plan preview generated.");
            setActiveJob(null);
        } catch (error) {
            setPlannerError(error instanceof Error ? error.message : "Failed to plan command.");
        } finally {
            setPlannerBusy(false);
        }
    };

    const enqueueFromPlan = async (simulate: boolean) => {
        if (!plannerPlan) {
            setPlannerError("Generate a plan preview first.");
            return;
        }
        const runtimeContext = await buildCommandContext();
        if (!runtimeContext) {
            setPlannerError("Context JSON is invalid.");
            return;
        }
        setPlannerBusy(true);
        setPlannerError(null);
        setPlannerInfo(null);
        try {
            const response = await queueOpsCommand({
                command_type: plannerPlan.command_type,
                payload: plannerPlan.payload,
                execute: true,
                simulate,
                context: runtimeContext,
                idempotency_key: `${simulate ? "sim" : "exec"}-${plannerPlan.command_type}-${Date.now()}`,
            });
            const maybeJob = (response as { job?: OpsCommandJob }).job;
            if (maybeJob) {
                setActiveJob(maybeJob);
                setPlannerInfo(simulate ? "Simulation queued." : "Execution queued.");
            } else {
                setPlannerInfo("Command logged.");
            }
        } catch (error) {
            setPlannerError(error instanceof Error ? error.message : "Failed to enqueue command.");
        } finally {
            setPlannerBusy(false);
        }
    };

    const denyPlan = () => {
        setPlannerPlan(null);
        setPlannerError(null);
        setPlannerInfo("Plan denied.");
    };

    const replayLastJob = async (simulate: boolean) => {
        if (!activeJob) {
            setPlannerError("No command job available to replay.");
            return;
        }
        const runtimeContext = await buildCommandContext();
        if (!runtimeContext) {
            setPlannerError("Context JSON is invalid.");
            return;
        }
        setPlannerBusy(true);
        setPlannerError(null);
        setPlannerInfo(null);
        try {
            const response = await queueOpsCommand({
                command_type: activeJob.commandType,
                payload: activeJob.payload,
                execute: true,
                simulate,
                context: runtimeContext,
                idempotency_key: `replay-${activeJob.jobId}-${simulate ? "sim" : "exec"}-${Date.now()}`,
            });
            const maybeJob = (response as { job?: OpsCommandJob }).job;
            if (maybeJob) {
                setActiveJob(maybeJob);
                setPlannerInfo(simulate ? "Replay simulation queued." : "Replay execution queued.");
            } else {
                setPlannerInfo("Replay command logged.");
            }
        } catch (error) {
            setPlannerError(error instanceof Error ? error.message : "Failed to replay command.");
        } finally {
            setPlannerBusy(false);
        }
    };

    return {
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
        backendHealth,
        criticalOpsMode,
        plannerMode: backendHealth.health?.memory?.plannerMode ?? "auto",
        session,
        canViewProtectedFeeds,
        solarWind,
        threats,
        missionCore,
        canonical,
        summary,
        sourceStatus,
        passes,
        sourceStatusHealthy,
        sourceHealth,
        telemetryRows,
        handleRefresh,
        refreshSession: mission.refreshSession,
        handlePlanPreview,
        enqueueFromPlan,
        denyPlan,
        replayLastJob,
        refreshOps: ops.refresh,
        workers,
        queuedApprovals,
        brokerPolicy,
    };
}
