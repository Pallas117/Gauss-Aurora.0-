# Gauss Development Memory

This directory is the curated memory layer for Project Gauss. It stores facts and decisions that should survive new chats, worktrees, and agent handoffs.

Generated reports under `reports/` can cite this memory, but they must not replace it. If a fact should be trusted later, update one of these files directly.

Operator procedures live separately in `agents/operator-tasks/`. Keep this memory layer for durable architecture, decisions, risks, and ownership; keep task-specific observations in the structured packet and handoff artifacts.

## File Contract

| File | Purpose | Update when |
| --- | --- | --- |
| `CURRENT.md` | Stable current-state map for starting work. | Architecture, entry points, service boundaries, or runtime constraints change. |
| `DECISIONS.md` | Durable decision log with rationale and status. | A choice should bind future contributors or explain why a path was taken. |
| `BACKLOG.md` | Evidence-backed improvement candidates. | A review finds a risk, the priority changes, or an item is completed. |

## Update Rules

- Prefer short, dated entries over long narrative.
- Mark stale facts instead of deleting useful history.
- Keep generated evidence paths in reports, but keep durable conclusions here.
- Every backlog item needs evidence and an owner role.
- Every decision needs rationale, status, and the date it was made.

## Operating Loop

1. Read `CURRENT.md` before changing code.
2. Check `BACKLOG.md` for known risks in the touched area.
3. For satellite-operator work, select a brief from `agents/operator-tasks/` and run `npm run develop:tasks` before exchanging a packet.
4. Add or update `DECISIONS.md` when the work creates a durable rule.
5. Run `npm run develop:brief` after a meaningful change to refresh the generated handoff capsule.
6. Enforce the zero-new-debt rule with `npm run debt:check`; leave only owned, evidenced, bounded low-priority backlog debt before handoff.
