import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  extractChatContent,
  extractFirstJsonObject,
  normalizeChatCompletionsUrl,
} from "../model-command-bridge.js";
import { buildGovernedModelSystemPrompt } from "../ethics/model-governance.js";
import {
  getRuntimeMemoryPressureSnapshot,
  type RuntimeMemoryPressureSnapshot,
} from "../runtime/memory-pressure.js";
import { bayesPosterior } from "./gaussian-hypothesis-cycle.js";

export interface LocalModelEndpointProbe {
  baseUrl: string;
  chatUrl: string;
  modelsUrl: string;
  ok: boolean;
  responseMs: number | null;
  detail: string;
  parseable: boolean;
  modelIds: string[];
  transportKind: "mlx" | "stub" | "unknown";
}

export interface LocalModelWireupHypothesis {
  id: string;
  statement: string;
  prior: number;
  likelihood_if_true: number;
  likelihood_if_false: number;
  posterior: number;
  evidence_refs: string[];
  repair_profile: "mlx-primary" | "stub-fallback" | "deterministic-only";
  repair_actions: string[];
}

export interface LocalModelWireupReport {
  generatedAt: string;
  verdict: "healthy" | "repairable" | "blocked";
  mode: "deterministic" | "model-assisted";
  memory: {
    level: RuntimeMemoryPressureSnapshot["level"];
    freeMb: number;
    suspendedSubsystems: string[];
  };
  topology: {
    preferredProfile: "mlx-primary" | "stub-fallback" | "deterministic-only";
    primaryPort: number;
    fallbackPort: number;
    startupCommands: {
      mlx: string;
      stub: string;
      stack: string;
      smoke: string;
    };
  };
  env: {
    orchestratorLocalEngineUrl: string | null;
    gaussBrainUrl: string | null;
    mlxChatUrl: string | null;
    resolvedBaseUrl: string | null;
    explicitTransportConfigured: boolean;
    urlCoherent: boolean;
    localOnly: boolean;
    preferredPortConfigured: boolean;
    apiKeyPresent: boolean;
    chatModel: string;
  };
  probes: {
    configured: LocalModelEndpointProbe | null;
    primary: LocalModelEndpointProbe | null;
    fallback: LocalModelEndpointProbe | null;
  };
  hypotheses: LocalModelWireupHypothesis[];
  selectedHypothesisId: string | null;
  recommendedActions: string[];
  servicePrinciples: string[];
  modelSelfAssessment: {
    attempted: boolean;
    accepted: boolean;
    summary: string | null;
  };
}

export interface LocalModelWireupOptions {
  env?: Partial<Record<string, string | undefined>>;
  memorySnapshot?: RuntimeMemoryPressureSnapshot;
  explicitModelSelfAssessment?: boolean;
  probeEndpoint?: (baseUrl: string) => Promise<LocalModelEndpointProbe>;
}

interface ModelSelfAssessment {
  attempted: boolean;
  accepted: boolean;
  summary: string | null;
}

const DEFAULT_PRIMARY_PORT = 8088;
const DEFAULT_FALLBACK_PORT = 8089;
const AUDIT_TIMEOUT_MS = Number(process.env.GAUSS_LOCAL_CHAT_TIMEOUT_MS ?? 20_000);
const SERVICE_PRINCIPLES = [
  "Keep the nominal path deterministic and small; heavier reasoning wakes only on evidence or explicit request.",
  "Preserve a truthful health core that can say reachable, unreachable, degraded, or suspended without embellishment.",
  "Use adjustable autonomy: planning may be model-assisted, but routing, safing, and approval boundaries stay deterministic.",
  "Prefer hibernation, load shedding, and bounded background work over keeping every subsystem hot.",
  "Degrade by tier: MLX primary, stub fallback, then deterministic-only; never burn the final RAM margin on speculative inference.",
];

function readEnv(
  options: LocalModelWireupOptions | undefined,
  key: string,
): string {
  if (options?.env && key in options.env) {
    const val = options.env[key];
    return typeof val === "string" ? val.trim() : "";
  }
  return (process.env[key] ?? "").trim();
}

