import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  getRuntimeMemoryPressureSnapshot,
  type RuntimeMemoryPressureSnapshot,
} from "./memory-pressure.js";

export interface RuntimeLimitContextEvent {
  recordedAt: string;
  kind: "memory" | "battery" | "security" | "throttle";
  source: string;
  level: RuntimeMemoryPressureSnapshot["level"];
  freeMb: number;
  svgLiteForced: boolean;
  signals: string[];
  suspendedSubsystems: string[];
  ceilingOverrun: boolean;
  detail: Record<string, unknown>;
}

interface RuntimeLimitContextReport {
  generatedAt: string;
  eventCount: number;
  lastEvent: RuntimeLimitContextEvent | null;
  events: RuntimeLimitContextEvent[];
}

export interface RuntimeLimitContextRecorderOptions {
  kind?: RuntimeLimitContextEvent["kind"];
  source: string;
  detail?: Record<string, unknown>;
  reportPath?: string;
  ragDocPath?: string;
  cooldownMs?: number;
  maxEvents?: number;
  now?: Date;
}

export interface RuntimeLimitContextRecorderResult {
  recorded: boolean;
  reason: "nominal" | "deduped" | "recorded";
  event: RuntimeLimitContextEvent | null;
  reportPath: string;
  ragDocPath: string;
}

const DEFAULT_REPORT_PATH = "reports/progress/runtime-limit-context.latest.json";
const DEFAULT_RAG_DOC_PATH = "research/documentation-rag/runtime-limit-events/limit-context-log.md";
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_MAX_EVENTS = 40;
const recentSignatureTimes = new Map<string, number>();

function resolvePath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, Object.keys(value).sort(), 2);
}

function buildSignature(event: RuntimeLimitContextEvent): string {
  return [
    event.kind,
    event.source,
    event.level,
    event.ceilingOverrun ? "ceiling" : "no-ceiling",
    event.signals.join(","),
    stableJson(event.detail),
  ].join("|");
}

function loadExistingEvents(reportPath: string): RuntimeLimitContextEvent[] {
  if (!existsSync(reportPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as RuntimeLimitContextReport;
    return Array.isArray(parsed.events)
      ? parsed.events
      : [];
  } catch {
    return [];
  }
}

function writeReport(reportPath: string, events: RuntimeLimitContextEvent[], generatedAt: string): void {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const report: RuntimeLimitContextReport = {
    generatedAt,
    eventCount: events.length,
    lastEvent: events[0] ?? null,
    events,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function renderMarkdown(events: RuntimeLimitContextEvent[], generatedAt: string): string {
  const sections = events.flatMap((event) => {
    const detailText =
      Object.keys(event.detail).length > 0
        ? `- Detail: \`${stableJson(event.detail).replace(/\n/g, " ")}\``
        : "- Detail: none";
    return [
      `## ${event.recordedAt} · ${event.kind.toUpperCase()} · ${event.level.toUpperCase()} · ${event.source}`,
      `- Free MB: ${event.freeMb}`,
      `- SVG-lite forced: ${event.svgLiteForced ? "yes" : "no"}`,
      `- Ceiling overrun: ${event.ceilingOverrun ? "yes" : "no"}`,
      `- Signals: ${event.signals.join(", ") || "none"}`,
      `- Suspended subsystems: ${event.suspendedSubsystems.join(", ") || "none"}`,
      detailText,
      "",
    ];
  });

  return [
    "# Runtime Limit Context Log",
    "",
    "This file is generated automatically whenever Project Gauss hits constrained or critical runtime limits.",
    "It exists so local RAG can retrieve truthful recent operating context instead of reasoning from stale assumptions.",
    "",
    "## Operating Rule",
    "- Record limits truthfully.",
    "- Prefer deterministic degradation over invented recovery.",
    "- Use these events as bounded evidence for later diagnosis, not as proof that a repair has already succeeded.",
    "",
    `Generated at: ${generatedAt}`,
    "",
    ...sections,
  ].join("\n");
}

export function recordRuntimeLimitContext(
  snapshot: RuntimeMemoryPressureSnapshot,
  options: RuntimeLimitContextRecorderOptions,
): RuntimeLimitContextRecorderResult {
  const reportPath = resolvePath(options.reportPath ?? DEFAULT_REPORT_PATH);
  const ragDocPath = resolvePath(options.ragDocPath ?? DEFAULT_RAG_DOC_PATH);

  if (snapshot.level === "nominal" && !snapshot.ceiling.overCeiling) {
    return {
      recorded: false,
      reason: "nominal",
      event: null,
      reportPath,
      ragDocPath,
    };
  }

  const now = options.now ?? new Date();
  const event: RuntimeLimitContextEvent = {
    recordedAt: now.toISOString(),
    kind: options.kind ?? "memory",
    source: options.source,
    level: snapshot.level,
    freeMb: snapshot.freeMb,
    svgLiteForced: snapshot.svgLiteForced,
    signals: snapshot.signals,
    suspendedSubsystems: snapshot.suspendedSubsystems,
    ceilingOverrun: snapshot.ceiling.overCeiling,
    detail: options.detail ?? {},
  };

  const signature = buildSignature(event);
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const lastSeenAt = recentSignatureTimes.get(signature) ?? 0;
  if (now.getTime() - lastSeenAt < cooldownMs) {
    return {
      recorded: false,
      reason: "deduped",
      event,
      reportPath,
      ragDocPath,
    };
  }

  recentSignatureTimes.set(signature, now.getTime());
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const existing = loadExistingEvents(reportPath);
  const events = [event, ...existing].slice(0, maxEvents);

  writeReport(reportPath, events, event.recordedAt);
  mkdirSync(path.dirname(ragDocPath), { recursive: true });
  writeFileSync(ragDocPath, `${renderMarkdown(events, event.recordedAt)}\n`, "utf8");

  return {
    recorded: true,
    reason: "recorded",
    event,
    reportPath,
    ragDocPath,
  };
}

export function getTrackedRuntimeMemoryPressureSnapshot(
  source: string,
  detail?: Record<string, unknown>,
): RuntimeMemoryPressureSnapshot {
  const snapshot = getRuntimeMemoryPressureSnapshot();
  recordRuntimeLimitContext(snapshot, { kind: "memory", source, detail });
  return snapshot;
}

export function recordOperationalLimitContext(options: RuntimeLimitContextRecorderOptions): RuntimeLimitContextRecorderResult {
  const snapshot = getRuntimeMemoryPressureSnapshot();
  return recordRuntimeLimitContext(snapshot, options);
}
