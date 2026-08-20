---
name: gauss-recursive-solver
description: Tackles complex repository issues by recursively decomposing them into sub-tasks and orchestrating a multi-agent resolution loop. Use when an issue spans multiple domains or is too large for a single agent to solve in one pass.
---

# Gauss Recursive Solver

This skill enables an agent to act as a recursive orchestrator. It uses the `decomposition-planner` to split issues, `recursive-delegate` to assign sub-tasks to specialized roles, and `synthesis-aggregator` to combine the final results.

## Interoperability

- **Contract**: Use `agents/operator-task.schema.json` for task packets.
- **Decomposition**: Every sub-task must be assigned an `id` that reflects its position in the task tree (e.g., `parent-id.sub-task-index`).
- **State**: Maintain a `RecursiveState` tracking all active sub-tasks, their owners, and their progress.

## Verification

1. **Structural Verification**: Use `npm run develop:verify` to ensure the task tree is well-formed.
2. **Sub-task Verification**: Each specialized role must run its own domain-specific verification.
3. **Integration Verification**: The `Recursive Solver` must run a full-system verification (e.g., `npm run audit:adherence`) after all sub-tasks are complete.
