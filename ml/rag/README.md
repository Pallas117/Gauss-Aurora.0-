# Gauss RAG service

Hybrid local memory over approved Gauss roots: PDF, Markdown, HTML, PPTX, JSON, JSONL, CSV, and TSV are chunked with source context, stored in SQLite/FTS5 for exact search and provenance, and embedded locally into LanceDB for semantic retrieval. A bounded graph links documents, chunks, and extracted concepts.

Application/tool integrations use the vendor-neutral `gauss-memory-record-v1` JSONL contract. Use `/api/memory/capabilities`, `/api/memory/export`, and `/api/memory/import` at the adapter boundary; unapproved imported records remain `needs_review` and are excluded from retrieval.

## Run

From repo root: pip install -r ml/rag/requirements.txt then npm run dev:rag (or python3 -m ml.rag.server). Default port 3002.

## Env

GAUSS_RAG_PORT, GAUSS_RAG_HOST; GAUSS_RAG_DB_PATH; ORCHESTRATOR_LOCAL_ENGINE_URL or GAUSS_BRAIN_URL; VITE_GAUSS_RAG_INDEX_DIR.

## API

Compatibility API: `GET /api/rag/status`; `POST /api/rag/index` body `{ dir, manifest_path?, require_approved?, mode? }`; `POST /api/rag/query` body `{ query, top_k? }`.

Memory API: `GET /api/memory/status`; `POST /api/memory/index`; `POST /api/memory/search`; `GET /api/memory/graph`; `POST /api/memory/remember`; `POST /api/memory/compact`; `POST /api/memory/forget`.

Checksums are verified before context reaches the local LLM. Graph responses are capped at 200 nodes/400 edges and traversal depth 2.

## Trust-first indexing

Run `npm run audit:documents:trust` before indexing. That generates:
- `research/documentation-rag/.gauss-doc-trust.json` for the indexer
- `reports/rag/document-trust-manifest.latest.json` for audit review

By default, indexing requires an approved trust manifest and only files marked `indexAllowed: true` are chunked. Import an external file explicitly with `npm run memory:import -- --source /path/to/file`, review it, then run `npm run memory:trust` for the inbox.

## Re-index after adding content

After adding or editing docs under `research/documentation-rag` (e.g. `spacecraft-ops-probability/`):
1. Run `npm run audit:documents:trust`
2. Review approvals/redaction state
3. Re-run the index so the co-pilot has the latest trusted context: `POST /api/rag/index` with body `{ "dir": "research/documentation-rag" }`

Default index dir is `research/documentation-rag`. See also [docs/CONTINUOUS_OPTIMIZATION_RUNBOOK.md](../docs/CONTINUOUS_OPTIMIZATION_RUNBOOK.md) for cadence and automation.
