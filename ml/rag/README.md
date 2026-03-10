# Gauss RAG service

Real RAG over research/documentation-rag (or any dir): PDF, Markdown, HTML to chunk, embed (local), LanceDB with SHA-256 checksums; query to k-NN, verify checksums, local LLM, answer and sources.

## Run

From repo root: pip install -r ml/rag/requirements.txt then npm run dev:rag (or python3 -m ml.rag.server). Default port 3002.

## Env

GAUSS_RAG_PORT, GAUSS_RAG_HOST; GAUSS_RAG_DB_PATH; ORCHESTRATOR_LOCAL_ENGINE_URL or GAUSS_BRAIN_URL; VITE_GAUSS_RAG_INDEX_DIR.

## API

GET /api/rag/status; POST /api/rag/index body `{ dir, manifest_path?, require_approved? }`; POST /api/rag/query body `{ query }`. Checksums are verified before LLM (SEU resilience).

## Trust-first indexing

Run `npm run audit:documents:trust` before indexing. That generates:
- `research/documentation-rag/.gauss-doc-trust.json` for the indexer
- `reports/rag/document-trust-manifest.latest.json` for audit review

By default, `POST /api/rag/index` requires approved documents and will refuse to index if the trust manifest is missing. Only files marked `indexAllowed: true` are chunked.

## Re-index after adding content

After adding or editing docs under `research/documentation-rag` (e.g. `spacecraft-ops-probability/`):
1. Run `npm run audit:documents:trust`
2. Review approvals/redaction state
3. Re-run the index so the co-pilot has the latest trusted context: `POST /api/rag/index` with body `{ "dir": "research/documentation-rag" }`

Default index dir is `research/documentation-rag`. See also [docs/CONTINUOUS_OPTIMIZATION_RUNBOOK.md](../docs/CONTINUOUS_OPTIMIZATION_RUNBOOK.md) for cadence and automation.
