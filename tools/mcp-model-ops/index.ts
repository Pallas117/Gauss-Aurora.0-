#!/usr/bin/env node
/**
 * Gauss MCP server for model ops: rag_index, rag_status, evaluate_model, deploy_checkpoint, run_training_job.
 * Call backend or RAG at 127.0.0.1 / Tailscale only. Audit log for deploy and training.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGaussianHypothesisCycle } from "../../backend/learning/gaussian-hypothesis-cycle.js";
import { runLocalModelWireupCycle } from "../../backend/learning/local-model-wireup-cycle.js";
import {
  buildPolicyContext,
  hashPayload,
  type McpPolicyContext,
  validateEndpoint,
} from "./policy-gateway.js";
import { auditFilePath, writeMcpAuditEvent } from "./audit-sink.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAG_URL = (process.env.RAG_URL ?? process.env.GAUSS_RAG_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL ?? process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const REPO_ROOT = process.env.GAUSS_REPO_ROOT ?? path.resolve(__dirname, "../..");
const AUDIT_FILE = auditFilePath(REPO_ROOT);

async function enforceEndpointPolicy(context: McpPolicyContext, endpoint: string): Promise<void> {
  const decision = validateEndpoint(endpoint, context);
  if (!decision.allowed) {
    throw new Error(`${context.toolName} blocked by policy: ${decision.reason}`);
  }
}

async function ragIndex(context: McpPolicyContext, dir: string): Promise<{ ok: boolean; chunkCount?: number; error?: string }> {
  await enforceEndpointPolicy(context, RAG_URL);
  const res = await fetch(`${RAG_URL}/api/rag/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir: dir || "research/documentation-rag" }),
  });
  const data = (await res.json()) as { ok?: boolean; chunkCount?: number; error?: string };
  return { ok: data.ok === true, chunkCount: data.chunkCount, error: data.error };
}

async function ragStatus(context: McpPolicyContext): Promise<{ ok: boolean; chunkCount?: number }> {
  await enforceEndpointPolicy(context, RAG_URL);
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
      resolve({
        ok: true,
        message: `Verified. Set SURYA_MODEL_PATH (or active version) to: ${resolved}`,
      });
    });
  });
}

async function runTrainingJob(
  context: McpPolicyContext,
  jobType: string,
  payloadJson: string
): Promise<{ ok: boolean; job_id?: string; message: string }> {
  await enforceEndpointPolicy(context, BACKEND_URL);
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
  return { ok: true, job_id, message: job_id ? `Submitted job ${job_id}` : "Submitted" };
}

async function gaussianHypothesisCycle(question: string): Promise<{ ok: boolean; summary: string }> {
  const report = await runGaussianHypothesisCycle({ question, ragUrl: RAG_URL });
  const top = report.hypotheses[0] ?? null;
  return {
    ok: true,
    summary: JSON.stringify(
      {
        mode: report.mode,
        verdict: report.verdict,
        selectedHypothesisId: report.selectedHypothesisId,
        topHypothesis: top
          ? {
              statement: top.statement,
              posterior: top.posterior,
              safeExperiment: top.safe_experiment,
            }
          : null,
        nextStep: report.nextStep,
        sourceCount: report.rag.sourceCount,
      },
      null,
      2,
    ),
  };
}

async function auditLocalModelWireup(
  allowModel: boolean,
): Promise<{ ok: boolean; summary: string }> {
  const report = await runLocalModelWireupCycle({
    explicitModelSelfAssessment: allowModel,
  });
  return {
    ok: report.verdict !== "blocked",
    summary: JSON.stringify(
      {
        verdict: report.verdict,
        mode: report.mode,
        selectedHypothesisId: report.selectedHypothesisId,
        preferredProfile: report.topology.preferredProfile,
        deepseekMode: report.memory.deepseekMode,
        configuredEndpoint: report.probes.configured
          ? {
              ok: report.probes.configured.ok,
              baseUrl: report.probes.configured.baseUrl,
              kind: report.probes.configured.transportKind,
              detail: report.probes.configured.detail,
            }
          : null,
        recommendedActions: report.recommendedActions,
        modelSelfAssessment: report.modelSelfAssessment,
      },
      null,
      2,
    ),
  };
}

async function main(): Promise<void> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const z = await import("zod").then((m) => m.z);

  const server = new McpServer(
    { name: "gauss-mcp-model-ops", version: "1.0.0" },
    { capabilities: {} }
  );

  function registerGovernedTool<TArgs extends Record<string, unknown>>(
    toolName: string,
    config: {
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
    },
    handler: (args: TArgs, context: McpPolicyContext) => Promise<string>,
    endpointResolver?: (args: TArgs) => string | null,
  ): void {
    server.registerTool(
      toolName,
      config,
      async (args) => {
        const context = buildPolicyContext(toolName);
        const started = Date.now();
        const argsHash = hashPayload(args);
        const endpoint = endpointResolver ? endpointResolver(args as TArgs) : null;
        const baseEvent = {
          at: new Date().toISOString(),
          tool: toolName,
          argsHash,
          endpoint,
        };

        try {
          if (endpoint) {
            const endpointDecision = validateEndpoint(endpoint, context);
            if (!endpointDecision.allowed) {
              await writeMcpAuditEvent(AUDIT_FILE, {
                ...baseEvent,
                decision: "deny",
                reason: endpointDecision.reason,
                ok: false,
                elapsedMs: Date.now() - started,
              });
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        ok: false,
                        error: `${toolName} blocked by policy: ${endpointDecision.reason}`,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
          }

          const text = await handler(args as TArgs, context);
          await writeMcpAuditEvent(AUDIT_FILE, {
            ...baseEvent,
            decision: "allow",
            reason: "policy allow",
            ok: true,
            elapsedMs: Date.now() - started,
          });
          return { content: [{ type: "text" as const, text }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool execution failed";
          await writeMcpAuditEvent(AUDIT_FILE, {
            ...baseEvent,
            decision: "allow",
            reason: "policy allow",
            ok: false,
            error: message,
            elapsedMs: Date.now() - started,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: false, error: message }, null, 2),
              },
            ],
          };
        }
      },
    );
  }

  registerGovernedTool(
    "rag_index",
    {
      title: "RAG Index",
      description: "Call POST /api/rag/index to re-index RAG from a directory (default research/documentation-rag).",
      inputSchema: { dir: z.string().optional().describe("Directory to index, e.g. research/documentation-rag") },
    },
    async ({ dir }, context) => JSON.stringify(await ragIndex(context, dir ?? ""), null, 2),
    () => RAG_URL,
  );

  registerGovernedTool(
    "rag_status",
    {
      title: "RAG Status",
      description: "Call GET /api/rag/status and return chunk count / ok.",
      inputSchema: {},
    },
    async (_args, context) => JSON.stringify(await ragStatus(context), null, 2),
    () => RAG_URL,
  );

  registerGovernedTool(
    "evaluate_model",
    {
      title: "Evaluate Model",
      description: "Run backprop (context:backprop --short) and return summary.",
      inputSchema: {},
    },
    async () => {
      const result = await evaluateModel();
      return result.summary;
    },
  );

  registerGovernedTool(
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
      return result.message;
    },
  );

  registerGovernedTool(
    "run_training_job",
    {
      title: "Run Training Job",
      description: "Submit offload training job via backend POST /api/turing/compute. Requires operator auth (MCP_MODEL_OPS_TOKEN).",
      inputSchema: {
        job_type: z.string().describe("e.g. surya_finetune or nowcast_retrain"),
        payload_json: z.string().optional().describe("JSON string payload for the job"),
      },
    },
    async ({ job_type, payload_json }, context) =>
      JSON.stringify(await runTrainingJob(context, job_type, payload_json ?? "{}"), null, 2),
    () => BACKEND_URL,
  );

  registerGovernedTool(
    "gaussian_hypothesis_cycle",
    {
      title: "Gaussian Hypothesis Cycle",
      description: "Retrieve grounded evidence from local RAG, ask the local model for structured hypotheses, and compute the posterior in code with Bayes' rule.",
      inputSchema: {
        question: z.string().describe("Mission or engineering question to analyze"),
      },
    },
    async ({ question }) => {
      const result = await gaussianHypothesisCycle(question);
      return result.summary;
    },
    () => RAG_URL,
  );

  registerGovernedTool(
    "audit_local_model_wireup",
    {
      title: "Audit Local Model Wireup",
      description: "Inspect local DeepSeek or stub wiring, score the most probable fault, and return the safest repair profile.",
      inputSchema: {
        allow_model: z.boolean().optional().describe("Allow a bounded self-assessment by the local model when RAM policy permits it"),
      },
    },
    async ({ allow_model }) => {
      const result = await auditLocalModelWireup(Boolean(allow_model));
      return result.summary;
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
