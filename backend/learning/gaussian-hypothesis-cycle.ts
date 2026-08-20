import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  extractChatContent,
  extractFirstJsonObject,
  normalizeChatCompletionsUrl,
} from "../model-command-bridge.js";
import { buildGovernedModelSystemPrompt } from "../ethics/model-governance.js";
import { getRuntimeMemoryPressureSnapshot } from "../runtime/memory-pressure.js";
import { getChatEngineUrl } from "../scripts/local-chat-engine-check.js";

export interface GaussianEvidenceSource {
  label: string;
  score: number | null;
}

export interface GaussianHypothesisCandidate {
  id: string;
  statement: string;
  prior: number;
  likelihood_if_true: number;
  likelihood_if_false: number;
  evidence_refs: string[];
  required_signals: string[];
  math_check: string;
  safe_experiment: {
    name: string;
    type: "observe" | "simulate" | "replay";
    procedure: string;
    stop_condition: string;
    risk: "low" | "medium";
  };
}

export interface GaussianHypothesisResult extends GaussianHypothesisCandidate {
  posterior: number;
  logLikelihoodRatio: number;
  informationGainBits: number;
}

export interface GaussianHypothesisCycleReport {
  generatedAt: string;
  mode: "rag-chat" | "rag-deterministic" | "unavailable";
  question: string;
  rag: {
    ok: boolean;
    sourceCount: number;
    answer: string;
    sources: GaussianEvidenceSource[];
  };
  hypotheses: GaussianHypothesisResult[];
  selectedHypothesisId: string | null;
  verdict: "solve" | "need-more-data";
  nextStep: string;
  mathProtocol: string[];
  constraints: string[];
}

type RagQueryResponse = {
  ok?: boolean;
  answer?: string;
  sources?: Array<Record<string, unknown>>;
};

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999, Math.max(0.001, value));
}

export function bayesPosterior(prior: number, likelihoodIfTrue: number, likelihoodIfFalse: number): number {
  const p = clampProbability(prior);
  const lt = clampProbability(likelihoodIfTrue);
  const lf = clampProbability(likelihoodIfFalse);
  const priorOdds = p / (1 - p);
  const likelihoodRatio = lt / lf;
  const posteriorOdds = priorOdds * likelihoodRatio;
  return clampProbability(posteriorOdds / (1 + posteriorOdds));
}

function logLikelihoodRatio(likelihoodIfTrue: number, likelihoodIfFalse: number): number {
  const lt = clampProbability(likelihoodIfTrue);
  const lf = clampProbability(likelihoodIfFalse);
  return Number(Math.log2(lt / lf).toFixed(3));
}

function informationGainBits(prior: number, posterior: number): number {
  const p0 = clampProbability(prior);
  const p1 = clampProbability(posterior);
  const odds0 = p0 / (1 - p0);
  const odds1 = p1 / (1 - p1);
  return Number(Math.abs(Math.log2(odds1) - Math.log2(odds0)).toFixed(3));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function parseSafeExperiment(value: unknown): GaussianHypothesisCandidate["safe_experiment"] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const procedure = typeof record.procedure === "string" ? record.procedure.trim() : "";
  const stopCondition = typeof record.stop_condition === "string" ? record.stop_condition.trim() : "";
  const type = record.type === "simulate" || record.type === "replay" ? record.type : "observe";
  const risk = record.risk === "medium" ? "medium" : "low";
  if (!name || !procedure || !stopCondition) return null;
  return {
    name,
    type,
    procedure,
    stop_condition: stopCondition,
    risk,
  };
}

