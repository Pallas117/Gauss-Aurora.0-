# Offline presentation demo runbook

This runbook is deliberately local-only. It uses repository fixtures and the
deterministic tensor fallback; it does not require cloud/model credits or live
Tailscale access.

## Preflight

```bash
npm run lint
npm run build
npm run develop:verify
npm run test:orchestrator
```

## Demonstrate the analytics contract

```bash
node --import tsx --test backend/ml-client/fused-features.test.ts backend/ml-client/fused-model.test.ts
cd gauss-orchestrator
cargo test telemetry::fused_tensor
cd ..
```

The expected evidence is:

- schema `gauss-analytics-tensor-v1`;
- physics tensor shape `24 × 18`;
- fixed MMS, solar, exogenous, reliability, and doctrine lanes;
- explicit masks for unavailable lanes;
- deterministic fallback when no model runner is configured;
- learned weight forced to zero when reliability or disagreement gates fail.

## Demonstrate the UI

Use the existing offline stack:

```bash
npm run dev:offline
```

Open the local HUD and show the loading/degraded states, deterministic
heliophysics path, source freshness, and operator evidence panels. Do not use a
production `.env` or expose a live backend during a presentation.

## Do not present as complete

- real model training or accuracy lift;
- live compute-sharing readiness;
- production Kali backend deployment;
- post-quantum authentication implementation beyond its configured gateway
  boundary;
- spacecraft command authority.
