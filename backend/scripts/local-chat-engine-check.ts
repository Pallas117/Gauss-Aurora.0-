/**
 * Shared check for the local chat engine (MLX DeepSeek, gauss-brain-stub, etc.).
 * Used at backend startup and by the test-local-chat-engine CLI.
 */

const TIMEOUT_MS = 30_000;
const FALLBACK_FIELDS = ["response", "output", "text", "message"] as const;

export function getChatEngineUrl(): string | null {
  const raw =
    process.env.ORCHESTRATOR_LOCAL_ENGINE_URL ??
    process.env.GAUSS_BRAIN_URL ??
    process.env.MLX_CHAT_URL ??
    "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUrl(base: string): string {
  const u = base.replace(/\/+$/, "");
  if (u.endsWith("/v1/chat/completions")) return u;
  if (u.endsWith("/v1")) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

function extractChatContent(parsed: Record<string, unknown>): string | null {
  const choices = parsed.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const msg = first?.message as Record<string, unknown> | undefined;
    const content = msg?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }
  }
  for (const field of FALLBACK_FIELDS) {
    const value = parsed[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export type LocalChatEngineResult =
  | { skipped: true; message: string }
  | { skipped: false; ok: true; message: string }
  | { skipped: false; ok: false; message: string };

export async function checkLocalChatEngine(): Promise<LocalChatEngineResult> {
  const baseUrl = getChatEngineUrl();
  if (!baseUrl) {
    return {
      skipped: true,
      message: "Local chat engine not configured (set ORCHESTRATOR_LOCAL_ENGINE_URL or GAUSS_BRAIN_URL to test)",
    };
  }

  const url = normalizeUrl(baseUrl);
  const model = process.env.ORCHESTRATOR_CHAT_MODEL?.trim() || "local-model";
  const apiKey = process.env.ORCHESTRATOR_LOCAL_ENGINE_API_KEY?.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const body = JSON.stringify({
    model,
    messages: [{ role: "user" as const, content: "Ping" }],
  });

  let response: Response;
  let responseText: string;

  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    responseText = await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isConnectionError =
      msg.includes("ECONNREFUSED") || msg.includes("connection refused") || msg.includes("fetch failed");
    let hint = "";
    if (isConnectionError) {
      if (url.includes(":8088"))
        hint =
          " Start MLX DeepSeek: npm run dev:brain:mlx (or mlx_lm.server --model mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit --port 8088)";
      else if (url.includes(":8089"))
        hint = " Start the stub with: npm run dev:brain:stub";
      else if (url.includes(":8080"))
        hint = " Use port 8088 for MLX (see .env.example) or 8089 for the stub (npm run dev:brain:stub).";
    }
    return { skipped: false, ok: false, message: `Request failed: ${msg}${hint}` };
  }

  if (!response.ok) {
    const truncate = responseText.length > 200 ? responseText.slice(0, 200) + "..." : responseText;
    return { skipped: false, ok: false, message: `HTTP ${response.status}: ${truncate}` };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    return { skipped: false, ok: false, message: "Response is not valid JSON" };
  }

  const content = extractChatContent(parsed);
  if (!content) {
    return {
      skipped: false,
      ok: false,
      message: "Response has no parseable content (expected choices[0].message.content)",
    };
  }

  return { skipped: false, ok: true, message: "OK" };
}