function parsePort(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (trimmed.endsWith("/v1/chat/completions")) {
    return trimmed.slice(0, -"/chat/completions".length);
  }
  return trimmed;
}

function hostLooksLocal(url: string | null): boolean {
  if (!url) return false;
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

function buildModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl) ?? baseUrl;
  const trimmed = normalized.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function probeTransportKind(modelIds: string[], detail: string): LocalModelEndpointProbe["transportKind"] {
  const combined = `${modelIds.join(" ")} ${detail}`.toLowerCase();
  if (combined.includes("deepseek") || combined.includes("mlx")) return "mlx";
  if (combined.includes("stub")) return "stub";
  return "unknown";
}

export async function probeLocalModelEndpoint(baseUrl: string): Promise<LocalModelEndpointProbe> {
  const normalizedBase = normalizeBaseUrl(baseUrl) ?? baseUrl.trim();
  const chatUrl = normalizeChatCompletionsUrl(normalizedBase);
  const modelsUrl = buildModelsUrl(normalizedBase);
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = (process.env.ORCHESTRATOR_LOCAL_ENGINE_API_KEY ?? "").trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let detail = "";
  let parseable = false;
  let ok = false;
  let modelIds: string[] = [];

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.ORCHESTRATOR_CHAT_MODEL?.trim() || "local-model",
        messages: [{ role: "user", content: "Ping" }],
      }),
      signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
    });
    const responseText = await response.text();
    detail = response.ok ? "chat-ok" : `chat-http-${response.status}`;
    if (response.ok) {
      try {
        const parsed = JSON.parse(responseText) as Record<string, unknown>;
        parseable = Boolean(extractChatContent(parsed));
        ok = parseable;
      } catch {
        parseable = false;
      }
    }
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }

  try {
    const modelsResponse = await fetch(modelsUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(Math.min(AUDIT_TIMEOUT_MS, 12_000)),
    });
    if (modelsResponse.ok) {
      const parsed = (await modelsResponse.json()) as {
        data?: Array<{ id?: string }>;
        models?: Array<{ id?: string }>;
      };
      const list = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : [];
      modelIds = list
        .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
        .filter(Boolean)
        .slice(0, 6);
    }
  } catch {
    // Models endpoint is optional for the audit.
  }

  return {
    baseUrl: normalizedBase,
    chatUrl,
    modelsUrl,
    ok,
    responseMs: Date.now() - startedAt,
    detail,
    parseable,
    modelIds,
    transportKind: probeTransportKind(modelIds, detail),
  };
}

function buildActions(profile: LocalModelWireupHypothesis["repair_profile"]): string[] {
  switch (profile) {
    case "mlx-primary":
      return [
        "Set GAUSS_BRAIN_URL=http://127.0.0.1:8088/v1",
        "Set ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8088/v1/chat/completions",
        "Start the primary local model service with `npm run dev:brain:mlx`",
        "Verify the transport with `npm run test:local-chat`",
      ];
    case "stub-fallback":
      return [
        "Align GAUSS_BRAIN_URL and ORCHESTRATOR_LOCAL_ENGINE_URL to the same port",
        "Start the bounded fallback with `npm run dev:brain:stub`",
        "Keep reasoning deterministic until MLX is healthy again",
        "Re-run `npm run test:local-chat` after the fallback comes up",
      ];
    default:
      return [
        "Do not start MLX while memory is critical",
        "Keep public SDA on projected or warming mode",
        "Collect more headroom and service evidence before re-enabling model analysis",
      ];
  }
}

