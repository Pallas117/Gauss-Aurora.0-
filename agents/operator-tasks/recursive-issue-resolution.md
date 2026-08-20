---
task_id: recursive-issue-resolution
name: Recursive Issue Resolution
domain: repository-management
stage: execute
primary_role: recursive-solver
skill: gauss-recursive-solver
approval: required
---

## Purpose

Tackle complex repository issues that span multiple domains or are too large for a single-pass resolution by recursively decomposing them into atomic, manageable sub-tasks.

## Inputs

- `issue_description`: A detailed description of the problem to solve.
- `repository_context`: Relevant files, docs, and current state.
- `recursion_depth`: Current depth of recursion (default 0).

## Procedure

1. **Orientation**: Run `npm run develop:status` and read `development/memory/CURRENT.md`.
2. **Analysis**: Evaluate if the issue can be solved in a single pass.
3. **Decomposition**:
   - If too complex, use `decomposition-planner` to create a list of sub-tasks.
   - For each sub-task, assign a role and a skill.
   - If a sub-task is still complex, assign it back to `recursive-solver` with incremented `recursion_depth`.
4. **Execution**:
   - Generate `operator-task` packets for each sub-task.
   - Track progress of each sub-task.
5. **Synthesis**:
   - Collect results from all sub-tasks.
   - Use `synthesis-aggregator` to merge changes and resolve conflicts.
6. **Verification**:
   - Run domain-specific tests for each sub-task.
   - Run system-wide verification (e.g., `npm run develop:verify`).

## Outputs

- `resolution_summary`: Description of how the issue was solved.
- `sub_task_log`: Record of all sub-tasks and their outcomes.
- `files_changed`: List of all modified files.
- `memory_update`: Proposed updates for `development/memory/`.

## Guardrails

- Max recursion depth: 5.
- Do not cross boundary limits without explicit operator approval.
- Ensure all sub-tasks are within the 8 GB Apple Silicon resource budget.

## Verification

- `npm run develop:verify`
- `npm run develop:interoperability`
- Final system-wide audit.
