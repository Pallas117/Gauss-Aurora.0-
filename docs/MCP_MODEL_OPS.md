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
| RAG_URL / GAUSS_RAG_URL | http://127.0.0.1:3002 | RAG service base URL. Must be 127.0.0.1 or Tailscale. |
| BACKEND_URL / BACKEND_BASE_URL | http://127.0.0.1:3001 | Backend API base URL for Turing compute. |
| GAUSS_REPO_ROOT | parent of tools/mcp-model-ops | Repo root for scripts and reports. |
| MCP_MODEL_OPS_TOKEN | (none) | Bearer token for POST /api/turing/compute (operator). |

## Tools

- **rag_index** – Call `POST /api/rag/index` with optional `dir` (default `research/documentation-rag`). Re-index after adding or editing RAG docs.
- **rag_status** – Call `GET /api/rag/status`; returns `ok` and `chunkCount`.
- **evaluate_model** – Run `npm run context:backprop -- --short` and return the summary. Use to check progress/backprop capsule.
- **deploy_checkpoint** – Run `scripts/artifact_verify.py <version_dir>`; if checksum matches manifest, append to `reports/audit/model-deploy.log` and return a message to set `SURYA_MODEL_PATH` to the version dir. Does not change env or config itself.
- **run_training_job** – POST to backend `POST /api/turing/compute` with `job_type` (e.g. `surya_finetune`, `nowcast_retrain`) and optional `payload_json`. Requires operator auth via `MCP_MODEL_OPS_TOKEN`.

## Security

- Tools call only 127.0.0.1 or Tailscale (100.x.x.x) URLs. Other hosts are rejected.
- No cloud API keys in code; tokens come from env.
- Deploy and training submissions are appended to `reports/audit/model-deploy.log` (JSONL).

## References

- [MODEL_ARTIFACTS_AND_DEPLOY.md](MODEL_ARTIFACTS_AND_DEPLOY.md) – Artifact layout, manifest, checksum verify.
- [SURYA_FINETUNING_OFFLOAD.md](SURYA_FINETUNING_OFFLOAD.md) – Training offload and checkpoint placement.
