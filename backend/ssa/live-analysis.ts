import {
  extractChatContent,
  extractFirstJsonObject,
  normalizeChatCompletionsUrl,
} from "../model-command-bridge.js";
import { buildGovernedModelSystemPrompt } from "../ethics/model-governance.js";
import { sanitizePublicModelText } from "../model-output-sanitizer.js";
import type { RuntimeMemoryPressureSnapshot } from "../runtime/memory-pressure.js";
import { getRuntimeMemoryPressureSnapshot } from "../runtime/memory-pressure.js";
import { getChatEngineUrl } from "../scripts/local-chat-engine-check.js";
import type { SpaceDomainAvailability } from "./availability.js";
import type { SpaceDomainSummary } from "./ssa-features.js";

export type SpaceDomainAnalysisSource = "deterministic" | "hybrid";
export type SpaceDomainAnalysisSeverity = "quiet" | "watch" | "warning" | "critical";

export interface SpaceDomainAnalysis {
  generatedAt: string;
  cadenceSeconds: number;
  source: SpaceDomainAnalysisSource;
  severity: SpaceDomainAnalysisSeverity;
  headline: string;
  summary: string;
  confidence: number;
  changed: boolean;
  changedSignals: string[];
  metrics: {
    learnedLaneScore: number;
    maxRiskScore: number;
    maxCollisionProbability: number | null;
    minMissDistanceM: number | null;
    conjunctionCount: number;
  };
  model: {
    used: boolean;
    modelId: string | null;
    generatedAt: string | null;
  };
}

interface DeterministicAnalysisFrame {
  windowStartMs: number;
  analysis: SpaceDomainAnalysis;
  fingerprint: string | null;
  summary: SpaceDomainSummary;
  availabilityMode: SpaceDomainAvailability["mode"] | null;
}

interface ModelBriefCacheEntry {
  fingerprint: string;
  headline: string;
  summary: string;
  confidence: number;
  modelId: string | null;
  generatedAt: string;
  expiresAtMs: number;
}

const ANALYSIS_CADENCE_MS = 30_000;
const MODEL_BRIEF_CACHE_MS = 10 * 60 * 1000;
const LOCAL_MODEL_TIMEOUT_MS = Number(
  process.env.GAUSS_LOCAL_CHAT_TIMEOUT_MS ??
    process.env.GAUSS_LOCAL_EVAL_TIMEOUT_MS ??
    20_000,
);

let latestFrame: DeterministicAnalysisFrame | null = null;
let cachedBrief: ModelBriefCacheEntry | null = null;
let activeBriefRefresh:
  | {
      fingerprint: string;
      promise: Promise<void>;
    }
  | null = null;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function localModelId(): string | null {
  const model = process.env.ORCHESTRATOR_CHAT_MODEL?.trim();
  return model ? model : "local-model";
}

function resolveLocalEngineApiKey(): string | null {
  const key = (
    process.env.ORCHESTRATOR_LOCAL_ENGINE_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    ""
  ).trim();
  return key.length > 0 ? key : null;
}

function isLocalEngineUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1" ||
      parsed.hostname.startsWith("100.")
    );
  } catch {
    return false;
  }
}

function stringifyPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 2)}%`;
}

function stringifyMeters(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value).toLocaleString()} m`;
}

function deterministicConfidence(summary: SpaceDomainSummary): number {
  const availabilitySignals = [
    summary.availability.riskZones,
    summary.availability.satellites,
    summary.availability.conjunctions,
  ].filter(Boolean).length;
  const availabilityScore = availabilitySignals / 3;
  const freshnessValues = [
    summary.freshness.riskZonesAgeSeconds,
    summary.freshness.satellitesAgeSeconds,
    summary.freshness.conjunctionsAgeSeconds,
  ].filter((value): value is number => value != null && Number.isFinite(value));
  const freshnessScore =
    freshnessValues.length === 0
      ? 0.4
      : freshnessValues.reduce((total, value) => total + clamp01(1 - value / 900), 0) /
        freshnessValues.length;

  return round(
    clamp01(
      availabilityScore * 0.4 +
        freshnessScore * 0.3 +
        clamp01(summary.learnedLane.confidence) * 0.3,
    ),
  );
}

