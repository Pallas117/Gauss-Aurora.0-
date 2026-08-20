# Git object and shared-workspace audit — 2026-08-19

Purpose: preserve objective evidence while multiple workers modify the Gauss Aurora checkout. This is an inventory, not a claim that any object or change is malicious.

## Observed

- Repository: `Gauss Aurora`
- HEAD observed: `81d489c2fbca21b325388975f58c88da57b2dfda`
- `git count-objects -v`: 6,215 loose objects; 28,112 KiB loose-object size; 175 packed objects; 2 packs; 1,832,783 KiB packed size; 0 garbage objects.
- `git fsck --full --no-progress` was started as a read-only audit but produced no findings before the bounded run was interrupted.
- `git diff --check` cannot currently complete because Git reports a missing object: `68b721cef49ecee8b984f9f99dca41d14f461c32`.
- The working tree contains many concurrent modifications and deletions outside the GAU-20 scope. No reset, reindex, restore, cleanup, commit, or push was performed.

## Current GAU-20 additions

- `services/yamcs-replay/fixtures/gauss-seven-zone-replay.json`
- `services/yamcs-replay/fixtures/gauss-mhd-packets-sequence-gap.jsonl`
- `services/yamcs-replay/fixtures/radiation-stale-conflicting.jsonl`
- `services/yamcs-replay/fixtures/cfs-sil-rejections.jsonl`
- `backend/analysis/seven-zone-replay.test.ts`
- `gauss-orchestrator/tests/replay_fixture_manifest.rs`

## Verification evidence

- `npm run build`: passed.
- `npm run lint`: passed.
- `npm run develop:interoperability`: passed, 9 roles / 29 lanes.
- Focused Node replay tests: 6/6 passed.
- Focused Rust CCSDS/XTCE/replay tests: 8/8 passed.
- `npm run debt:check`: blocked by Git diff/object integrity failure.

## Unknown / blocked

- Ownership and provenance of the unrelated working-tree changes are unknown.
- Full Git object reachability remains unverified because `git fsck` exceeded the bounded audit window.
- Repairing the missing object, rebuilding the index, or restoring deleted files requires a separately approved recovery action.

## Recovery attempt — 2026-08-19

- The originally reported object `68b721cef49ecee8b984f9f99dca41d14f461c32` was readable as a 17,222-byte blob during recovery probing. Its content was not printed or copied into this log.
- A corrupt Codex turn-diff ref was identified at `refs/codex/turn-diffs/captures/1787116586168/770ba85a-07d1-4369-9041-c0fe0127dfe3/base`. It was moved reversibly to `.git/recovery-backups/20260819/turn-diff-base.ref` outside the refs namespace.
- The original index was moved to `.git/recovery-backups/20260819/index.before-recovery` during the repair attempt and then restored after rebuilding from `HEAD` failed because additional `HEAD` tree objects were missing.
- A zero-byte stale `.git/index.lock` was moved to `.git/recovery-backups/20260819/index.lock.stale`.
- Read-only remote ref inspection found `origin/main` at `4d35b4ce9e9e6079bc8dbd8fb5aba3b093c8c8e7`; it does not contain the current `HEAD` commit.
- `git fetch --no-tags origin main` failed with `mmap failed: Operation timed out` and did not receive all necessary objects. No checkout, reset, branch update, commit, or push occurred.

## Recovery state

- Working-tree files were preserved.
- Corrupt Codex metadata ref is quarantined outside `refs/`.
- Original index is restored.
- Git object recovery remains incomplete because the current `HEAD` graph has missing tree objects and the configured remote does not contain that graph.

## GitHub recovery source check — 2026-08-19

- GitHub repository identity verified through the connected app: `Pallas117/Gauss-Aurora.0-`, default branch `main`.
- GitHub confirms the local `HEAD` SHA is not present in that repository.
- GitHub refs available: `main`, `2026-02-10-2ybo`, and `v0.1.0`.
- Normal fetch failed with `mmap failed: Operation timed out` and incomplete object transfer.
- Blob-filtered fetch also failed: `rev-list died of signal 10` and the remote did not send all necessary objects.
- No remote ref was moved and no local working-tree file was replaced.

## Local worktree source check — 2026-08-19

- `git worktree list --porcelain` shows the primary checkout on `81d489c2…` and many detached worktrees on the healthy baseline `f35ca320…`.
- The detached baseline worktree at `/Users/josh/.codex/worktrees/09e0/Gauss Aurora` has a readable Git graph and passes bounded connectivity-only `git fsck`; its dangling blobs/trees are unreferenced objects, not evidence of tracking or tampering.
- The baseline worktree does not contain the GAU-20 replay fixtures, reconstructed interoperability checker, or heliophysics files introduced on the current branch.
- No local worktree contained those target paths as an alternate recovery copy. No files were copied or replaced.