function normalizeCandidate(raw: unknown, index: number): GaussianHypothesisCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const statement = typeof record.statement === "string" ? record.statement.trim() : "";
  const mathCheck = typeof record.math_check === "string" ? record.math_check.trim() : "";
  const experiment = parseSafeExperiment(record.safe_experiment);
  if (!statement || !mathCheck || !experiment) return null;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `h${index + 1}`,
    statement,
    prior: clampProbability(Number(record.prior ?? 0.5)),
    likelihood_if_true: clampProbability(Number(record.likelihood_if_true ?? 0.6)),
    likelihood_if_false: clampProbability(Number(record.likelihood_if_false ?? 0.4)),
    evidence_refs: asStringArray(record.evidence_refs),
    required_signals: asStringArray(record.required_signals),
    math_check: mathCheck,
    safe_experiment: experiment,
  };
}

function finalizeCandidates(candidates: GaussianHypothesisCandidate[]): GaussianHypothesisResult[] {
  return candidates
    .map((candidate) => {
      const posterior = bayesPosterior(
        candidate.prior,
        candidate.likelihood_if_true,
        candidate.likelihood_if_false,
      );
      return {
        ...candidate,
        posterior,
        logLikelihoodRatio: logLikelihoodRatio(candidate.likelihood_if_true, candidate.likelihood_if_false),
        informationGainBits: informationGainBits(candidate.prior, posterior),
      };
    })
    .sort((a, b) => b.posterior - a.posterior || b.informationGainBits - a.informationGainBits);
}

function fallbackHypothesis(question: string, ragAnswer: string, sources: GaussianEvidenceSource[]): GaussianHypothesisResult[] {
  const candidate: GaussianHypothesisCandidate = {
    id: "h1",
    statement: "Evidence is insufficient to isolate a single causal mechanism without more bounded observation.",
    prior: 0.5,
    likelihood_if_true: 0.55,
    likelihood_if_false: 0.45,
    evidence_refs: sources.map((source) => source.label).slice(0, 3),
    required_signals: ["new telemetry", "cross-check against trusted doctrine", "bounded replay or simulation"],
    math_check: `Question "${question}" remains underdetermined by the current evidence envelope.`,
    safe_experiment: {
      name: "Collect more bounded evidence",
      type: "observe",
      procedure: `Hold deterministic mode, gather the next bounded telemetry window, and compare it against trusted RAG doctrine. Current grounded answer: ${ragAnswer.slice(0, 180)}`,
      stop_condition: "Stop if memory, power, or source health degrades; escalate only after the new evidence changes the posterior materially.",
      risk: "low",
    },
  };
  return finalizeCandidates([candidate]);
}

function parseModelCandidates(rawContent: string): GaussianHypothesisCandidate[] {
  const jsonText = extractFirstJsonObject(rawContent) ?? rawContent;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return [];
  }
  const rawHypotheses = Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [];
  return rawHypotheses
    .map((item, index) => normalizeCandidate(item, index))
    .filter((item): item is GaussianHypothesisCandidate => Boolean(item))
    .slice(0, 4);
}

