import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { insertCommandLog } from "../../backend/pg.js";

export interface McpAuditEvent {
  at: string;
  tool: string;
  decision: "allow" | "deny";
  reason: string;
  argsHash: string;
  endpoint?: string | null;
  elapsedMs?: number;
  ok?: boolean;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function auditFilePath(repoRoot: string): string {
  return path.join(repoRoot, "reports", "audit", "mcp-tool-decisions.jsonl");
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function writeMcpAuditEvent(filePath: string, event: McpAuditEvent): Promise<void> {
  ensureDir(filePath);
  appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");

  // Optional DB mirror for centralized operational audit.
  const dbAuditEnabled = isTruthy(process.env.GAUSS_MCP_DB_AUDIT);
  if (!dbAuditEnabled) return;
  try {
    await insertCommandLog({
      command_type: "mcp-tool-decision",
      payload: {
        tool: event.tool,
        decision: event.decision,
        reason: event.reason,
        argsHash: event.argsHash,
        endpoint: event.endpoint ?? null,
        elapsedMs: event.elapsedMs ?? null,
        ok: event.ok ?? null,
        error: event.error ?? null,
        metadata: event.metadata ?? {},
      },
      role: "system",
      user_id: "mcp-model-ops",
    });
  } catch {
    // Keep MCP flow healthy if DB path is unavailable.
  }
}

