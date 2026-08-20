import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, LockKeyhole, ShieldAlert, XCircle } from "lucide-react";
import { ActionRail } from "@/components/cockpit/ActionRail";
import { OperatorTimeline } from "@/components/cockpit/OperatorTimeline";
import { OperatorDecisionCards } from "@/components/cockpit/OperatorDecisionCards";
import { AuthSessionModal } from "@/components/heliophysics/AuthSessionModal";
import { FeedbackPanel } from "@/components/heliophysics/FeedbackPanel";
import { MissionSurfaceLinks } from "@/components/MissionSurfaceLinks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  approveOpsDelegationTask,
  rejectOpsDelegationTask,
} from "@/lib/api/heliophysics-proxy";
import { useCommandState } from "@/hooks/useCommandState";

// Atomized Components
import { CommandSnapshotCard } from "@/components/command/CommandSnapshotCard";
import { TelemetryStreamCard } from "@/components/command/TelemetryStreamCard";
import { ExternalModelCommandOpsCard } from "@/components/command/ExternalModelCommandOpsCard";
import { CommandHealthThreats } from "@/components/command/CommandHealthThreats";

export default function CommandPage() {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const {
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
    plannerMode,
    criticalOpsMode,
    session,
    canViewProtectedFeeds,
    solarWind,
    threats,
    canonical,
    summary,
    sourceStatus,
    passes,
    sourceStatusHealthy,
    telemetryRows,
    handleRefresh,
    refreshSession,
    handlePlanPreview,
    enqueueFromPlan,
    denyPlan,
    replayLastJob,
    refreshOps,
    workers,
    queuedApprovals,
    brokerPolicy,
  } = useCommandState();

  const plannerWorkers = workers.filter(
    (worker) => worker.id === "command-planner" || worker.id === "safe-executor",
  );
  const runtimeWorkers = workers.filter((worker) => worker.lane === "runtime");

  const handleApproval = async (taskId: string, approved: boolean) => {
    setApprovalBusyId(taskId);
    setApprovalMessage(null);
    try {
      if (approved) {
        await approveOpsDelegationTask({ taskId });
        setApprovalMessage("Mission action approved and queued.");
      } else {
        await rejectOpsDelegationTask({ taskId });
        setApprovalMessage("Mission action rejected.");
      }
      await refreshOps();
      handleRefresh();
    } catch (error) {
      setApprovalMessage(error instanceof Error ? error.message : "Approval update failed.");
    } finally {
      setApprovalBusyId(null);
    }
  };

  if (!canViewProtectedFeeds) {
    return (
      <section className="space-y-4" data-testid="command-page">
        <MissionSurfaceLinks compact />

        <Card className="border-[#FF4D00]/30 bg-[#0A0605] text-white">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2 text-[#FF9A3C]">
              <ShieldAlert className="h-4 w-4" />
              <span className="font-mono text-[11px] uppercase tracking-[0.24em]">Protected route</span>
            </div>
            <CardTitle className="text-2xl">Mission command requires sign-in</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
            <div className="space-y-4">
              <p className="max-w-2xl text-sm leading-6 text-white/72">
                The command lane is local-first and role-gated. Public SDA stays open for live orbital
                awareness, but command planning, operator telemetry, and queue controls stay behind a
                signed-in mission session.
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">public lane</p>
                  <p className="mt-2 text-sm text-white">Orbital awareness remains open on `/sda`.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">protected feeds</p>
                  <p className="mt-2 text-sm text-white">5s telemetry, source health, and DeepSeek planning stay gated.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">current signal</p>
                  <p className="mt-2 text-sm text-white">
                    {canonical
                      ? `Storm ${canonical.alerts.stormTier ?? "unknown"} • ${Math.round(canonical.solarWind.speed)} km/s`
                      : "Awaiting authenticated command feed"}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-white/10 bg-black/35 p-4">
              <Button className="w-full justify-between" onClick={() => setAuthModalOpen(true)}>
                Open mission access portal
                <LockKeyhole className="h-4 w-4" />
              </Button>
              <Button asChild variant="outline" className="w-full justify-between">
                <Link to="/sda">
                  Return to public SDA
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-between">
                <Link to="/signup">
                  Open signup portal
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <p className="text-xs leading-5 text-white/55">
                Sign in here when you need protected mission controls. Until then, stay on the public
                orbital lane to keep render cost and auth friction down.
              </p>
            </div>
          </CardContent>
        </Card>

        <AuthSessionModal
          open={authModalOpen}
          onOpenChange={setAuthModalOpen}
          session={session}
          onSessionRefresh={refreshSession}
        />
      </section>
    );
  }

  return (
    <section className="space-y-4" data-testid="command-page">
      <MissionSurfaceLinks compact />

      {criticalOpsMode ? (
        <Card className="border-[#FF4D00]/25 bg-[#090606] text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Minimal ops summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">runtime</p>
              <p className="mt-1 text-white">RAM {backendHealth.memoryLevel}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">storm</p>
              <p className="mt-1 text-white">{canonical?.alerts.stormTier ?? "unknown"}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">top threat</p>
              <p className="mt-1 text-white">{summary?.summary?.top_threat_type ?? "none"}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">sources</p>
              <p className="mt-1 text-white">{sourceStatusHealthy ? "nominal" : "degraded"}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ActionRail
          role={session?.role ?? null}
          onRefresh={handleRefresh}
          refreshDisabled={!canViewProtectedFeeds}
        />
        <OperatorTimeline
          passes={passes}
          gateAction={summary?.gate.action ?? null}
          stormTier={canonical?.alerts.stormTier ?? "unknown"}
          topRecommendedAction={summary?.summary?.top_recommended_action ?? null}
          sourceStatusHealthy={sourceStatusHealthy}
          className="min-w-0 flex-1 sm:max-w-md"
        />
      </div>

      {!criticalOpsMode ? (
        <OperatorDecisionCards
          threatSummary={summary}
          stormTier={canonical?.alerts.stormTier ?? "unknown"}
          loading={threats.loading}
          error={threats.error}
        />
      ) : null}

      <div className={`grid gap-4 ${criticalOpsMode ? "lg:grid-cols-[1fr_0.95fr]" : "lg:grid-cols-[1.2fr_1.2fr_1fr]"}`}>
        <CommandSnapshotCard
          canonical={canonical}
          summary={summary}
          canViewProtectedFeeds={canViewProtectedFeeds}
          hasOpsData={Boolean(summary)} // Simplification
          hasMissionSnapshot={Boolean(canonical)}
          onRefresh={handleRefresh}
        />

        {!criticalOpsMode ? (
          <TelemetryStreamCard
            telemetryRows={telemetryRows}
            error={solarWind.error}
          />
        ) : null}

        <div className="space-y-4">
          <Card className="border-white/10 bg-[#050505] text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Worker mesh</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-[#CCFF00]/25 bg-[#0A1103] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#CCFF00]">
                  {brokerPolicy?.memoryLevel ?? "nominal"} memory
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/70">
                  Planner {brokerPolicy?.deepseekMode ?? plannerMode}
                </span>
              </div>

              <div className="grid gap-2">
                {runtimeWorkers.map((worker) => (
                  <div
                    key={worker.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                  >
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
                        {worker.id}
                      </p>
                      <p className="mt-1 text-sm text-white/80">
                        {worker.lastResult?.summary ?? "Awaiting dispatch"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${
                        worker.state === "degraded"
                          ? "bg-[#2A0D05] text-[#FF4D00]"
                          : worker.state === "running"
                            ? "bg-[#101608] text-[#CCFF00]"
                            : worker.state === "suspended"
                              ? "bg-white/10 text-white/50"
                              : "bg-white/5 text-white/65"
                      }`}
                    >
                      {worker.state}
                    </span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
                  planner vs executor
                </p>
                <div className="mt-2 grid gap-2">
                  {plannerWorkers.map((worker) => (
                    <p key={worker.id} className="text-sm text-white/78">
                      <span className="font-mono text-white">{worker.id}</span>
                      {" "}
                      {worker.id === "command-planner"
                        ? "proposes bounded actions and never auto-runs mission commands."
                        : "auto-runs safe housekeeping only."}
                    </p>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#050505] text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Approval queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {approvalMessage ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-white/75">
                  {approvalMessage}
                </div>
              ) : null}
              {queuedApprovals.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-white/60">
                  No approval-gated mission actions are waiting.
                </div>
              ) : (
                queuedApprovals.map((approval) => (
                  <div
                    key={approval.taskId}
                    className="rounded-xl border border-[#FF4D00]/20 bg-[#090605] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#FF9A3C]">
                        {approval.workerId}
                      </span>
                      <span className="rounded-full bg-[#1A0C07] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#FF4D00]">
                        {approval.risk} risk
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/78">{approval.summary}</p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => void handleApproval(approval.taskId, true)}
                        disabled={approvalBusyId === approval.taskId}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => void handleApproval(approval.taskId, false)}
                        disabled={approvalBusyId === approval.taskId}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <CommandHealthThreats
            sourceStatus={sourceStatus}
            threatSummary={summary}
            threatError={threats.error}
            canonical={canonical}
          />

          <ExternalModelCommandOpsCard
            plannerPrompt={plannerPrompt}
            setPlannerPrompt={setPlannerPrompt}
            plannerContextRaw={plannerContextRaw}
            setPlannerContextRaw={setPlannerContextRaw}
            plannerPlan={plannerPlan}
            activeJob={activeJob}
            plannerBusy={plannerBusy}
            plannerError={plannerError}
            plannerInfo={plannerInfo}
            metricsInfo={metricsInfo}
            canViewProtectedFeeds={canViewProtectedFeeds}
            memoryLevel={backendHealth.memoryLevel}
            plannerMode={plannerMode}
            onPlanPreview={handlePlanPreview}
            onEnqueue={enqueueFromPlan}
            onDeny={denyPlan}
            onReplay={replayLastJob}
          />

          <FeedbackPanel compact />
        </div>
      </div>
    </section>
  );
}
