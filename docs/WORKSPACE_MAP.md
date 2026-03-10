# Workspace Map

This map is the coding-first layout for the Gauss Aurora repository.

## Core App Surface (edit most)
- `src/` - React app, routes, hooks, UI components.
- `backend/` - API server, auth/RBAC, feed adapters, ingestion, physics/mL clients.
- `supabase/` - SQL migrations, edge functions, local Supabase config.
- `tests/` - Python/unit/integration/e2e/mobile tests.
- `scripts/` - developer workflows (release, tailscale, progress, process).

## Domain Engines
- `gauss-orchestrator/` - Rust orchestrator and protocol/network management.
- `ml/` - Python model training/inference helpers.
- `mobile/` - React Native/Detox scaffolding.

## Tooling
- `tools/progress-checker/` - progress checker + backprop scaffold utilities.

## Research and Reference (non-runtime)
- `research/data-rag/`
- `research/documentation-rag/`
- `research/legacy-v0-1/` (legacy local requirement kit/cache)

## Path Policy
Canonical paths are now no-space and direct:
- `gauss-orchestrator/`
- `tools/progress-checker/`
- `research/*`

Legacy compatibility symlinks were removed in strict cleanup.

## Fast Start
```bash
npm run lint
npm run build
npm run progress:short
npm run dev:stack
```

## Navigation Tip
Use the included focused tree command to avoid noise from dependency/build folders:
```bash
bash scripts/process/workspace-tree.sh
```
