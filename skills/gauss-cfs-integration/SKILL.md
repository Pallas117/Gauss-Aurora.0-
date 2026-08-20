---
name: gauss-cfs-integration
description: Designs and verifies bounded low-level cFS integrations, including target-specific assembly optimization, deterministic C interfaces, code-size budgets, and reproducible SIL/HIL evidence.
---

# Gauss cFS integration and low-level optimization

Use this skill when a task crosses a cFS application boundary, requires
assembly-level optimization, or proposes a compact machine-code artifact for
an onboard or cFS-shaped sandbox.

## Interoperability

- Use the `cfs-integration` role and its `cfs-observer`, `cfs-optimizer`,
  `cfs-verifier`, and `flight-reviewer` lanes.
- Preserve the existing cFS, CCSDS, XTCE, Yamcs, telemetry-quality, ECC, and
  approval contracts.
- Exchange bounded evidence through `agents/operator-task.schema.json` and
  `agents/handoff.schema.json`; distinguish `observed`, `inferred`, `unknown`,
  `blocked`, and `verified` results.
- Use the recursive solver for cross-boundary optimization: each child task
  owns one measurable budget and returns evidence to its parent; do not create
  an unbounded recursive patch loop.
- Treat x86-64/System V AMD64 as a host-SIL profile only. The flight target,
  ISA, ABI, compiler, linker, alignment, endianness, and memory model must be
  named before target assembly is proposed.

## Verification

1. Require a concrete function specification: inputs, outputs, side effects,
   bounds, aliasing, alignment, error behavior, safety class, target profile,
   cycle budget, and byte budget. A placeholder or plain-English request with
   no semantics is `blocked`, not an invitation to invent behavior.
2. Build a portable reference implementation and differential/property tests
   before hand-writing assembly. Include edge cases, malformed telemetry, NaN/
   overflow behavior where relevant, and bounded input lengths.
3. Verify ABI and machine code independently: stack alignment, callee-saved
   registers, return register, flags/FP state where applicable, relocations,
   PIC constraints, disassembly, instruction bytes, and executable-section
   permissions.
4. Compare the candidate against a named compiler baseline using reproducible
   flags. Record `.text` bytes, relocation count, binary hash, benchmark
   methodology, distribution (not only a best-case cycle count), and toolchain
   versions. Host cycle counts are not flight timing evidence.
5. Run cFS Software-in-the-Loop and the selected target build. Require HIL,
   watchdog, fault-injection, radiation/ECC, reset, and restart evidence before
   any flight-readiness claim.
6. Keep the artifact proposal-only until a named reviewer approves it. Store
   assembly source, hex bytes, disassembly, manifest, test vectors, toolchain,
   and rollback identity together. A detached signature is required before
   applying an artifact to a controlled build.

## Guardrails

- Never emit or apply machine code for an unspecified function.
- Never treat x86-64 output as portable cFS flight code; cFS commonly runs on
  non-x86 targets and the ABI is part of the safety boundary.
- Never use self-modifying code, runtime code generation, writable executable
  memory, hidden persistence, JIT loading, or online weight updates in flight.
- Do not hardcode absolute addresses. Reject unreviewed relocations, RWX
  sections, stack-pointer imbalance, clobbered callee-saved registers, or
  unbounded memory access.
- Preserve command inhibition and deterministic fallback. An optimization may
  reduce compute cost but may not change telemetry validity, ECC policy, or
  operator approval semantics.
- Assembly/hex output is not a substitute for review evidence. If a caller
  requests a raw-only response but the function specification or target profile
  is incomplete, return a blocked status in the engineering workflow.

## Required artifact

Every candidate must have a versioned manifest containing:

```text
candidate_id, source_hash, target_isa, abi, toolchain, compiler_flags,
function_contract, input_bounds, output_contract, code_size_bytes,
relocation_policy, stack/register contract, benchmark method, test-vector hash,
SIL result, HIL result, approval id, signature, rollback artifact
```

The continuous development and self-modification validators remain mandatory;
   the latter may validate a ground proposal but cannot apply it to the host,
   deploy it, or send a spacecraft command.

## Recursive memory-pressure contract

Memory pressure is the primary optimization objective. Code-size and cycle
improvements are subordinate to bounded, deterministic operation.

Decompose work in this order:

1. **Observe:** capture peak and steady-state RSS, static image, stack high
   watermarks, heap/pool occupancy, queue depth, DMA buffers, tensor buffers,
   cache, ECC overhead, swap/compression, and latency under nominal and fault
   load.
2. **Bound:** replace unbounded allocation, queues, retries, recursion, and
   retained telemetry with fixed pools, ring buffers, arenas, watermarks,
   expiry, and explicit backpressure.
3. **Remove duplication:** use ownership/lifetime analysis, zero-copy views,
   buffer reuse, streaming transforms, sparse representations, and one
   canonical telemetry window rather than multiple materialized copies.
4. **Reduce representation:** evaluate field widths, quantization, delta/RLE
   compression, fixed-point arithmetic, and compact model/tensor layouts with
   error and uncertainty budgets recorded.
5. **Optimize execution:** only after memory gates pass, compare compiler
   output, vectorization, instruction selection, and hand-written assembly.
6. **Verify and recurse:** rerun the same workload, compare peak memory,
   tail latency, CPU/power, correctness, and fault behavior. Recurse only into
   the largest remaining measured contributor.

Every child task must return `before`, `after`, `delta`, `workload_hash`,
`budget_status`, `rollback`, and `next_largest_contributor`. Stop when the
budget passes, evidence is noisy, gains are below the agreed threshold, or the
next change would weaken safety, provenance, fallback, or determinism. Flag
NP-hard allocation/scheduling problems as bounded heuristics with a recorded
optimality gap; never hide them behind an unbounded search.
