import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OpsLaneLinks } from "@/components/ops/OpsLaneLinks";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { useOpsWorkerMesh } from "@/hooks/useOpsWorkerMesh";
import { usePowerProfile } from "@/hooks/usePowerProfile";
import { getAuthHeaders } from "@/lib/api/auth";
import {
  updateSourcePolicyOverride,
  type SourceOverrideDecision,
} from "@/lib/api/operator-sources";
import { getApiBaseUrl } from "@/lib/api/base-url";
import { getAdaptivePollInterval } from "@/lib/power/polling";
import { rollupSources } from "@/lib/source-truth";

const BASE_URL = getApiBaseUrl();

interface CyberTigerStatusPayload {
  timestamp: string;
  status: {
    enabled: boolean;
    counters?: {
      totalInspected?: number;
      blocked?: number;
      signatureHits?: number;
      rateLimited?: number;
      authFailures?: number;
      activeBlocks?: number;
      storedEvents?: number;
    };
  };
}

const SOURCE_OVERRIDE_OPTIONS: Array<{
  value: SourceOverrideDecision | null;
  label: string;
}> = [
  { value: null, label: "Auto" },
  { value: "primary", label: "Primary" },
  { value: "validate", label: "Validate" },
  { value: "sample", label: "Sample" },
  { value: "suspend", label: "Suspend" },
];

function formatCadenceLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return "suspended";
  }
  if (ms >= 60_000 && ms % 60_000 === 0) {
    return `${Math.round(ms / 60_000)}m`;
  }
  if (ms >= 1000 && ms % 1000 === 0) {
    return `${Math.round(ms / 1000)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function formatMetric(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(digits);
}

function sourceDecisionVariant(
  decision: "primary" | "validate" | "sample" | "suspend" | undefined,
  healthy: boolean,
): "secondary" | "destructive" | "outline" {
  if (decision === "suspend") {
    return "destructive";
  }
  if (decision === "primary" && healthy) {
    return "secondary";
  }
  return "outline";
}

export default function AutomationPage() {
  const mission = useMissionSnapshot();
  const { profile, isConstraintDetected, isLowPower } = usePowerProfile();
  const workerMesh = useOpsWorkerMesh(mission.session?.authenticated === true);

  const [cyberTiger, setCyberTiger] = useState<CyberTigerStatusPayload | null>(null);
  const [cyberTigerError, setCyberTigerError] = useState<string | null>(null);
  const [lightsOutMode, setLightsOutMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [overrideBusySource, setOverrideBusySource] = useState<string | null>(null);
  const [overrideMessage, setOverrideMessage] = useState<string | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const sourceStatus = mission.snapshot?.sourceStatus ?? [];
  const sources = rollupSources(sourceStatus);
  const powerDecisionCounts = useMemo(() => {
    return sourceStatus.reduce(
      (acc, source) => {
        const key = source.powerDecision ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [sourceStatus]);
  const highestCostSources = useMemo(
    () =>
      [...sourceStatus]
        .sort((a, b) => (b.observedCostScore ?? -1) - (a.observedCostScore ?? -1))
        .slice(0, 3),
    [sourceStatus],
  );
  const sourceOverrideRows = useMemo(
    () =>
      [...sourceStatus].sort((a, b) => {
        const overrideDelta =
          Number(Boolean(b.overrideDecision ?? b.overrideTargetCadenceMs ?? b.overrideReason)) -
          Number(Boolean(a.overrideDecision ?? a.overrideTargetCadenceMs ?? a.overrideReason));
        if (overrideDelta !== 0) {
          return overrideDelta;
        }
        const costDelta = (b.observedCostScore ?? -1) - (a.observedCostScore ?? -1);
        if (costDelta !== 0) {
          return costDelta;
        }
        return a.source.localeCompare(b.source);
      }),
    [sourceStatus],
  );

  const canInspectCyberTiger =
    mission.session != null &&
    mission.session.authenticated &&
    (mission.session.role === "operator" || mission.session.role === "admin");
  const canManageSourceOverrides = canInspectCyberTiger;

  const loadCyberTigerStatus = useCallback(async () => {
    if (!canInspectCyberTiger) {
      setCyberTiger(null);
      setCyberTigerError("Operator/admin role required for CyberTiger telemetry.");
      return;
    }

    setRefreshing(true);
    try {
      const response = await fetch(`${BASE_URL}/api/security/cybertiger/status`, {
        headers: await getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`cybertiger status HTTP ${response.status}`);
      }
      const payload = (await response.json()) as CyberTigerStatusPayload;
      setCyberTiger(payload);
      setCyberTigerError(null);
    } catch (error) {
      setCyberTiger(null);
      setCyberTigerError(error instanceof Error ? error.message : "Failed to load CyberTiger status");
    } finally {
      setRefreshing(false);
    }
  }, [canInspectCyberTiger]);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;

    const stopTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      if (!active || !canInspectCyberTiger) {
        return;
      }
      stopTimer();
      timer = window.setTimeout(() => {
        void tick();
      }, getAdaptivePollInterval(10_000));
    };

    const tick = async () => {
      if (!active || !canInspectCyberTiger) {
        return;
      }
      await loadCyberTigerStatus();
      schedule();
    };

    if (canInspectCyberTiger) {
      void tick();
    } else {
      setCyberTiger(null);
      setCyberTigerError("Operator/admin role required for CyberTiger telemetry.");
    }

    return () => {
      active = false;
      stopTimer();
    };
  }, [canInspectCyberTiger, loadCyberTigerStatus]);

  const handleSourceOverride = useCallback(
    async (source: string, overrideDecision: SourceOverrideDecision | null) => {
      if (!canManageSourceOverrides) {
        setOverrideError("Operator/admin role required for source overrides.");
        return;
      }

      setOverrideBusySource(source);
      setOverrideError(null);
      setOverrideMessage(null);
      try {
        const response = await updateSourcePolicyOverride(source, {
          overrideDecision,
          overrideTargetCadenceMs: overrideDecision == null ? null : undefined,
          overrideReason: overrideDecision ? "Pinned via automation controls" : null,
        });
        await mission.refresh();
        setOverrideMessage(
          response.persisted
            ? overrideDecision
              ? `${source} pinned to ${overrideDecision}.`
              : `${source} returned to adaptive mode.`
            : `${source} override applied locally. Supabase persistence is unavailable.`,
        );
      } catch (error) {
        setOverrideError(error instanceof Error ? error.message : "Failed to update source override");
      } finally {
        setOverrideBusySource(null);
      }
    },
    [canManageSourceOverrides, mission],
  );

  const cadenceSeconds = useMemo(() => {
    if (isLowPower || lightsOutMode) return 10;
    if (profile === "performance") return 2;
    return 5;
  }, [isLowPower, lightsOutMode, profile]);

  return (
    <div className="space-y-4">
      <OpsLaneLinks compact showHub />
      <section className="grid gap-4 xl:grid-cols-3" data-testid="automation-page">
        <div className="xl:col-span-3 space-y-1">
          <h3 className="text-lg font-semibold tracking-tight">Automation Controls</h3>
          <p className="text-sm text-muted-foreground">
            Tune cadence, power posture, and security telemetry for mission continuity.
          </p>
        </div>
        <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Worker Cadence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">poll every {cadenceSeconds}s</Badge>
            <Badge variant={lightsOutMode ? "secondary" : "outline"}>
              {lightsOutMode ? "lights-out mode" : "interactive mode"}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Lights-out command is UI-only until backend command endpoint is enabled.
          </p>
          <Button
            variant={lightsOutMode ? "secondary" : "outline"}
            className="w-full"
            onClick={() => setLightsOutMode((prev) => !prev)}
          >
            {lightsOutMode ? "Disable lights-out" : "Enable lights-out"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Specialist Workers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {workerMesh.queue.brokerPolicy?.memoryLevel ?? "nominal"} governor
            </Badge>
            <Badge variant="outline">
              DeepSeek {workerMesh.queue.brokerPolicy?.deepseekMode ?? "auto"}
            </Badge>
            <Badge variant="secondary">
              {workerMesh.workers.filter((worker) => worker.enabled).length} enabled
            </Badge>
          </div>
          <div className="space-y-2">
            {workerMesh.workers.map((worker) => (
              <div
                key={worker.id}
                className="rounded border border-border/70 bg-background/40 p-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{worker.id}</span>
                  <Badge variant={worker.state === "degraded" ? "destructive" : "outline"}>
                    {worker.state}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {worker.lastResult?.summary ?? "No worker result recorded yet."}
                </p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {worker.lane} · {worker.approval}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Safe-auto workers can self-heal bounded runtime issues. Mission actions still wait in the approval queue.
          </p>
        </CardContent>
      </Card>

        <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Power Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            active profile: <span className="font-semibold">{profile}</span>
          </p>
          <p>
            constraint signals: <span className="font-semibold">{isConstraintDetected ? "detected" : "clear"}</span>
          </p>
          <p>
            source health: <span className="font-semibold">{sources.state === "unknown" ? "unknown (no measuring source)" : `${sources.healthy}/${sources.measuring} healthy`}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {(sourceStatus.length > 0 ? sourceStatus : [{ source: "none", healthy: false } as const]).map((source) => (
              <Badge key={source.source} variant={source.healthy ? "secondary" : "destructive"}>
                {source.source}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">primary {powerDecisionCounts.primary ?? 0}</Badge>
            <Badge variant="outline">validate {powerDecisionCounts.validate ?? 0}</Badge>
            <Badge variant="outline">sample {powerDecisionCounts.sample ?? 0}</Badge>
            <Badge variant="outline">suspend {powerDecisionCounts.suspend ?? 0}</Badge>
          </div>
          <div className="space-y-2">
            {highestCostSources.map((source) => (
              <div
                key={source.source}
                className="rounded border border-border/70 bg-background/40 p-2 text-xs"
                data-testid={`automation-source-policy-${source.source}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{source.source}</span>
                  <Badge variant={sourceDecisionVariant(source.powerDecision, source.healthy)}>
                    {source.powerDecision ?? "unknown"}
                  </Badge>
                  <Badge variant="outline">{formatCadenceLabel(source.targetCadenceMs)}</Badge>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-muted-foreground">
                  <span>cost {formatMetric(source.observedCostScore, 2)}</span>
                  <span>utility {formatMetric(source.utilityScore, 2)}</span>
                  <span>fetch {formatMetric(source.avgFetchDurationMs, 0)} ms</span>
                  <span>payload {formatMetric(source.avgPayloadKb, 1)} kB</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Source Overrides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Pin source policy during demos or incidents. Auto returns a source to adaptive selection.
          </p>

          {overrideError ? <p className="text-destructive">{overrideError}</p> : null}
          {overrideMessage ? <p className="text-muted-foreground">{overrideMessage}</p> : null}

          {!canManageSourceOverrides ? (
            <p className="text-muted-foreground">
              Operator/admin role required for source override control.
            </p>
          ) : sourceOverrideRows.length === 0 ? (
            <Badge variant="outline">No source status yet</Badge>
          ) : (
            <div className="space-y-2">
              {sourceOverrideRows.map((source) => {
                const overrideActive =
                  source.overrideDecision != null ||
                  source.overrideTargetCadenceMs != null ||
                  Boolean(source.overrideReason);
                return (
                  <div
                    key={source.source}
                    className="rounded border border-border/70 bg-background/40 p-3 text-xs"
                    data-testid={`automation-source-override-${source.source}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{source.source}</span>
                      <Badge variant={sourceDecisionVariant(source.powerDecision, source.healthy)}>
                        {source.powerDecision ?? "unknown"}
                      </Badge>
                      <Badge variant={overrideActive ? "secondary" : "outline"}>
                        {source.overrideDecision != null
                          ? `override ${source.overrideDecision}`
                          : overrideActive
                            ? "override custom"
                            : "adaptive"}
                      </Badge>
                      <Badge variant="outline">
                        {formatCadenceLabel(source.overrideTargetCadenceMs ?? source.targetCadenceMs)}
                      </Badge>
                    </div>

                    <div className="mt-1 text-muted-foreground">
                      {overrideActive
                        ? `override ${source.overrideReason ?? "operator-override"}`
                        : source.policyReason ?? "adaptive utility policy"}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {SOURCE_OVERRIDE_OPTIONS.map((option) => {
                        const optionKey = option.value ?? "auto";
                        const selected =
                          option.value == null
                            ? !overrideActive
                            : source.overrideDecision === option.value;
                        const busy = overrideBusySource === source.source;
                        return (
                          <Button
                            key={`${source.source}-${optionKey}`}
                            size="sm"
                            variant={
                              selected
                                ? "secondary"
                                : option.value === "suspend"
                                  ? "destructive"
                                  : "outline"
                            }
                            disabled={busy}
                            data-testid={`automation-source-override-${source.source}-${optionKey}`}
                            aria-label={`Set ${source.source} to ${option.label.toLowerCase()}`}
                            onClick={() => void handleSourceOverride(source.source, option.value)}
                          >
                            {busy && selected ? "Applying..." : option.label}
                          </Button>
                        );
                      })}
                    </div>

                    {source.overrideUpdatedAt ? (
                      <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                        updated {new Date(source.overrideUpdatedAt).toLocaleString()} by{" "}
                        {source.overrideUpdatedBy ?? "operator"}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">CyberTiger Runtime</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant={cyberTiger?.status.enabled ? "secondary" : "destructive"}>
              {cyberTiger?.status.enabled ? "enabled" : "disabled"}
            </Badge>
            <Badge variant="outline">role {mission.session?.role ?? "none"}</Badge>
          </div>

          {cyberTigerError ? <p className="text-destructive">{cyberTigerError}</p> : null}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-border/70 bg-background/40 p-2">
              inspected {cyberTiger?.status.counters?.totalInspected ?? 0}
            </div>
            <div className="rounded border border-border/70 bg-background/40 p-2">
              blocked {cyberTiger?.status.counters?.blocked ?? 0}
            </div>
            <div className="rounded border border-border/70 bg-background/40 p-2">
              signatures {cyberTiger?.status.counters?.signatureHits ?? 0}
            </div>
            <div className="rounded border border-border/70 bg-background/40 p-2">
              rate limits {cyberTiger?.status.counters?.rateLimited ?? 0}
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={() => void loadCyberTigerStatus()} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh CyberTiger status"}
          </Button>
        </CardContent>
        </Card>
      </section>
    </div>
  );
}