function anomalyLikelihood(summary: SpaceDomainSummary): number {
  const collisionLikelihood = clamp01(
    (summary.conjunctionRisk.maxCollisionProbability ?? 0) * 100,
  );
  const learnedLaneLikelihood = clamp01(summary.learnedLane.score);
  const crowdingLikelihood = clamp01(summary.crowding.maxRiskScore);
  return round(
    clamp01(
      collisionLikelihood * 0.5 +
        learnedLaneLikelihood * 0.35 +
        crowdingLikelihood * 0.15,
    ),
  );
}

function analysisMetrics(summary: SpaceDomainSummary): SpaceDomainAnalysis["metrics"] {
  return {
    learnedLaneScore: round(summary.learnedLane.score),
    maxRiskScore: round(summary.crowding.maxRiskScore),
    maxCollisionProbability:
      summary.conjunctionRisk.maxCollisionProbability == null
        ? null
        : round(summary.conjunctionRisk.maxCollisionProbability),
    minMissDistanceM:
      summary.conjunctionRisk.minMissDistanceM == null
        ? null
        : Math.round(summary.conjunctionRisk.minMissDistanceM),
    conjunctionCount: summary.counts.conjunctionCount,
  };
}

export function determineSpaceDomainSeverity(
  summary: SpaceDomainSummary,
): SpaceDomainAnalysisSeverity {
  if (
    summary.conjunctionRisk.recentCriticalCount > 0 ||
    (summary.conjunctionRisk.maxCollisionProbability ?? 0) >= 0.01
  ) {
    return "critical";
  }
  if (
    summary.learnedLane.trigger ||
    (summary.conjunctionRisk.maxCollisionProbability ?? 0) >= 0.005
  ) {
    return "warning";
  }
  if (
    summary.learnedLane.score >= 0.45 ||
    summary.crowding.maxRiskScore >= 0.55
  ) {
    return "watch";
  }
  return "quiet";
}

export function detectSpaceDomainAnalysisChanges(
  previous: Pick<SpaceDomainAnalysis, "severity" | "metrics"> | null,
  next: {
    severity: SpaceDomainAnalysisSeverity;
    metrics: SpaceDomainAnalysis["metrics"];
  },
): string[] {
  if (!previous) {
    return [];
  }

  const signals: string[] = [];
  if (previous.severity !== next.severity) {
    signals.push("severity-bucket");
  }
  if (previous.metrics.conjunctionCount !== next.metrics.conjunctionCount) {
    signals.push("conjunction-count");
  }
  if (
    Math.abs(
      (previous.metrics.maxCollisionProbability ?? 0) -
        (next.metrics.maxCollisionProbability ?? 0),
    ) >= 0.002
  ) {
    signals.push("collision-probability");
  }
  if (
    previous.metrics.minMissDistanceM != null &&
    next.metrics.minMissDistanceM != null &&
    Math.abs(previous.metrics.minMissDistanceM - next.metrics.minMissDistanceM) >= 1_000
  ) {
    signals.push("miss-distance");
  }
  if (
    Math.abs(
      previous.metrics.learnedLaneScore - next.metrics.learnedLaneScore,
    ) >= 0.08
  ) {
    signals.push("learned-lane-score");
  }
  return signals;
}

function buildDeterministicHeadline(
  severity: SpaceDomainAnalysisSeverity,
  summary: SpaceDomainSummary,
  availability?: SpaceDomainAvailability,
): string {
  if (availability?.mode === "projected") {
    return "Projected orbital lane active";
  }

  if (availability?.mode === "warming") {
    return "Public orbital lane awaiting ingest";
  }

  if (!summary.availability.riskZones && !summary.availability.satellites) {
    return "Public orbital lane awaiting ingest";
  }

  if (severity === "critical") {
    return "Critical conjunction activity detected";
  }
  if (severity === "warning") {
    return "Elevated orbital risk requires attention";
  }
  if (severity === "watch") {
    return "Orbital watch active across the public lane";
  }
  return "Public orbital lane remains stable";
}

