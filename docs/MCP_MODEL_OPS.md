# AI-Assisted Model Refresh (MCP Model Ops)

The Gauss MCP server **gauss-mcp-model-ops** exposes tools so that AI assistants (e.g. Cursor) can trigger model-related operations in a standard way: index RAG, check RAG status, run evaluation, deploy a checkpoint, or submit an offload training job.

## Running the server

From repo root:

```bash
node --import tsx tools/mcp-model-ops/index.ts
```

Or from `tools/mcp-model-ops`: `npm run start` (if tsx is available).

Configure Cursor (or another MCP client) to run this command as a stdio MCP server. The server communicates over stdin/stdout.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| RAG_URL / GAUSS_RAG_URL | http://127.0.0.1:3002 | RAG service base URL. Must satisfy MCP policy gateway allowlist. |
| BACKEND_URL / BACKEND_BASE_URL | http://127.0.0.1:3001 | Backend API base URL for Turing compute. Must satisfy MCP policy gateway allowlist. |
| GAUSS_REPO_ROOT | parent of tools/mcp-model-ops | Repo root for scripts and reports. |
| MCP_MODEL_OPS_TOKEN | (none) | Bearer token for POST /api/turing/compute (operator). |
| GAUSS_AIR_GAP | 1 | Offline-first default. In air-gap mode, MCP tools only allow loopback endpoints. |
| GAUSS_ALLOW_TAILSCALE | (unset) | Optional. When GAUSS_AIR_GAP is disabled, allow `100.x.x.x` hosts. |
| GAUSS_MCP_DB_AUDIT | (unset) | Optional mirror of MCP tool decisions into backend DB command log. |

## Tools

- **rag_index** – Call `POST /api/rag/index` with optional `dir` (default `research/documentation-rag`). Re-index after adding or editing RAG docs.
- **rag_status** – Call `GET /api/rag/status`; returns `ok` and `chunkCount`.
- **evaluate_model** – Run `npm run context:backprop -- --short` and return the summary. Use to check progress/backprop capsule.
- **deploy_checkpoint** – Run `scripts/artifact_verify.py <version_dir>`; if checksum matches manifest, return a message to set `SURYA_MODEL_PATH` to the version dir. Does not change env or config itself.
- **run_training_job** – POST to backend `POST /api/turing/compute` with `job_type` (e.g. `surya_finetune`, `nowcast_retrain`) and optional `payload_json`. Requires operator auth via `MCP_MODEL_OPS_TOKEN`.

## Security and Governance

- All MCP tools pass through a policy gateway with per-call decision logging.
- Offline-first defaults (`GAUSS_AIR_GAP=1`) enforce loopback-only endpoints.
- Tailscale (`100.x.x.x`) is opt-in and only available when air-gap mode is disabled.
- No cloud API keys in code; tokens come from env.
- Tool decisions are written to `reports/audit/mcp-tool-decisions.jsonl` (JSONL).

## References

- [MODEL_ARTIFACTS_AND_DEPLOY.md](MODEL_ARTIFACTS_AND_DEPLOY.md) – Artifact layout, manifest, checksum verify.
- [SURYA_FINETUNING_OFFLOAD.md](SURYA_FINETUNING_OFFLOAD.md) – Training offload and checkpoint placement.