async function queryRag(question: string, ragUrl: string): Promise<GaussianHypothesisCycleReport["rag"]> {
  try {
    const response = await fetch(`${ragUrl.replace(/\/+$/, "")}/api/rag/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `${question}\n\nReturn grounded evidence from approved local doctrine and method documents. Prefer mathematical, probabilistic, and mission-operations references.`,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      return { ok: false, sourceCount: 0, answer: "", sources: [] };
    }
    const parsed = (await response.json()) as RagQueryResponse;
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.slice(0, 6).map((source, index) => ({
          label:
            (typeof source.path === "string" && source.path.trim()) ||
            (typeof source.title === "string" && source.title.trim()) ||
            `source-${index + 1}`,
          score: typeof source.score === "number" ? source.score : null,
        }))
      : [];
    return {
      ok: parsed.ok === true || response.ok,
      sourceCount: sources.length,
      answer: typeof parsed.answer === "string" ? parsed.answer.trim() : "",
      sources,
    };
  } catch {
    return { ok: false, sourceCount: 0, answer: "", sources: [] };
  }
}

async function queryLocalModel(
  question: string,
  rag: GaussianHypothesisCycleReport["rag"],
): Promise<GaussianHypothesisCandidate[]> {
  const governor = getRuntimeMemoryPressureSnapshot();
  if (governor.level === "critical") {
    return [];
  }
  const chatUrl = getChatEngineUrl();
  if (!chatUrl) {
    return [];
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.ORCHESTRATOR_LOCAL_ENGINE_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(normalizeChatCompletionsUrl(chatUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.ORCHESTRATOR_CHAT_MODEL?.trim() || "local-model",
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: buildGovernedModelSystemPrompt({
            role: "You are Model running a Gaussian hypothesis cycle for mission analysis.",
            directives: [
              "Return ONLY valid JSON object with keys hypotheses, selection_reason, next_observation, stop_condition.",
              "Hypotheses must be an array of 2 to 4 objects with keys id, statement, prior, likelihood_if_true, likelihood_if_false, evidence_refs, required_signals, math_check, safe_experiment.",
              "Use probabilities in [0,1]. Never use 1.0 certainty unless the evidence is directly measured and bounded.",
              "safe_experiment must contain name, type, procedure, stop_condition, and risk.",
              "If evidence is weak, return observation-only or replay-only experiments and lower posterior-driving likelihoods.",
            ],
          }),
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            grounded_answer: rag.answer,
            evidence_sources: rag.sources,
            constraints: [
              "Zero tolerance for hallucination",
              "Truth only from grounded evidence and explicit assumptions",
              "Use math to compare priors and likelihoods",
              "Prefer safe bounded experiments over risky action",
            ],
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    return [];
  }

  const parsed = (await response.json()) as Record<string, unknown>;
  const content = extractChatContent(parsed);
  if (!content) {
    return [];
  }
  return parseModelCandidates(content);
}

export async function runGaussianHypothesisCycle(input: {
  question: string;
  ragUrl?: string;
}): Promise<GaussianHypothesisCycleReport> {
  const question = input.question.trim();
  const ragUrl = (input.ragUrl ?? process.env.GAUSS_RAG_URL ?? "http://127.0.0.1:3002").trim();
  const rag = await queryRag(question, ragUrl);
  const modelCandidates = rag.ok ? await queryLocalModel(question, rag) : [];
  const hypotheses =
    modelCandidates.length > 0 ? finalizeCandidates(modelCandidates) : fallbackHypothesis(question, rag.answer, rag.sources);

  const top = hypotheses[0] ?? null;
  const runnerUp = hypotheses[1] ?? null;
  const confidentSolve =
    top !== null &&
    top.posterior >= 0.8 &&
    (!runnerUp || top.posterior - runnerUp.posterior >= 0.12);
  const nextStep = top
    ? `${top.safe_experiment.name}: ${top.safe_experiment.procedure}`
    : "No grounded hypothesis available; gather more data.";

  return {
    generatedAt: new Date().toISOString(),
    mode: rag.ok ? (modelCandidates.length > 0 ? "rag-chat" : "rag-deterministic") : "unavailable",
    question,
    rag,
    hypotheses,
    selectedHypothesisId: top?.id ?? null,
    verdict: confidentSolve ? "solve" : "need-more-data",
    nextStep,
    mathProtocol: [
      "1. Retrieve grounded evidence from approved local RAG documents.",
      "2. Form bounded hypotheses with explicit priors and competing likelihoods.",
      "3. Compute posterior in code with Bayes' rule rather than trusting raw model confidence.",
      "4. Prefer the smallest safe observation, replay, or simulation that can change the posterior materially.",
    ],
    constraints: [
      "truth-only",
      "zero-hallucination",
      "safe-experiment-only",
      "deterministic-posterior-update",
    ],
  };
}

export function writeGaussianHypothesisReport(report: GaussianHypothesisCycleReport, outputPath: string): void {
  const absolute = path.resolve(outputPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