function buildHypotheses(input: {
  memory: RuntimeMemoryPressureSnapshot;
  env: LocalModelWireupReport["env"];
  configuredProbe: LocalModelEndpointProbe | null;
  primaryProbe: LocalModelEndpointProbe | null;
  fallbackProbe: LocalModelEndpointProbe | null;
}): LocalModelWireupHypothesis[] {
  const evidence: Record<string, boolean> = {
    healthyConfigured: Boolean(input.env.explicitTransportConfigured && input.configuredProbe?.ok),
    primaryReachable: Boolean(input.primaryProbe?.ok),
    fallbackReachable: Boolean(input.fallbackProbe?.ok),
    envMissing: !input.env.orchestratorLocalEngineUrl && !input.env.gaussBrainUrl,
    portDrift: !input.env.urlCoherent && Boolean(input.env.orchestratorLocalEngineUrl || input.env.gaussBrainUrl),
    criticalMemory: input.memory.level === "critical",
    preferredPort: input.env.preferredPortConfigured,
  };

  const templates: Array<{
    id: string;
    statement: string;
    prior: number;
    truthSignal: boolean;
    falseSignal: boolean;
    repair_profile: LocalModelWireupHypothesis["repair_profile"];
    evidence_refs: string[];
  }> = [
    {
      id: "healthy-primary",
      statement: "The local model wiring is healthy on the primary MLX path and should remain on 8088.",
      prior: 0.22,
      truthSignal: evidence.healthyConfigured && evidence.preferredPort && input.env.localOnly,
      falseSignal: evidence.envMissing || evidence.portDrift || !evidence.primaryReachable,
      repair_profile: "mlx-primary",
      evidence_refs: ["configured-endpoint", "primary-port-8088", "local-only-transport"],
    },
    {
      id: "env-missing",
      statement: "The main fault is missing or incomplete environment wiring, not the model binary itself.",
      prior: 0.24,
      truthSignal: evidence.envMissing,
      falseSignal: evidence.healthyConfigured,
      repair_profile: "mlx-primary",
      evidence_refs: ["gauss-brain-url", "orchestrator-local-engine-url"],
    },
    {
      id: "port-drift",
      statement: "The transport is miswired because GAUSS_BRAIN_URL and ORCHESTRATOR_LOCAL_ENGINE_URL drifted onto different bases or ports.",
      prior: 0.24,
      truthSignal: evidence.portDrift || (!evidence.preferredPort && Boolean(input.env.orchestratorLocalEngineUrl || input.env.gaussBrainUrl)),
      falseSignal: input.env.urlCoherent && evidence.healthyConfigured,
      repair_profile: evidence.fallbackReachable ? "stub-fallback" : "mlx-primary",
      evidence_refs: ["gauss-brain-url", "orchestrator-local-engine-url", "preferred-port"],
    },
    {
      id: "service-down",
      statement: "The environment is mostly correct, but the local model service is down or unreachable.",
      prior: 0.2,
      truthSignal: Boolean(input.env.orchestratorLocalEngineUrl || input.env.gaussBrainUrl) && !evidence.healthyConfigured,
      falseSignal: evidence.healthyConfigured,
      repair_profile: evidence.fallbackReachable ? "stub-fallback" : "mlx-primary",
      evidence_refs: ["configured-endpoint", "chat-ping", "fallback-port-8089"],
    },
    {
      id: "memory-governed-off",
      statement: "The safest current state is deterministic-only because RAM governance has disabled DeepSeek.",
      prior: 0.4,
      truthSignal: evidence.criticalMemory,
      falseSignal: !evidence.criticalMemory,
      repair_profile: "deterministic-only",
      evidence_refs: ["memory-governor", "nominal-headroom"],
    },
  ];

  return templates
    .map((template) => {
      const likelihoodIfTrue = template.truthSignal ? 0.92 : 0.3;
      const likelihoodIfFalse = template.falseSignal ? 0.72 : 0.28;
      return {
        id: template.id,
        statement: template.statement,
        prior: template.prior,
        likelihood_if_true: likelihoodIfTrue,
        likelihood_if_false: likelihoodIfFalse,
        posterior: round(bayesPosterior(template.prior, likelihoodIfTrue, likelihoodIfFalse)),
        evidence_refs: template.evidence_refs,
        repair_profile: template.repair_profile,
        repair_actions: buildActions(template.repair_profile),
      };
    })
    .sort((a, b) => b.posterior - a.posterior);
}