function buildDeterministicSummary(
  severity: SpaceDomainAnalysisSeverity,
  summary: SpaceDomainSummary,
  changedSignals: string[],
  availability?: SpaceDomainAvailability,
): string {
  if (availability?.mode === "projected") {
    return "Live SSA ingest is stale or intentionally suppressed, so Gauss is serving a clearly labeled projected hold-state from the last trusted orbital snapshot.";
  }

  if (availability?.mode === "warming") {
    return "Catalog and risk-zone feeds are still warming up. Public SDA remains online while ingest catches up.";
  }

  if (!summary.availability.riskZones && !summary.availability.satellites) {
    return "Catalog and risk-zone feeds are still warming up. Public SDA remains online while ingest catches up.";
  }

  const base =
    severity === "critical"
      ? `Critical conjunction lane active with ${summary.counts.conjunctionCount} tracked conjunctions, peak collision probability ${stringifyPercent(summary.conjunctionRisk.maxCollisionProbability)}, and minimum miss distance ${stringifyMeters(summary.conjunctionRisk.minMissDistanceM)}.`
      : severity === "warning"
        ? `Elevated SSA pressure detected: learned lane ${stringifyPercent(summary.learnedLane.score)}, catalog risk ${stringifyPercent(summary.crowding.maxRiskScore)}, and ${summary.counts.conjunctionCount} conjunctions under watch.`
        : severity === "watch"
          ? `Crowding and learned-lane drift are above quiet baseline. Catalog risk is ${stringifyPercent(summary.crowding.maxRiskScore)} with learned SSA score ${stringifyPercent(summary.learnedLane.score)}.`
          : `No elevated conjunction trigger is active. Catalog risk is ${stringifyPercent(summary.crowding.maxRiskScore)} and the learned SSA lane remains below the warning threshold.`;

  if (changedSignals.length === 0) {
    return base;
  }

  return `${base} Changed signals: ${changedSignals.join(", ")}.`;
}

function buildTriggerFingerprint(
  severity: SpaceDomainAnalysisSeverity,
  metrics: SpaceDomainAnalysis["metrics"],
): string | null {
  if (severity === "quiet") {
    return null;
  }
  return [
    severity,
    metrics.conjunctionCount,
    metrics.learnedLaneScore.toFixed(2),
    metrics.maxRiskScore.toFixed(2),
    metrics.maxCollisionProbability == null
      ? "na"
      : metrics.maxCollisionProbability.toFixed(4),
    metrics.minMissDistanceM == null
      ? "na"
      : Math.round(metrics.minMissDistanceM / 100).toString(),
  ].join("|");
}

export function primeSpaceDomainHybridBriefForTests(input: {
  analysis: SpaceDomainAnalysis;
  headline: string;
  summary: string;
  confidence?: number;
  modelId?: string | null;
  generatedAt?: string;
  nowMs?: number;
}): void {
  const fingerprint = buildTriggerFingerprint(
    input.analysis.severity,
    input.analysis.metrics,
  );
  if (!fingerprint) {
    throw new Error("Cannot prime a hybrid brief for quiet analysis.");
  }

  cachedBrief = {
    fingerprint,
    headline: input.headline,
    summary: input.summary,
    confidence: clamp01(input.confidence ?? input.analysis.confidence),
    modelId: input.modelId ?? localModelId(),
    generatedAt: input.generatedAt ?? new Date(input.nowMs ?? Date.now()).toISOString(),
    expiresAtMs: (input.nowMs ?? Date.now()) + MODEL_BRIEF_CACHE_MS,
  };
}

