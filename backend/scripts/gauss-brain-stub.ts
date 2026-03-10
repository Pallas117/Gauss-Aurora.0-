import http from "node:http";

type ChatMessage = {
  role: "system" | "user" | "assistant" | string;
  content: string;
};

type ChatRequest = {
  model?: string;
  messages?: ChatMessage[];
};

const host = process.env.GAUSS_BRAIN_HOST ?? "127.0.0.1";
const preferredPort = Number(process.env.GAUSS_BRAIN_PORT ?? 8089);
const fallbackPort = preferredPort === 8088 ? 8089 : 8088;
// Use 8089 when 8088 is requested so we don't conflict with an existing process on 8088
const port = preferredPort === 8088 ? 8089 : preferredPort;
if (preferredPort === 8088) {
  console.warn("[gauss-brain-stub] GAUSS_BRAIN_PORT=8088 is in use elsewhere; using 8089");
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function buildReply(input: ChatRequest): string {
  const transcript = (input.messages ?? [])
    .map((msg) => `${msg.role}: ${msg.content ?? ""}`)
    .join("\n")
    .toLowerCase();
  const lastUser = [...(input.messages ?? [])].reverse().find((msg) => msg.role === "user");
  const text = (lastUser?.content ?? "").trim();
  if (/^ping$/i.test(text)) {
    return "Pong from Gauss Brain stub.";
  }
  const wantsCommandJson =
    transcript.includes("command_type") ||
    transcript.includes("command planner") ||
    transcript.includes("return only valid json");
  const wantsSafeCommandJson =
    transcript.includes("safe command planner") ||
    transcript.includes("keys: executable") ||
    transcript.includes("executable, args");
  if (wantsSafeCommandJson) {
    let executable = "pmset";
    let args: string[] = ["-g", "batt"];
    let risk: "low" | "medium" | "high" = "low";
    if (/uptime|load|cpu/.test(transcript)) {
      executable = "uptime";
      args = [];
      risk = "low";
    } else if (/disk|storage/.test(transcript)) {
      executable = "df";
      args = ["-h"];
      risk = "low";
    } else if (/memory|ram/.test(transcript)) {
      executable = "vm_stat";
      args = [];
      risk = "low";
    }
    return JSON.stringify({
      executable,
      args,
      reason: "stub safe command planner selection",
      confidence: 0.74,
      risk,
    });
  }
  if (wantsCommandJson) {
    let commandType = "log-health-check";
    let payload: Record<string, unknown> = {};
    if (/nowcast|infer|forecast/.test(transcript)) {
      commandType = "trigger-nowcast";
      payload = { horizonMinutes: 60 };
    } else if (/schedule|pass|downlink/.test(transcript)) {
      commandType = "schedule-pass";
      payload = { target: "DSCOVR", station: "GAUSS-GS-1", priority: 7 };
    }
    return JSON.stringify({
      command_type: commandType,
      payload,
      reason: "stub planner selection",
      confidence: 0.62,
    });
  }
  return `Stub response: received "${text || "empty prompt"}".`;
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Missing URL" });
    return;
  }

  if (req.method === "GET" && (req.url === "/health" || req.url === "/v1/health")) {
    sendJson(res, 200, { ok: true, service: "gauss-brain-stub", model: "local-model" });
    return;
  }

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      let payload: ChatRequest = {};
      try {
        payload = raw ? (JSON.parse(raw) as ChatRequest) : {};
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const now = new Date().toISOString();
      const reply = buildReply(payload);
      sendJson(res, 200, {
        id: `chatcmpl-${Math.random().toString(36).slice(2, 10)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: payload.model ?? "local-model",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: reply,
            },
          },
        ],
        usage: {
          prompt_tokens: 6,
          completion_tokens: 8,
          total_tokens: 14,
        },
        meta: {
          timestamp: now,
          source: "gauss-brain-stub",
        },
      });
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

function tryListen(p: number): void {
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && p === port && fallbackPort !== p) {
      console.warn(`[gauss-brain-stub] port ${p} in use, trying ${fallbackPort}`);
      tryListen(fallbackPort);
    } else {
      throw err;
    }
  });
  server.listen(p, host, () => {
    console.log(`[gauss-brain-stub] listening on http://${host}:${p}`);
    console.log("[gauss-brain-stub] endpoints: GET /health, POST /v1/chat/completions");
  });
}

tryListen(port);