## Recovery conclusion

- Observed: the current branch is 12 commits ahead of `origin/main`, but its `HEAD` tree is not fully readable; the remote and healthy baseline worktrees do not contain the current branch graph.
- Inferred: the current branch’s missing objects are local/shared-workspace corruption or incomplete object transfer, not recoverable from the configured GitHub refs or the inspected detached worktrees.
- Unknown: whether another unregistered local clone or worker still retains the missing tree objects.
- Blocked: complete Git recovery and `npm run debt:check` until a healthy copy of the current branch/object graph is provided or the remote branch is published by an authorized collaborator.

## GitHub source re-check — 2026-08-19

- The connected GitHub repository currently exposes only `main` and `2026-02-10-2ybo` branches.
- Recent visible commits are on the `main` history, including demo-mode changes at `4d35b4ce…`; no visible commit matches the local `81d489c2…`, `e214515…`, GAU-20 replay fixture names, interoperability checker, or MAVEN mission-theater changes.
- GitHub search returned no repository code matches for `gauss-seven-zone-replay`, `interoperability-check`, or `MAVEN mission theater`.
- GitHub exposes one historical merged pull request (`#1`, CI tests); no recovery PR or branch is available.
- No GitHub write operation was performed.

## Push failure diagnosis — 2026-08-19

- Reported push failure: `pack-objects died of signal 10`, followed by remote disconnect and `failed to push some refs`.
- The failure occurred while creating the local pack; it is not evidence that GitHub accepted or rejected the branch ref.
- `origin` is configured as a partial clone with `blob:none`; missing tree objects trigger lazy fetches during Git traversal.
- Current network resolution cannot reach `github.com`, and `GIT_NO_LAZY_FETCH=1 git status` confirms `HEAD` cannot be read because tree `d25db467…` is unavailable locally.
- The invalid metadata file `.git/refs/.DS_Store` was moved reversibly to `.git/recovery-backups/20260819/refs.DS_Store.invalid`; ref enumeration then completed normally.
- Pack verification found the existing pack healthy, but this does not repair the unavailable lazy-fetched tree.
- No push retry, ref update, commit, reset, or destructive cleanup was performed.
- A read-only scan of all known local Git pack indexes found no packed copy of missing object prefixes `d25db467…`, `1976e380…`, `99f4fd0c…`, or `df0b516e…`.

## Fresh-clone recovery check — 2026-08-19

- Network access was verified with `git ls-remote`; GitHub returned `main` and `2026-02-10-2ybo`.
- A separate full clone was created at `/private/tmp/gauss-aurora-recovery-20260819`; it is non-shallow, clean, and passes connectivity-only object verification.
- The fresh clone contains only the remote history. The local branch commits `81d489c2…` and `e214515…` are not present remotely.
- Exporting the current local branch into the fresh clone is still blocked because diff traversal cannot read missing tree `99f4fd0c…`.
- No source files, refs, commits, or remote branches were changed.

## Reconstructed recovery checkout — 2026-08-19

- The isolated checkout at `/private/tmp/gauss-aurora-recovery-20260819` was populated only with `backend/analysis`, `gauss-orchestrator`, and `services/yamcs-replay` from the preserved working tree.
- Focused Node replay/assessment tests passed: 6/6.
- Focused Rust CCSDS, replay-manifest, and XTCE mapping tests passed: 8/8.
- `npm run lint` passed in the reconstructed checkout.
- `npm run build` is blocked by the checkout's missing declared dev dependency `lovable-tagger`; no dependency installation or package-file change was performed.
- The reconstructed scope is currently untracked in the temporary checkout; no commit or push was made, consistent with the recovery hold.

## Push recovery state

- Observed: local object traversal is incomplete and network-assisted lazy fetch is unavailable; the push-side `pack-objects` process crashes with signal 10.
- Inferred: retrying the same broad push is unsafe and unlikely to succeed until the missing tree is restored or the checkout is rebuilt from a complete clone.
- Unknown: whether signal 10 was caused by concurrent object-store churn, OS memory pressure, or a Git/mmap fault.
- Blocked: publishing this branch until a complete object graph and stable network path are available.

## Local object-store probe — 2026-08-19

- A bounded filename probe across `/Users/josh/Documents` and `/Users/josh/.codex` found no loose-object files for the missing tree/object prefixes `1976e380…`, `99f4fd0c…`, or `df0b516e…`.
- No additional local source was identified. Recovery remains blocked on an unregistered clone, an active worker’s preserved object store, or an authorized remote publication of the current branch.
