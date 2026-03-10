# Model Artifacts and Deployment

This document defines the versioned artifact store for Surya and nowcast checkpoints, the manifest schema, checksum-verify-before-deploy step, and audit logging. It supports [SURYA_FINETUNING_OFFLOAD.md](SURYA_FINETUNING_OFFLOAD.md) and any backend or MCP deploy flow.

## Artifact layout

Store checkpoints and configs in a known layout under the repo or a configured root (e.g. `artifacts/` at repo root):

```
artifacts/
  models/
    surya/
      <version>/          # e.g. v1.0.0, 20260301-finetune
        checkpoint.pt     # or surya.366m.finetuned.pt
        config.yaml       # optional
        scalers.yaml      # optional
        manifest.json     # required: checksum, created_at, source_job_id
      latest -> v1.0.0    # optional symlink for "current" version
    nowcast/
      <version>/
        checkpoint.pt
        config.json       # optional
        manifest.json
      latest -> <version>
```

- **version**: Semantic (e.g. `v1.0.0`) or date/run (e.g. `20260301-finetune`). No spaces.
- **manifest.json**: Required in each version dir. See Manifest schema below.
- **latest**: Optional symlink; deploy step or `SURYA_MODEL_PATH` can point at a version dir or at `artifacts/models/surya/latest`.

## Manifest schema

Each version directory must contain `manifest.json`:

```json
{
  "checksum": "sha256:abc123...",
  "checksumAlgorithm": "sha256",
  "created_at": "2026-03-01T12:00:00Z",
  "source_job_id": "turing-abc-123",
  "model_type": "surya",
  "comment": "optional"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| checksum | Yes | SHA-256 of the primary checkpoint file (hex or `sha256:hex`). |
| checksumAlgorithm | No | Default `sha256`. |
| created_at | Yes | ISO 8601 UTC. |
| source_job_id | No | Turing or HF Job id if from offload training. |
| model_type | No | `surya` or `nowcast`. |
| comment | No | Free text. |
| primary_file | No | Filename of the checkpoint to verify (default `checkpoint.pt`). |

The checksum in the manifest MUST refer to the primary checkpoint file in that directory (e.g. `checkpoint.pt`). Config files may be listed in an optional `files` array with their own checksums for future use.

## Checksum-verify-before-deploy

Before loading a checkpoint for inference or setting it as the active model:

1. Read `manifest.json` from the version directory.
2. Resolve the primary checkpoint file (e.g. `checkpoint.pt` or the first file listed in manifest).
3. Compute SHA-256 of that file.
4. Compare with `manifest.checksum` (strip `sha256:` prefix if present). If mismatch, **reject load** (SEU and supply-chain integrity). Do not pass unverified data to the model.
5. Optionally verify config/scalers files if their checksums are in the manifest.

A small script is provided: `scripts/artifact_verify.py <artifact_version_dir>`. It reads `manifest.json`, hashes the primary checkpoint file, and exits 0 only if it matches. Backend or MCP `deploy_checkpoint` must perform this verification before updating `SURYA_MODEL_PATH` or a registry.

## Access control

- Only the operator or an automated pipeline (with auth) should write to the artifact store or call deploy.
- Backend endpoints that update the "active" model version (if added) must be RBAC-protected.
- MCP `deploy_checkpoint` must use the same auth or be restricted to local/safe invoker (127.0.0.1 or Tailscale).

## Audit log

Log deploy and training-job submissions for review:

- **Where**: `reports/audit/model-deploy.log` or `reports/audit/model-deploy.jsonl` (append-only).
- **Fields**: who (user or service id), when (ISO 8601), action (`deploy` | `training_submit`), version or job_id, path or payload summary.
- **Example line (JSONL)**: `{"at":"2026-03-01T12:00:00Z","action":"deploy","model":"surya","version":"v1.0.0","path":"artifacts/models/surya/v1.0.0"}`

Store in existing audit mechanism if the project has one; otherwise use the file under `reports/` as above.

## References

- [SURYA_FINETUNING_OFFLOAD.md](SURYA_FINETUNING_OFFLOAD.md) – Training offload and checkpoint placement.
- [SURYA_INTEGRATION.md](SURYA_INTEGRATION.md) – API contract and `SURYA_MODEL_PATH`.
- Project directive: RAG and artifact data must be checksum-verified before use (SEU resilience).
