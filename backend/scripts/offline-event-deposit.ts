import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildGovernedModelSystemPrompt } from "../ethics/model-governance.js";
import { sanitizeModelReflection } from "../model-output-sanitizer.js";
import { buildTrustManifest, writeTrustManifest } from "./document-trust-pipeline.ts";
import { extractChatContent } from "./local-chat-engine-check.ts";

interface EventSource {
  label: string;
  url: string;
}

interface EventPayload {
  title: string;
  eventDate: string | null;
  summary: string;
  body: string;
  lessons: string[];
  sources: EventSource[];
}

interface EventLearningRecord {
  source: "mission-event";
  title: string;
  event_date: string | null;
  prompt: string;
  completion: string;
}

interface DepositItemReport {
  sourcePath: string;
  destinationPath: string;
  processedPath: string;
  usedLocalModel: boolean;
}

interface DepositReport {
  generatedAt: string;
  inboxDir: string;
  processedCount: number;
  ragIndex: {
    attempted: boolean;
    ok: boolean;
    status: number | null;
    detail: string | null;
  };
  items: DepositItemReport[];
}

const LOCAL_MODEL_TIMEOUT_MS = Number(
  process.env.GAUSS_LOCAL_CHAT_TIMEOUT_MS ??
    process.env.GAUSS_LOCAL_EVAL_TIMEOUT_MS ??
    120_000,
);

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseSources(value: unknown): EventSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        return { label: item, url: item };
      }
      if (item && typeof item === "object") {
        const label = typeof (item as { label?: unknown }).label === "string"
          ? (item as { label: string }).label
          : typeof (item as { url?: unknown }).url === "string"
            ? (item as { url: string }).url
            : "";
        const url = typeof (item as { url?: unknown }).url === "string"
          ? (item as { url: string }).url
          : "";
        if (label && url) return { label, url };
      }
      return null;
    })
    .filter((item): item is EventSource => Boolean(item));
}

export function parseEventPayload(raw: string, extension: string, fallbackTitle: string): EventPayload {
  if (extension === ".json") {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const title =
      (typeof parsed.title === "string" && parsed.title.trim()) ||
      fallbackTitle;
    const summary =
      (typeof parsed.summary === "string" && parsed.summary.trim()) ||
      (typeof parsed.body === "string" && parsed.body.trim()) ||
      "";
    const body =
      (typeof parsed.body === "string" && parsed.body.trim()) ||
      summary;
    const lessons = Array.isArray(parsed.lessons)
      ? parsed.lessons.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const eventDate =
      typeof parsed.event_date === "string"
        ? parsed.event_date
        : typeof parsed.eventDate === "string"
          ? parsed.eventDate
          : null;
    return {
      title,
      eventDate,
      summary,
      body,
      lessons,
      sources: parseSources(parsed.sources),
    };
  }

  const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallbackTitle;
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  return {
    title: heading,
    eventDate: null,
    summary: paragraphs[0] ?? raw.trim(),
    body: raw.trim(),
    lessons: [],
    sources: [],
  };
}

function normalizeChatUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

async function synthesizeWithLocalModel(payload: EventPayload): Promise<string | null> {
  const base =
    process.env.ORCHESTRATOR_LOCAL_ENGINE_URL ??
    process.env.GAUSS_BRAIN_URL ??
    "";
  const trimmed = base.trim();
  if (!trimmed) return null;

  const url = normalizeChatUrl(trimmed);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.ORCHESTRATOR_LOCAL_ENGINE_API_KEY?.trim()) {
    headers.Authorization = `Bearer ${process.env.ORCHESTRATOR_LOCAL_ENGINE_API_KEY.trim()}`;
  }

  const prompt = [
    `Title: ${payload.title}`,
    `Event date: ${payload.eventDate ?? "unknown"}`,
    `Summary: ${payload.summary}`,
    "",
    payload.body,
  ].join("\n");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.ORCHESTRATOR_CHAT_MODEL?.trim() || "local-model",
        messages: [
          {
            role: "system",
            content: buildGovernedModelSystemPrompt({
              role: "You are Model running fully offline for Gauss mission lessons.",
              directives: [
                "Summarize this mission event into 4 short operational lessons and a short doctrine note.",
                "Be precise and causal. Do not invent details.",
              ],
            }),
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(LOCAL_MODEL_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as Record<string, unknown>;
    const extracted = extractChatContent(parsed);
    return extracted ? sanitizeModelReflection(extracted) : null;
  } catch {
    return null;
  }
}

export function buildLessonMarkdown(payload: EventPayload, synthesized: string | null, sourceName: string): string {
  const lessonLines =
    payload.lessons.length > 0
      ? payload.lessons.map((lesson) => `- ${lesson}`)
      : [
          "- Fuel and attitude margins can terminate a radiation-belt mission before electronics fail.",
          "- Solar-cycle drag uncertainty must be carried into lifetime and re-entry models.",
          "- Radiation-belt instrumentation needs contamination-aware confidence handling.",
          "- Operational causality should stay anchored to solar-wind and geomagnetic coupling, not speculative planetary drivers.",
        ];

  const sourceLines =
    payload.sources.length > 0
      ? payload.sources.map((source) => `- [${source.label}](${source.url})`)
      : ["- Source bundle deposited from offline inbox without explicit references."];

  return [
    `# ${payload.title}`,
    "",
    `Source inbox file: \`${sourceName}\``,
    payload.eventDate ? `Event date: ${payload.eventDate}` : "Event date: unknown",
    "",
    "## Summary",
    payload.summary,
    "",
    "## Event Body",
    payload.body,
    "",
    "## Operational Lessons",
    ...lessonLines,
    "",
    "## Gauss Doctrine Update",
    "Prioritize solar-wind / IMF coupling, drag uncertainty, fuel and attitude margin, and sensor contamination confidence before invoking speculative tertiary priors.",
    "",
    "## Offline Model Reflection",
    synthesized ?? "Local Model reflection unavailable; deterministic lesson template applied.",
    "",
    "## References",
    ...sourceLines,
    "",
  ].join("\n");
}

function appendJsonl(filePath: string, record: EventLearningRecord): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8").trimEnd() : "";
  const next = `${existing}${existing ? os.EOL : ""}${JSON.stringify(record)}`.trimEnd() + os.EOL;
  writeFileSync(filePath, next, "utf8");
}

