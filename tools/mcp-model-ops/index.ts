#!/usr/bin/env node
/**
 * Gauss MCP server for model ops: rag_index, rag_status, evaluate_model, deploy_checkpoint, run_training_job.
 * Call backend or RAG at 127.0.0.1 / Tailscale only. Audit log for deploy and training.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAG_URL = (process.env.RAG_URL ?? process.env.GAUSS_RAG_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL ?? process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const REPO_ROOT = process.env.GAUSS_REPO_ROOT ?? path.resolve(__dirname, "../..");
const AUDIT_DIR = path.join(REPO_ROOT, "reports", "audit");
const AUDIT_FILE = path.join(AUDIT_DIR, "model-deploy.log");

function ensureAuditDir(): void {
  if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
}

function auditLog(entry: { at: string; action: string; [k: string]: unknown }): void {
  ensureAuditDir();
  appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
}

function isLocalOrTailscale(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return true;
    if (u.hostname.startsWith("100.")) return true; // Tailscale CGNAT range
    return false;
  } catch {
    return false;
  }
}

async function ragIndex(dir: string): Promise<{ ok: boolean; chunkCount?: number; error?: string }> {
  if (!isLocalOrTailscale(RAG_URL)) return { ok: false, error: "RAG_URL must be 127.0.0.1 or Tailscale" };
  const res = await fetch(`${RAG_URL}/api/rag/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir: dir || "research/documentation-rag" }),
  });
  const data = (await res.json()) as { ok?: boolean; chunkCount?: number; error?: string };
  return { ok: data.ok === true, chunkCount: data.chunkCount, error: data.error };
}

async function ragStatus(): Promise<{ ok: boolean; chunkCount?: number }> {
  if (!isLocalOrTailscale(RAG_URL)) return { ok: false };
  const res = await fetch(`${RAG_URL}/api/rag/status`);
  const data = (await res.json()) as { ok?: boolean; chunkCount?: number };
  return { ok: data.ok === true, chunkCount: data.chunkCount };
}

async function evaluateModel(): Promise<{ summary: string; ok: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(
      "npm",
      ["run", "context:backprop", "--", "--short"],
      { cwd: REPO_ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    child.stdout?.on("data", (c) => (out += c.toString()));
    child.stderr?.on("data", (c) => (err += c.toString()));
    child.on("close", (code) => {
      const summary = (out || err).trim().slice(0, 2000) || `Exit code ${code}`;
      resolve({ summary, ok: code === 0 });
    });
  });
}

async function deployCheckpoint(versionDir: string): Promise<{ ok: boolean; message: string }> {
  const resolved = path.isAbsolute(versionDir) ? versionDir : path.join(REPO_ROOT, versionDir);
  const verifyScript = path.join(REPO_ROOT, "scripts", "artifact_verify.py");
  if (!existsSync(verifyScript)) {
    return { ok: false, message: "scripts/artifact_verify.py not found" };
  }
  return new Promise((resolve) => {
    const child = spawn("python3", [verifyScript, resolved], { cwd: REPO_ROOT });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, message: `Checksum verification failed (exit ${code}). Do not deploy.` });
        return;
      }
      auditLog({
        at: new Date().toISOString(),
        action: "deploy",
        version_dir: resolved,
      });
      resolve({
        ok: true,
        message: `Verified. Set SURYA_MODEL_PATH (or active version) to: ${resolved}`,
      });
    });
  });
}

async function runTrainingJob(
  jobType: string,
  payloadJson: string
): Promise<{ ok: boolean; job_id?: string; message: string }> {
  if (!isLocalOrTailscale(BACKEND_URL)) {
    return { ok: false, message: "BACKEND_URL must be 127.0.0.1 or Tailscale for run_training_job" };
  }
  const token = process.env.MCP_MODEL_OPS_TOKEN ?? "";
  let payload: unknown;
  try {
    payload = payloadJson ? JSON.parse(payloadJson) : {};
  } catch {
    return { ok: false, message: "Invalid payload JSON" };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_URL}/api/turing/compute`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: jobType, payload }),
  });
  if (res.status === 401) return { ok: false, message: "Unauthorized. Set MCP_MODEL_OPS_TOKEN with operator token." };
  if (res.status === 503) return { ok: false, message: "Turing pool disabled" };
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, message: `Backend ${res.status}: ${t.slice(0, 200)}` };
  }
  const data = (await res.json()) as { device_id?: string; job_id?: string; response?: { job_id?: string } };
  const job_id = data?.job_id ?? data?.response?.job_id;
  auditLog({ at: new Date().toISOString(), action: "training_submit", job_type: jobType, job_id });
  return { ok: true, job_id, message: job_id ? `Submitted job ${job_id}` : "Submitted" };
}

async function main(): Promise<void> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const z = await import("zod").then((m) => m.z);

  const server = new McpServer(
    { name: "gauss-mcp-model-ops", version: "1.0.0" },
    { capabilities: {} }
  );

  server.registerTool(
    "rag_index",
    {
      title: "RAG Index",
      description: "Call POST /api/rag/index to re-index RAG from a directory (default research/documentation-rag).",
      inputSchema: { dir: z.string().optional().describe("Directory to index, e.g. research/documentation-rag") },
    },
    async ({ dir }) => {
      const result = await ragIndex(dir ?? "");
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "rag_status",
    {
      title: "RAG Status",
      description: "Call GET /api/rag/status and return chunk count / ok.",
      inputSchema: {},
    },
    async () => {
      const result = await ragStatus();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "evaluate_model",
    {
      title: "Evaluate Model",
      description: "Run backprop (context:backprop --short) and return summary.",
      inputSchema: {},
    },
    async () => {
      const result = await evaluateModel();
      return { content: [{ type: "text" as const, text: result.summary }] };
    }
  );

  server.registerTool(
    "deploy_checkpoint",
    {
      title: "Deploy Checkpoint",
      description: "Verify artifact version dir with scripts/artifact_verify.py then log deploy; returns message to set SURYA_MODEL_PATH.",
      inputSchema: {
        version_dir: z.string().describe("Path to artifact version dir, e.g. artifacts/models/surya/v1.0.0"),
      },
    },
    async ({ version_dir }) => {
      const result = await deployCheckpoint(version_dir);
      return { content: [{ type: "text" as const, text: result.message }] };
    }
  );

  server.registerTool(
    "run_training_job",
    {
      title: "Run Training Job",
      description: "Submit offload training job via backend POST /api/turing/compute. Requires operator auth (MCP_MODEL_OPS_TOKEN).",
      inputSchema: {
        job_type: z.string().describe("e.g. surya_finetune or nowcast_retrain"),
        payload_json: z.string().optional().describe("JSON string payload for the job"),
      },
    },
    async ({ job_type, payload_json }) => {
      const result = await runTrainingJob(job_type, payload_json ?? "{}");
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
