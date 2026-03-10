import { ActionRail } from "@/components/cockpit/ActionRail";
import { OperatorTimeline } from "@/components/cockpit/OperatorTimeline";
import { OperatorDecisionCards } from "@/components/cockpit/OperatorDecisionCards";
import { FeedbackPanel } from "@/components/heliophysics/FeedbackPanel";
import { MissionSurfaceLinks } from "@/components/MissionSurfaceLinks";
import { useCommandState } from "@/hooks/useCommandState";

// Atomized Components
import { CommandSnapshotCard } from "@/components/command/CommandSnapshotCard";
import { TelemetryStreamCard } from "@/components/command/TelemetryStreamCard";
import { DeepSeekCommandOpsCard } from "@/components/command/DeepSeekCommandOpsCard";
import { CommandHealthThreats } from "@/components/command/CommandHealthThreats";

export default function CommandPage() {
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
    handlePlanPreview,
    enqueueFromPlan,
    denyPlan,
    replayLastJob,
  } = useCommandState();

  return (
    <section className="space-y-4" data-testid="command-page">
      <MissionSurfaceLinks compact />

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

      <OperatorDecisionCards
        threatSummary={summary}
        stormTier={canonical?.alerts.stormTier ?? "unknown"}
        loading={threats.loading}
        error={threats.error}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1.2fr_1fr]">
        <CommandSnapshotCard
          canonical={canonical}
          summary={summary}
          canViewProtectedFeeds={canViewProtectedFeeds}
          hasOpsData={Boolean(summary)} // Simplification
          hasMissionSnapshot={Boolean(canonical)}
          onRefresh={handleRefresh}
        />

        <TelemetryStreamCard
          telemetryRows={telemetryRows}
          error={solarWind.error}
        />

        <div className="space-y-4">
          <CommandHealthThreats
            sourceStatus={sourceStatus}
            threatSummary={summary}
            threatError={threats.error}
            canonical={canonical}
          />

          <DeepSeekCommandOpsCard
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
