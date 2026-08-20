# Evidence-Backed Improvement Backlog

## Active Candidates

| ID | Priority | Owner | Evidence | Next action |
| --- | --- | --- | --- | --- |
| B-001 | P1 | platform-integration | The current system memory records that the production backend deployment remains blocked until the approved network-only environment bundle is provisioned on Talos. | Provision the approved mode-0600 environment through the operator deployment procedure, then independently verify service, endpoint, and residency evidence. |
| B-002 | P2 | memory-systems | The current system memory records that live Turing compute-sharing readiness is unknown without a reachable worker, resource report, approved registration, and completed bounded lease. | Collect fresh authenticated capability, resource, registration, and lease evidence before changing the readiness state. |
| B-003 | P2 | verification-keeper | The current system memory records open Rust formatting/Clippy and historical-secret-purge work from the security remediation pass. | Run the quality gate and complete the bounded secret-history review before release-quality handoff. |
| B-004 | P0 | verification-keeper | `npm run debt:check` cannot execute `git diff --check` because the partial-clone index references missing Git objects; the current HEAD is not present in GitHub and the mixed worktree has unrelated edits. | Obtain a healthy copy of the current branch/object graph or have an authorized collaborator publish that graph; then independently run `git fsck`, `git diff --check`, `npm run debt:check`, and verify the remote ref before commit/push. |
