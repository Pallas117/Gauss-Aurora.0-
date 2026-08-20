# Memory, storage, and shared-compute optimization evidence

Reviewed: 2026-07-17 UTC

This is a curated research note for Project Gauss. The sources below are peer-reviewed conference papers or proceedings pages from NeurIPS, MLSys, USENIX OSDI, USENIX NSDI, or USENIX ATC. Reported gains are paper-reported results on the authors' workloads and hardware; they are not promises for Judith's 8 GB M1, Kali, or arbitrary Turing nodes. Every adoption must be shadow-tested against the repository's memory, latency, accuracy, and battery budgets.

## Evidence-to-action summary

| Evidence | Paper-reported result | Gauss action | Safety boundary |
| --- | --- | --- | --- |
| 4-bit weights plus double quantization and paged optimizer state | QLoRA fine-tuned a 65B model on one 48 GB GPU while preserving the reported 16-bit task performance | Keep local development on quantized base models; use adapters for objective-specific work; page or offload optimizer state only on approved batch nodes | Do not infer that a 4-bit model has the same operational quality; require holdout evaluation and a rollback artifact |
| Activation-aware weight-only quantization | AWQ reports more than 3x speedup over Hugging Face FP16 on desktop and mobile GPUs | Benchmark AWQ/GPTQ/MLX-compatible quantized artifacts as immutable model variants; prefer weight-only quantization when activations must remain higher precision | Quantization is model- and kernel-dependent; validate M1/Metal and Kali hardware separately |
| Low-bit weight-activation quantization | Atom reports up to 7.73x throughput over FP16 and 2.53x over INT8 at the same latency target | Use low-bit serving only where the target accelerator has a tested low-bit kernel; otherwise keep the FP16/BF16 fallback | Do not enable a GPU-specific format on heterogeneous Turing nodes without capability negotiation |
| Saliency-aware KV-cache compression | ZipCache reports 4.98x KV-cache compression with a 0.38% accuracy drop on one Mistral-7B GSM8K evaluation, plus lower latency and GPU memory in its LLaMA3-8B test | Add a bounded KV policy as an optional serving profile, with per-model quality gates and a hard context cap | The result is workload-specific; never replace the existing `GAUSS_MLX_MAX_KV_TOKENS` guardrail with an unbounded cache |
| 3-bit KV-cache quantization with outlier handling | KVQuant reports less than 0.1 perplexity degradation in its tests and million-token serving demonstrations on its hardware | Prioritize KV-cache quantization before increasing context length; use compact caches for long-lived shared workers | The paper uses CUDA kernels and large GPUs; it is a design target, not a Metal implementation claim |
| Heterogeneous block-sparse attention formats | FlashInfer reports 29–69% inter-token-latency reduction against compiler backends in its benchmark and supports heterogeneous KV-cache layouts | Prefer a serving runtime that can reuse block-aligned KV pages and avoid duplicate cache copies; expose a per-node runtime capability | Do not add a second attention engine to Judith without a measured RSS and battery comparison |
| Multi-tier checkpoint locality | ServerlessLLM reports 10–200x lower latency across its serverless workloads by using loading-optimized checkpoints, local near-GPU storage, and locality-aware scheduling | Store model artifacts once per approved node, keep an indexed immutable manifest, and schedule work to nodes that already hold the required artifact | Turing nodes must not receive private model/data artifacts unless residency and authorization allow it |
| Parallelism-agnostic checkpoint format | ByteCheckpoint reports 54.20x average reduction in checkpoint stalls and up to 9.96x/8.80x faster save/load in its large-scale training evaluation | Separate checkpoint representation from worker topology; write resumable, content-addressed artifacts and reshard at load time | Do not copy checkpoints on every lease; hash, deduplicate, expire, and verify before reuse |
| Hybrid local/remote far-memory data paths | Atlas reports 1.5x–3.2x throughput improvements and one-to-two-order tail-latency reductions over comparison systems in its remote-memory evaluation | Keep Turing work object-granular and bounded, co-locate hot normalized windows with the worker, and fall back to local paging/cache for locality-friendly workloads | Gauss's leased work exchange is not transparent shared memory; no remote pointer or unbounded page fault path is allowed |
| Workload-aware KV-cache eviction | KVCache Cache in the Wild reports skewed reuse patterns, moderate cache sizes for ideal hit ratios, and a workload-aware eviction policy on production traces | Measure reuse by workload class and tune cache TTL/capacity from observed hit rate, not a global “keep everything” policy | Cache keys and prompts require the existing data-residency and redaction controls |

## Highest-value changes for this repository

### 1. Quantized artifact lanes

Maintain a small, explicit model-artifact matrix rather than loading multiple model copies:

```text
model_id | format | compute_dtype | target_node_class | max_context | quality_gate | expiry
```

The base artifact should be immutable and content-addressed. Adapters, calibration data, and benchmark reports should be separate artifacts. Judith should default to the smallest approved local model and load only one model at a time, preserving the existing Apollo teardown sequence in `ml/gauss_engine.py`.

### 2. KV-cache budgets before context expansion

