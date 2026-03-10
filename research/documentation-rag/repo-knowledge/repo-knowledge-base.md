# Repo Knowledge Base

Generated at: 2026-03-06T17:41:50.760Z

## Purpose

This digest summarizes the trusted knowledge, datasets, model assets, and subsystem files that the local Gauss engine should consume before any fine-tuning claims are made.

## Trusted Foundational and Mission Documents

- research/documentation-rag/foundational-axioms/gauss-steward-identity.md
- research/documentation-rag/foundational-axioms/mathematical-rigor-and-invariants.md
- research/documentation-rag/foundational-axioms/physical-laws-and-field-reasoning.md
- research/documentation-rag/repo-knowledge/repo-knowledge-base.md
- research/documentation-rag/spacecraft-ops-probability/mission-ethics-and-voice.md
- research/documentation-rag/spacecraft-ops-probability/probability-models-and-gating.md
- research/documentation-rag/spacecraft-ops-probability/spacecraft-operations-procedures.md

## Connected Datasets and Telemetry Artifacts

- gauss-orchestrator/new_telemetry/final_test.csv
- gauss-orchestrator/new_telemetry/test_classified.csv
- gauss-orchestrator/new_telemetry/test_high.csv
- gauss-orchestrator/new_telemetry/test_low.csv
- gauss-orchestrator/new_telemetry/test_trigger.csv
- reports/network/connectivity-feed.jsonl
- reports/network/connectivity-latest.json
- research/data-rag/2506.12782v1.pdf
- research/data-rag/License_Agreement_SPARK2022.pdf
- research/data-rag/nasa_systems_engineering_handbook_0.pdf

## Model and Training Assets

- ml/models/registry.json
- ml/config/train.yaml
- ml/export/export_nowcast_onnx.py
- ml/gauss_dual_agent.py
- ml/gauss_engine.py
- ml/infer/infer_server.py
- ml/rag/__init__.py
- ml/rag/embed.py
- ml/rag/ingest.py
- ml/rag/README.md
- ml/rag/requirements.txt
- ml/rag/server.py

## Repo Subsystem Summary

- src: 294 files
- picoclaw: 237 files
- backend: 143 files
- research-documentation: 100 files
- gauss-orchestrator: 81 files
- docs: 64 files
- reports/fullstack: 33 files
- scripts: 30 files
- tests: 22 files
- reports/context: 21 files
- ml: 20 files
- reports/progress: 18 files

## Current Gaps

- ml/data/train_dataset.jsonl: Model registry points to a missing dataset.
- ml/data/train_dataset.holdout.jsonl: Holdout dataset is missing for training validation.

## Ingestion Order

1. Approved foundational and mission documents under research/documentation-rag.
2. Approved repo-knowledge digest and training-readiness reports.
3. Dataset and telemetry artifacts for feature extraction and supervised dataset building.
4. Model registry and validation assets for promotion, rollback, and shadow-mode checks.

The local engine should treat this digest as a map of trustworthy evidence, not as permission to train on everything indiscriminately.

