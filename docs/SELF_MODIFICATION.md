# Bounded self-modification

Gauss supports **proposal-only self-modification** for ground development. An
agent may produce a unified patch, but it cannot modify the active worktree,
runtime, spacecraft, credentials, deployment configuration, or safety policy.

## Boundary

```text
agent/model
    -> reports/self-modification/proposal.patch
    -> isolated container, no network, read-only source snapshot
    -> contract/path/size validation
    -> develop:verify + lint (+ optional full tests/build)
    -> human approval + signed artifact
    -> explicit host-side application and independent verification
```

The container applies the patch only to `/tmp/candidate`; it discards that
copy when it exits. The host worktree is never mounted. `runtime_apply` and
`spacecraft_apply` are permanently disabled in the policy contract.

## Use

1. Place a proposed unified diff at `reports/self-modification/proposal.patch`.
2. Run `npm run self-modification:check`.
3. Build the validator with `npm run self-modification:build`.
4. Run `npm run self-modification:validate` or the more expensive
   `npm run self-modification:validate:full`.
5. Review `reports/self-modification/validation.json`, the diff, affected
   paths, tests, rollback scope, and an explicit approval record.
6. Apply manually only after approval, then run the normal repository quality
   gates. The validator never applies a patch to the host worktree.

The first policy allow-list is intentionally narrow: application and model
source only. It excludes workflows, deployment/network scripts, configuration,
secrets, database migrations, container policy, and package manifests. Expand
it only through a separately reviewed policy change.

## Limitations

- This is not proof that an AI-generated change is correct or safe.
- A container is a development isolation boundary, not flight qualification,
  radiation assurance, or a spacecraft sandbox.
- Docker must be installed and independently trusted; on Judith it is currently
  an environment blocker.
- No online weight updates, self-modifying onboard binaries, autonomous deploys,
  or spacecraft commands are permitted.