Treat the KV cache as a first-class resource. Record peak KV bytes, prompt tokens, completion tokens, cache hit rate, and quality delta for every serving profile. Keep the current `GAUSS_MLX_MAX_TOKENS`, `GAUSS_MLX_MAX_KV_TOKENS`, and `GAUSS_MLX_CACHE_LIMIT_GB` ceilings. A compressed-cache experiment must be shadow-only until its perplexity/task regression and memory delta are recorded.

### 3. Storage locality and deduplication

For model and checkpoint storage:

- use a content hash and an immutable manifest;
- keep one local copy per eligible node, not one copy per work item;
- schedule work to a node with the artifact already present;
- transfer only missing chunks over Tailscale;
- expire unused artifacts and caches under an explicit TTL;
- record bytes saved, load time, cache hit rate, and integrity verification outcome.

This fits the existing bounded Turing lease model without turning the network into an uncontrolled shared filesystem.

### 4. Compute sharing is capability- and evidence-gated

The existing `gauss-radiation-work-v1` exchange is the right control shape: the backend leases bounded normalized windows to enrolled Turing nodes, selects by memory/battery/link health, retries with limits, releases completed input, and awards credits from accepted samples. Keep that model for inference and batch work. A node is not “sharing compute” merely because it is on Tailscale; it must have:

1. a healthy Tailscale path;
2. a registered and approved Turing identity;
3. a reachable `/health` and `/compute/job` service;
4. `batch` or `compute` capability plus enough free RAM;
5. a running backend scheduler with queued/leased/completed evidence.

## Measurement protocol

For each optimization candidate, run the same bounded workload on the baseline and candidate:

1. capture RSS, unified-memory pressure, GPU/Metal memory where available, disk bytes, network bytes, latency, throughput, battery/power state, and output quality;
2. warm once, then measure at least five repeated runs with a fixed seed or fixed input window;
3. compare peak rather than average memory and p95/p99 latency rather than only mean latency;
4. verify that the candidate never increases retained queue, cache, or artifact count beyond the configured ceilings;
5. keep the candidate in shadow mode until the evidence is recorded in `reports/memory/` and the relevant quality test passes.

## Sources

- Dettmers et al., “QLoRA: Efficient Finetuning of Quantized LLMs,” NeurIPS 2023. [Proceedings](https://proceedings.neurips.cc/paper_files/paper/2023/hash/1feb87871436031bdc0f2beaa62a049b-Abstract-Conference.html)
- Lin et al., “AWQ: Activation-aware Weight Quantization for On-Device LLM Compression and Acceleration,” MLSys 2024. [Proceedings](https://proceedings.mlsys.org/paper_files/paper/2024/hash/42a452cbafa9dd64e9ba4aa95cc1ef21-Abstract-Conference.html)
- Zhao et al., “Atom: Low-Bit Quantization for Efficient and Accurate LLM Serving,” MLSys 2024. [Proceedings](https://proceedings.mlsys.org/paper_files/paper/2024/hash/5edb57c05c81d04beb716ef1d542fe9e-Abstract-Conference.html)
- He et al., “ZipCache: Accurate and Efficient KV Cache Quantization with Salient Token Identification,” NeurIPS 2024. [Proceedings](https://proceedings.neurips.cc/paper_files/paper/2024/hash/7e57131fdeb815764434b65162c88895-Abstract-Conference.html)
- Hooper et al., “KVQuant: Towards 10 Million Context Length LLM Inference with KV Cache Quantization,” NeurIPS 2024. [Proceedings](https://proceedings.neurips.cc/paper_files/paper/2024/hash/028fcbcf85435d39a40c4d61b42c99a4-Abstract-Conference.html)
- Ye et al., “FlashInfer: Efficient and Customizable Attention Engine for LLM Inference Serving,” MLSys 2025. [Proceedings](https://proceedings.mlsys.org/paper_files/paper/2025/hash/dbf02b21d77409a2db30e56866a8ab3a-Abstract-Conference.html)
- Fu et al., “ServerlessLLM: Low-Latency Serverless Inference for Large Language Models,” OSDI 2024. [USENIX proceedings](https://www.usenix.org/conference/osdi24/presentation/fu)
- [ByteCheckpoint: Parallelism-Agnostic Checkpointing for Large-Scale LFM Training](https://www.usenix.org/conference/nsdi25/technical-sessions), NSDI 2025 technical session and proceedings listing.
- Chen et al., “A Tale of Two Paths: Toward a Hybrid Data Plane for Efficient Far-Memory Applications,” OSDI 2024. [USENIX proceedings](https://www.usenix.org/conference/osdi24/presentation/chen-lei)
- Wang et al., “KVCache Cache in the Wild: Characterizing and Optimizing KVCache Cache at a Large Cloud Provider,” USENIX ATC 2025 technical session. [USENIX proceedings](https://www.usenix.org/conference/atc25/technical-sessions)

## Interpretation rule

These papers provide mechanisms and measured results, not a reason to raise Gauss's limits. The repository should adopt the smallest mechanism that produces a measured win under Judith/Kali/Turing constraints, keep the baseline available, and record unknowns when a paper's hardware or workload does not match ours.