export function upsertTrustOverride(overridesPath: string, docPath: string): void {
  const parsed = existsSync(overridesPath)
    ? (JSON.parse(readFileSync(overridesPath, "utf8")) as { documents?: Record<string, unknown> })
    : { documents: {} };
  const documents = parsed.documents ?? {};
  documents[docPath] = {
    approvalStatus: "approved",
    redactionStatus: "ready",
    sensitivity: "public",
    owner: "gauss",
    retentionPolicy: "living_reference",
    reasons: [
      "Approved mission lesson for offline RAG and local event-learning deposit.",
    ],
  };
  mkdirSync(path.dirname(overridesPath), { recursive: true });
  writeFileSync(
    overridesPath,
    `${JSON.stringify({ documents }, null, 2)}${os.EOL}`,
    "utf8",
  );
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}${os.EOL}`, "utf8");
}

export async function maybeIndexRag(): Promise<DepositReport["ragIndex"]> {
  const ragUrl = (process.env.GAUSS_RAG_URL ?? "http://127.0.0.1:3002").trim().replace(/\/+$/, "");
  try {
    const response = await fetch(`${ragUrl}/api/rag/index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dir: "research/documentation-rag",
        manifest_path: "research/documentation-rag/.gauss-doc-trust.json",
        require_approved: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    return {
      attempted: true,
      ok: response.ok,
      status: response.status,
      detail: body.slice(0, 300),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const inboxDir = path.resolve(argValue("--inbox-dir") ?? "reports/lessons/inbox");
  const processedDir = path.resolve(argValue("--processed-dir") ?? "reports/lessons/processed");
  const destDir = path.resolve(argValue("--dest-dir") ?? "research/documentation-rag/mission-lessons");
  const overridesPath = path.resolve("research/documentation-rag/.gauss-doc-trust-overrides.json");
  const trainPath = path.resolve("ml/data/event_lessons.jsonl");
  const jsonOut = path.resolve(argValue("--json-out") ?? "reports/rag/offline-event-deposit.latest.json");

  mkdirSync(inboxDir, { recursive: true });
  mkdirSync(processedDir, { recursive: true });
  mkdirSync(destDir, { recursive: true });

  const entries = existsSync(inboxDir)
    ? readdirSync(inboxDir)
        .filter((name) => !name.startsWith("."))
        .map((name) => path.join(inboxDir, name))
        .filter((filePath) => {
          const ext = path.extname(filePath).toLowerCase();
          return [".json", ".md", ".txt"].includes(ext);
        })
    : [];

  const items: DepositItemReport[] = [];
  for (const sourcePath of entries) {
    const raw = readFileSync(sourcePath, "utf8");
    const ext = path.extname(sourcePath).toLowerCase();
    const baseName = path.basename(sourcePath, ext);
    const payload = parseEventPayload(raw, ext, baseName.replace(/[-_]+/g, " "));
    const synthesized = await synthesizeWithLocalModel(payload);
    const slug = slugify(payload.title || baseName);
    const destinationPath = path.join(destDir, `${slug}.md`);
    const relDocPath = path.relative(path.resolve("research/documentation-rag"), destinationPath).split(path.sep).join("/");
    const document = buildLessonMarkdown(payload, synthesized, path.basename(sourcePath));
    writeFileSync(destinationPath, document, "utf8");
    upsertTrustOverride(overridesPath, relDocPath);

    appendJsonl(trainPath, {
      source: "mission-event",
      title: payload.title,
      event_date: payload.eventDate,
      prompt: `Extract the operational lessons from the event "${payload.title}" for Gauss.`,
      completion: synthesized ?? document,
    });

    const processedPath = path.join(processedDir, path.basename(sourcePath));
    renameSync(sourcePath, processedPath);
    items.push({
      sourcePath,
      destinationPath,
      processedPath,
      usedLocalModel: Boolean(synthesized),
    });
  }

  const manifest = buildTrustManifest("research/documentation-rag");
  writeTrustManifest(path.resolve("research/documentation-rag/.gauss-doc-trust.json"), manifest);
  writeTrustManifest(path.resolve("reports/rag/document-trust-manifest.latest.json"), manifest);

  const ragIndex = items.length > 0 ? await maybeIndexRag() : { attempted: false, ok: false, status: null, detail: null };
  const report: DepositReport = {
    generatedAt: new Date().toISOString(),
    inboxDir,
    processedCount: items.length,
    ragIndex,
    items,
  };

  writeJson(jsonOut, report);
  console.log(JSON.stringify(report, null, 2));

  if (items.length > 0 && ragIndex.attempted && !ragIndex.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  void main();
}
