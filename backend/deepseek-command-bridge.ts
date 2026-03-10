export const ALLOWED_OPS_COMMAND_TYPES = [
  "trigger-nowcast",
  "schedule-pass",
  "log-health-check",
] as const;

export type OpsCommandType = (typeof ALLOWED_OPS_COMMAND_TYPES)[number];

export interface DeepSeekCommandPlan {
  command_type: OpsCommandType;
  payload: Record<string, unknown>;
  reason: string | null;
  confidence: number | null;
}

const FALLBACK_CHAT_FIELDS = ["response", "output", "text", "message", "reasoning"] as const;

export function isOpsCommandType(value: unknown): value is OpsCommandType {
  return typeof value === "string" && (ALLOWED_OPS_COMMAND_TYPES as readonly string[]).includes(value);
}

export function normalizeChatCompletionsUrl(base: string): string {
  const value = base.trim().replace(/\/+$/, "");
  if (value.endsWith("/v1/chat/completions")) return value;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return `${value}/v1/chat/completions`;
}

export function extractChatContent(parsed: Record<string, unknown>): string | null {
  const choices = parsed.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object") {
      const message = (first as Record<string, unknown>).message;
      if (message && typeof message === "object") {
        const msg = message as Record<string, unknown>;
        const content = msg.content;
        if (typeof content === "string" && content.trim().length > 0) {
          return content.trim();
        }
        const reasoning = msg.reasoning;
        if (typeof reasoning === "string" && reasoning.trim().length > 0) {
          return reasoning.trim();
        }
      }
    }
  }

  for (const field of FALLBACK_CHAT_FIELDS) {
    const value = parsed[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export function extractFirstJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseConfidence(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(1, num));
}

function parseCommandType(value: unknown): OpsCommandType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isOpsCommandType(normalized) ? normalized : null;
}

export function parseDeepSeekCommandPlan(input: string | Record<string, unknown>): DeepSeekCommandPlan | null {
  let parsedObject: Record<string, unknown> | null = null;
  if (typeof input === "string") {
    const direct = input.trim();
    const maybeJson = direct.startsWith("{") ? direct : extractFirstJsonObject(direct);
    if (!maybeJson) return null;
    try {
      parsedObject = asObject(JSON.parse(maybeJson));
    } catch {
      parsedObject = null;
    }
  } else {
    parsedObject = asObject(input);
  }

  if (!parsedObject) return null;

  const commandType =
    parseCommandType(parsedObject.command_type) ?? parseCommandType(parsedObject.commandType);
  if (!commandType) return null;

  const payload = asObject(parsedObject.payload) ?? {};
  const reason =
    typeof parsedObject.reason === "string" && parsedObject.reason.trim().length > 0
      ? parsedObject.reason.trim().slice(0, 500)
      : null;

  return {
    command_type: commandType,
    payload,
    reason,
    confidence: parseConfidence(parsedObject.confidence),
  };
}