async function maybeRunModelSelfAssessment(
  reportSeed: {
    memory: RuntimeMemoryPressureSnapshot;
    probes: LocalModelWireupReport["probes"];
    env: LocalModelWireupReport["env"];
  },
  options: LocalModelWireupOptions,
): Promise<ModelSelfAssessment> {
  if (reportSeed.memory.level === "critical") {
    return {
      attempted: false,
      accepted: false,
      summary: "Skipped because the RAM governor reported critical pressure.",
    };
  }
  if (!options.explicitModelSelfAssessment) {
    return {
      attempted: false,
      accepted: false,
      summary: "Skipped because model self-assessment is explicit-only.",
    };
  }

  const configured = reportSeed.probes.configured;
  if (!configured?.ok) {
    return {
      attempted: false,
      accepted: false,
      summary: "Skipped because the configured local model endpoint is not reachable.",
    };
  }

  const apiKey = readEnv(options, "ORCHESTRATOR_LOCAL_ENGINE_API_KEY");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(configured.chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: readEnv(options, "ORCHESTRATOR_CHAT_MODEL") || "local-model",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildGovernedModelSystemPrompt({
              role: "You are Model diagnosing the local service topology that hosts you on Project Gauss.",
            }),
          },
          {
            role: "user",
            content: [
              "Return strict JSON with keys summary, preferred_profile, and evidence.",
              "Never invent reachability or successful starts.",
              "Observed state:",
              JSON.stringify(
                {
                  memory: {
                    level: reportSeed.memory.level,
                  },
                  env: reportSeed.env,
                  probes: reportSeed.probes,
                },
                null,
                2,
              ),
            ].join("\n"),
          },
        ],
      }),
      signal: AbortSignal.timeout(Math.min(AUDIT_TIMEOUT_MS, 25_000)),
    });
    if (!response.ok) {
      return {
        attempted: true,
        accepted: false,
        summary: `Rejected because the model self-assessment endpoint returned HTTP ${response.status}.`,
      };
    }
    const parsed = (await response.json()) as Record<string, unknown>;
    const content = extractChatContent(parsed);
    if (!content) {
      return {
        attempted: true,
        accepted: false,
        summary: "Rejected because the model self-assessment returned no parseable content.",
      };
    }
    const jsonText = extractFirstJsonObject(content) ?? content;
    const structured = JSON.parse(jsonText) as Record<string, unknown>;
    const summary = typeof structured.summary === "string" ? structured.summary.trim().slice(0, 220) : "";
    const preferredProfile =
      structured.preferred_profile === "stub-fallback" || structured.preferred_profile === "deterministic-only"
        ? structured.preferred_profile
        : "mlx-primary";
    if (!summary) {
      return {
        attempted: true,
        accepted: false,
        summary: "Rejected because the model self-assessment summary was empty.",
      };
    }
    return {
      attempted: true,
      accepted: true,
      summary: `${summary} Preferred profile: ${preferredProfile}.`,
    };
  } catch (error) {
    return {
      attempted: true,
      accepted: false,
      summary: `Rejected because the model self-assessment failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function runLocalModelWireupCycle(
  options: LocalModelWireupOptions = {},
): Promise<LocalModelWireupReport> {
  const memory = options.memorySnapshot ?? getRuntimeMemoryPressureSnapshot();
  const primaryPort = parsePort(readEnv(options, "MLX_PORT"), DEFAULT_PRIMARY_PORT);
  const fallbackPort = DEFAULT_FALLBACK_PORT;
  const rawOrchestratorLocalEngineUrl = readEnv(options, "ORCHESTRATOR_LOCAL_ENGINE_URL");
  const rawGaussBrainUrl = readEnv(options, "GAUSS_BRAIN_URL");
  const rawMlxChatUrl = readEnv(options, "MLX_CHAT_URL");
  const gaussBrainUrl = normalizeBaseUrl(rawGaussBrainUrl) ?? null;
  const orchestratorLocalEngineUrl = rawOrchestratorLocalEngineUrl
    ? normalizeChatCompletionsUrl(rawOrchestratorLocalEngineUrl)
    : null;
  const mlxChatUrl = normalizeBaseUrl(readEnv(options, "MLX_CHAT_URL")) ?? null;
  const configuredTransportUrl = rawOrchestratorLocalEngineUrl || rawGaussBrainUrl || rawMlxChatUrl;
  const explicitTransportConfigured = Boolean(configuredTransportUrl);
  const resolvedBaseUrl =
    normalizeBaseUrl(
      configuredTransportUrl || `http://127.0.0.1:${memory.level === "critical" ? fallbackPort : primaryPort}/v1`,
    ) ?? null;

  const preferredBaseUrl =
    memory.level === "critical"
      ? `http://127.0.0.1:${fallbackPort}/v1`
      : `http://127.0.0.1:${primaryPort}/v1`;
  const urlCoherent =
    (!gaussBrainUrl || gaussBrainUrl === preferredBaseUrl || gaussBrainUrl === resolvedBaseUrl) &&
    (!orchestratorLocalEngineUrl ||
      normalizeBaseUrl(orchestratorLocalEngineUrl) === (gaussBrainUrl ?? resolvedBaseUrl ?? preferredBaseUrl));
  const preferredPortConfigured = explicitTransportConfigured
    ? resolvedBaseUrl?.includes(`:${primaryPort}/`) ?? false
    : false;
  const localOnly = [gaussBrainUrl, orchestratorLocalEngineUrl, mlxChatUrl, resolvedBaseUrl].every(
    (value) => value == null || hostLooksLocal(value),
  );

  const probe = options.probeEndpoint ?? probeLocalModelEndpoint;
  const configuredProbe = resolvedBaseUrl ? await probe(resolvedBaseUrl) : null;
  const primaryProbe = await probe(`http://127.0.0.1:${primaryPort}/v1`);
  const fallbackProbe = await probe(`http://127.0.0.1:${fallbackPort}/v1`);

  const env = {
    orchestratorLocalEngineUrl,
    gaussBrainUrl,
    mlxChatUrl,
    resolvedBaseUrl,
    explicitTransportConfigured,
    urlCoherent,
    localOnly,
    preferredPortConfigured,
    apiKeyPresent: Boolean(readEnv(options, "ORCHESTRATOR_LOCAL_ENGINE_API_KEY")),
    chatModel: readEnv(options, "ORCHESTRATOR_CHAT_MODEL") || "local-model",
  };

  const hypotheses = buildHypotheses({
    memory,
    env,
    configuredProbe,
    primaryProbe,
    fallbackProbe,
  });
  const selected = hypotheses[0] ?? null;
  const preferredProfile =
    memory.level === "critical" ? "deterministic-only" : selected?.repair_profile ?? "mlx-primary";
  const modelSelfAssessment = await maybeRunModelSelfAssessment(
    {
      memory,
      env,
      probes: {
        configured: configuredProbe,
        primary: primaryProbe,
        fallback: fallbackProbe,
      },
    },
    options,
  );

  const verdict: LocalModelWireupReport["verdict"] =
    selected?.id === "healthy-primary" && configuredProbe?.ok
      ? "healthy"
      : memory.level === "critical" && !fallbackProbe.ok
        ? "blocked"
        : "repairable";

  const recommendedActions = selected?.repair_actions ?? buildActions(preferredProfile);

  return {
    generatedAt: new Date().toISOString(),
    verdict,
    mode: modelSelfAssessment.accepted ? "model-assisted" : "deterministic",
    memory: {
      level: memory.level,
      freeMb: memory.freeMb,
      suspendedSubsystems: memory.suspendedSubsystems,
    },
    topology: {
      preferredProfile,
      primaryPort,
      fallbackPort,
      startupCommands: {
        mlx: "npm run dev:brain:mlx",
        stub: "npm run dev:brain:stub",
        stack: "npm run dev:stack:mlx",
        smoke: "npm run test:local-chat",
      },
    },
    env,
    probes: {
      configured: configuredProbe,
      primary: primaryProbe,
      fallback: fallbackProbe,
    },
    hypotheses,
    selectedHypothesisId: selected?.id ?? null,
    recommendedActions,
    servicePrinciples: SERVICE_PRINCIPLES,
    modelSelfAssessment,
  };
}

export function writeLocalModelWireupReport(report: LocalModelWireupReport, outputPath: string): string {
  const absolutePath = path.resolve(outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return absolutePath;
}