export function buildDeterministicSpaceDomainAnalysis(
  summary: SpaceDomainSummary,
  previous: Pick<SpaceDomainAnalysis, "severity" | "metrics"> | null = null,
  generatedAt = new Date().toISOString(),
  availability?: SpaceDomainAvailability,
): SpaceDomainAnalysis {
  const severity = determineSpaceDomainSeverity(summary);
  const metrics = analysisMetrics(summary);
  const changedSignals = detectSpaceDomainAnalysisChanges(previous, {
    severity,
    metrics,
  });

  return {
    generatedAt,
    cadenceSeconds: ANALYSIS_CADENCE_MS / 1000,
    source: "deterministic",
    severity,
    headline: buildDeterministicHeadline(severity, summary, availability),
    summary: buildDeterministicSummary(severity, summary, changedSignals, availability),
    confidence: deterministicConfidence(summary),
    changed: changedSignals.length > 0,
    changedSignals,
    metrics,
    model: {
      used: false,
      modelId: null,
      generatedAt: null,
    },
  };
}

function shouldRequestHybridModel(
  analysis: SpaceDomainAnalysis,
  summary: SpaceDomainSummary,
  availability?: SpaceDomainAvailability,
): boolean {
  if (availability?.mode !== "live") {
    return false;
  }
  if (anomalyLikelihood(summary) <= 0.85) {
    return false;
  }
  return (
    analysis.severity === "warning" ||
    analysis.severity === "critical" ||
    (analysis.changed && analysis.severity !== "quiet")
  );
}

function applyHybridBrief(
  analysis: SpaceDomainAnalysis,
  brief: ModelBriefCacheEntry,
): SpaceDomainAnalysis {
  return {
    ...analysis,
    source: "hybrid",
    headline: brief.headline,
    summary: brief.summary,
    confidence: round(clamp01((analysis.confidence * 0.7) + (brief.confidence * 0.3))),
    model: {
      used: true,
      modelId: brief.modelId,
      generatedAt: brief.generatedAt,
    },
  };
}

function parseModelBrief(text: string): {
  headline: string;
  summary: string;
  confidence: number;
} | null {
  const maybeJson = extractFirstJsonObject(text);
  if (!maybeJson) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(maybeJson) as Record<string, unknown>;
  } catch {
    return null;
  }

  const headline = sanitizePublicModelText(
    typeof parsed.headline === "string" ? parsed.headline : "",
    { maxLength: 96, minLength: 12 },
  );
  const summary = sanitizePublicModelText(
    typeof parsed.summary === "string" ? parsed.summary : "",
    { maxLength: 260, minLength: 24 },
  );
  const confidence = clamp01(
    typeof parsed.confidence === "number"
      ? parsed.confidence
      : Number(parsed.confidence ?? 0.72),
  );

  if (!headline || !summary) {
    return null;
  }

  return { headline, summary, confidence };
}

function chatHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = resolveLocalEngineApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function refreshHybridBrief(frame: DeterministicAnalysisFrame): Promise<void> {
  const baseUrl = getChatEngineUrl();
  if (!baseUrl || !isLocalEngineUrl(baseUrl)) {
    return;
  }

  const response = await fetch(normalizeChatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: chatHeaders(),
    body: JSON.stringify({
      model: localModelId() ?? "local-model",
      temperature: 0.1,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content: buildGovernedModelSystemPrompt({
            role: "You are an AI model running locally for Project Gauss public SDA analysis.",
            directives: [
              "Return only compact JSON with keys headline, summary, confidence.",
              "No markdown, no chain-of-thought, no reasoning.",
            ],
          }),
        },
        {
          role: "user",
          content: JSON.stringify({
            role: "public-sda-analysis",
            severity: frame.analysis.severity,
            changed: frame.analysis.changed,
            changedSignals: frame.analysis.changedSignals,
            cadenceSeconds: frame.analysis.cadenceSeconds,
            metrics: frame.analysis.metrics,
            conjunctionRisk: frame.summary.conjunctionRisk,
            crowding: frame.summary.crowding,
            learnedLane: {
              score: frame.summary.learnedLane.score,
              confidence: frame.summary.learnedLane.confidence,
              trigger: frame.summary.learnedLane.trigger,
              topContributors: frame.summary.learnedLane.topContributors.slice(0, 3),
            },
            freshness: frame.summary.freshness,
            constraints: [
              "headline must be operator-readable and under 96 chars",
              "summary must be one sentence under 260 chars",
              "describe only observed orbital risk and confidence",
            ],
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(LOCAL_MODEL_TIMEOUT_MS),
  });

  if (!response.ok) {
    return;
  }

  const parsed = (await response.json()) as Record<string, unknown>;
  const content = extractChatContent(parsed);
  if (!content) {
    return;
  }

  const brief = parseModelBrief(content);
  if (!brief) {
    return;
  }

  cachedBrief = {
    fingerprint: frame.fingerprint ?? "",
    headline: brief.headline,
    summary: brief.summary,
    confidence: brief.confidence,
    modelId: localModelId(),
    generatedAt: new Date().toISOString(),
    expiresAtMs: Date.now() + MODEL_BRIEF_CACHE_MS,
  };
}

function maybeStartHybridBriefRefresh(
  frame: DeterministicAnalysisFrame,
): void {
  if (!frame.fingerprint) {
    return;
  }
  if (activeBriefRefresh?.fingerprint === frame.fingerprint) {
    return;
  }
  if (activeBriefRefresh) {
    return;
  }

  const promise = refreshHybridBrief(frame).finally(() => {
    if (activeBriefRefresh?.fingerprint === frame.fingerprint) {
      activeBriefRefresh = null;
    }
  });

  activeBriefRefresh = {
    fingerprint: frame.fingerprint,
    promise,
  };
  void promise;
}

export function getSpaceDomainAnalysis(
  summary: SpaceDomainSummary,
  options?: {
    nowMs?: number;
    memorySnapshot?: RuntimeMemoryPressureSnapshot;
    availability?: SpaceDomainAvailability;
  },
): SpaceDomainAnalysis {
  const nowMs = options?.nowMs ?? Date.now();
  const windowStartMs = nowMs - (nowMs % ANALYSIS_CADENCE_MS);
  const availability = options?.availability;
  const availabilityMode = availability?.mode ?? null;

  if (
    !latestFrame ||
    latestFrame.windowStartMs !== windowStartMs ||
    latestFrame.availabilityMode !== availabilityMode
  ) {
    const previous = latestFrame?.analysis ?? null;
    const analysis = buildDeterministicSpaceDomainAnalysis(
      summary,
      previous,
      new Date(nowMs).toISOString(),
      availability,
    );
    latestFrame = {
      windowStartMs,
      analysis,
      fingerprint: buildTriggerFingerprint(analysis.severity, analysis.metrics),
      summary,
      availabilityMode,
    };
  } else {
    latestFrame = {
      ...latestFrame,
      summary,
      availabilityMode,
    };
  }

  const frame = latestFrame;
  const memorySnapshot =
    options?.memorySnapshot ?? getRuntimeMemoryPressureSnapshot();

  if (
    memorySnapshot.level === "critical" ||
    !shouldRequestHybridModel(frame.analysis, frame.summary, availability) ||
    !frame.fingerprint
  ) {
    return frame.analysis;
  }

  if (
    cachedBrief &&
    cachedBrief.fingerprint === frame.fingerprint &&
    cachedBrief.expiresAtMs > nowMs
  ) {
    return applyHybridBrief(frame.analysis, cachedBrief);
  }

  maybeStartHybridBriefRefresh(frame);
  return frame.analysis;
}

export function resetSpaceDomainAnalysisState(): void {
  latestFrame = null;
  cachedBrief = null;
  activeBriefRefresh = null;
}
