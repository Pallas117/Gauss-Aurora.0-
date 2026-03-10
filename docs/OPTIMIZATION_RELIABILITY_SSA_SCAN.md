# Optimization, Reliability, and SSA Integration Scan

This scan maps what should be scaffolded, consolidated, and integrated next to improve:

- runtime efficiency on the 8 GB M1 host,
- backend and UI reliability,
- and coherent layering of space debris and satellite data into the heliophysics and space-domain stack.

It builds on:

- `docs/FUSED_HELIOPHYSICS_MODEL_GRAPH.md`
- `docs/DEBRIS_RISK_3D.md`
- `docs/SSA_FUSION_ORCHESTRATOR.md`

## Executive Summary

The codebase already has strong local building blocks:

- deterministic MHD nowcast,
- MMS vector fusion,
- source power policy,
- risk-zone and satellite snapshot ingestion,
- and aggregate mission/dashboard endpoints.

The main gap is not missing components. It is fragmented integration.

The highest-value work is:

1. Consolidate duplicated frontend state and polling paths.
2. Replace synthetic SSA threat inputs with real space-domain features.
3. Unify debris, satellites, and conjunctions into one backend space-domain snapshot.
4. Feed that unified SSA context into threat fusion, mission aggregates, and the fused model.
5. Reduce GPU / polling overhead by routing all dashboards through one canonical aggregate per view.

## Highest-Priority Findings

### 1. Source-health persistence is inconsistent

Problem:

- runtime writes go to `source_health`
- hydration reads from `source_health_snapshots`

Evidence:

- `backend/worker/ingest-loop.ts` writes `source_health`
- `backend/source-health-store.ts` reads `source_health`
- `backend/mission-logic.ts` hydrates from `source_health_snapshots`

Impact:

- mission aggregates can hydrate from a table that is never written,
- stale or empty source health can surface even while ingest is persisting live rows,
- reliability overlays can drift from the true ingest state.

Recommendation:

- consolidate on `source_health`
- delete or explicitly reintroduce snapshot-table semantics
- add one regression test proving cold-start hydration reads the same table ingest writes

### 2. Threat fusion uses synthetic orbital / debris context instead of real SSA

Problem:

- the current threat gate synthesizes orbital state, space-track objects, and debris objects from heliophysics values
- real risk zones only get mapped into a coarse debris override
- satellite objects and conjunction events are not part of the threat context

Evidence:

- `backend/ml-client/probability-gate.ts`
- `riskZonesToDebrisData()` converts bins into fake cartesian objects
- `buildThreatContext()` constructs synthetic `space_track` and default debris objects

Impact:

- debris and collision scoring can look plausible while remaining disconnected from actual space-domain truth
- top-level threat outputs are weaker than the repo’s available SSA inputs
- the future fused model would learn from placeholder geometry instead of real conjunction pressure

Recommendation:

- scaffold a real `ssa-threat-context` builder
- derive threat features from:
  - real risk zones
  - propagated satellite objects
  - conjunction ingest events
  - object freshness / uncertainty

### 3. Debris and satellite snapshots are parallel state, not first-class mission context

Problem:

- `riskZones` and `satelliteObjects` live in global state as separate snapshots
- mission aggregates do not include them
- threat summary only sees risk zones
- satellite objects never reach mission-core or dashboard latest

Evidence:

- `backend/state.ts`
- `backend/routes/ssa.ts`
- `backend/mission-logic.ts`
- `backend/routes/feed.ts`

Impact:

- frontend must poll multiple endpoints with different clocks
- mission views can show heliophysics truth from one instant and space-domain truth from another
- satellite data is disconnected from operator action logic

Recommendation:

- scaffold one `SpaceDomainSnapshot`
- include:
  - risk zones
  - satellite objects
  - conjunction events
  - freshness and provenance
  - summary features for operator and model use

### 4. Conjunction ingest is retained only in memory

Problem:

- conjunction interoperability routes keep events in a process-local array

Evidence:

- `backend/routes/conjunction-interop.ts`

Impact:

- events vanish on restart
- no historical accumulation
- no consistent integration with threat fusion, operator snapshot, or UI

Recommendation:

- scaffold a persisted conjunction store
- persist normalized records and latest summary to Supabase or another backend store
- add a lightweight in-memory cache on top, not instead

### 5. Frontend SDA state is duplicated

Problem:

- `useSDAState.ts` and `SDAPage.tsx` duplicate the same fetch, scene, layer, and power logic almost line-for-line

Evidence:

- `src/hooks/useSDAState.ts`
- `src/pages/SDAPage.tsx`

Impact:

- changes will drift
- bug fixes must be repeated
- performance and reliability behavior can diverge between two intended representations of the same state

Recommendation:

- delete one of the two ownership paths
- keep the hook as the single source of truth
- make the page a pure renderer of hook output

### 6. Risk-zone and satellite hooks reimplement polling/cache logic that already exists generically

Problem:

- `useRiskZones.ts` and `useSatelliteObjects.ts` each reimplement:
  - fetch loop
  - visibility handling
  - offline cache fallback
  - adaptive polling

Evidence:

- `src/hooks/useRiskZones.ts`
- `src/hooks/useSatelliteObjects.ts`
- existing generic hook `src/hooks/useRealtimeFeed.ts`

Impact:

- duplicated bug surface
- inconsistent fallback semantics
- harder optimization work

Recommendation:

- scaffold `useCachedRealtimeFeed`
- move polling / cache / offline fallback into one generic primitive
- rebuild both hooks on top of it

### 7. Rendering path is heavier than the repo’s stated device constraints

Problem:

- main scene path still depends on `@react-three/fiber`, `@react-three/drei`, and `three`

Evidence:

- `src/components/scene/SpaceScene.tsx`

Impact:

- GPU and memory pressure on the 8 GB M1
- reliability depends on low-power fallback rather than default low-cost rendering
- this conflicts with the project’s own lean-rendering directive

Recommendation:

- keep current scene only where necessary
- scaffold a scene adapter that supports:
  - `webgl`
  - `lite-svg`
  - `static-hud`
- default SDA and heliophysics to SVG / 2D overlays when power or viewport is constrained

## Consolidation Map

## Backend consolidation

### A. Space-domain store

Scaffold:

- `backend/ssa/space-domain-store.ts`

Responsibilities:

- hold latest:
  - risk zones
  - satellite objects
  - conjunction records
  - freshness / provenance metadata
- expose selectors for:
  - threat fusion
  - mission aggregates
  - SSA routes

Why:

- replaces fragmented `riskZoneSnapshot`, `satelliteObjectsSnapshot`, and in-memory conjunction arrays

### B. SSA feature derivation

Scaffold:

- `backend/ssa/ssa-features.ts`

Responsibilities:

- turn raw SSA inputs into compact operator/model features

Suggested outputs:

- `minMissDistanceM`
- `maxCollisionProbability`
- `conjunctionCount24h`
- `trackedObjectCountByOrbit`
- `highValueNeighborCount`
- `unidentifiedRatio`
- `tleFreshnessScore`
- `riskZoneDensityByShell`

### C. Threat context builder

Scaffold:

- `backend/ml-client/ssa-threat-context.ts`

Responsibilities:

- replace synthetic `buildThreatContext()`
- produce real `ExternalDataBundle` from:
  - SSA feature summaries
  - conjunction records
  - satellite object proximity
  - risk-zone density

### D. Fused model inputs

Scaffold:

- `backend/ml-client/fused-features.ts`
- `backend/ml-client/fused-model.ts`
- `backend/ml-client/fused-calibration.ts`

Add one new lane to the previous fused model graph:

- `SSA lane`

Suggested SSA tensor shape:

- `[12]`

Features:

1. conjunction count
2. maximum collision probability
3. minimum miss distance
4. debris density
5. high-value neighbor density
6. unidentified object ratio
7. GEO crowding score
8. MEO crowding score
9. LEO crowding score
10. TLE freshness score
11. conjunction freshness score
12. SSA availability / confidence score

### E. Aggregate endpoint consolidation

Current fragmentation:

- dashboard aggregate
- mission core aggregate
- ops command aggregate
- separate SSA endpoints

Recommendation:

- keep view-specific aggregates if necessary
- but add one shared backend builder for all aggregate slices

Scaffold:

- `backend/mission/aggregate-builder.ts`

Responsibilities:

- assemble canonical, MMS, aurora, source health, threat summary, and space-domain snapshot once
- let each route select fields from the same assembly

## Frontend consolidation

### A. SDA state ownership

Consolidate:

- `src/hooks/useSDAState.ts`
- `src/pages/SDAPage.tsx`

Target:

- hook owns all data and derived state
- page renders only

### B. Cached realtime primitive

Scaffold:

- `src/hooks/useCachedRealtimeFeed.ts`

Responsibilities:

- wrap:
  - `useRealtimeFeed`
  - offline cache
  - visibility pause
  - adaptive polling

Consumers:

- `useRiskZones`
- `useSatelliteObjects`
- optionally `useMissionCoreSnapshot` and `useOpsCommandSnapshot`

### C. Space-domain UI contract

Scaffold:

- `src/lib/api/space-domain.ts`
- `src/hooks/useSpaceDomainSnapshot.ts`

Contract should return:

- latest `riskZones`
- latest `satelliteObjects`
- latest `conjunctionSummary`
- freshness
- source provenance
- summary metrics for cards and scene overlays

### D. Scene adapter

Scaffold:

- `src/components/scene/SpaceSceneAdapter.tsx`

Modes:

- `webgl`
- `lite-svg`
- `static-summary`

Use:

- SVG by default on constrained devices
- WebGL only when explicitly allowed by power and viewport conditions

## What To Scaffold Next

Priority order:

1. `backend/ssa/space-domain-store.ts`
2. `backend/ssa/ssa-features.ts`
3. `backend/ml-client/ssa-threat-context.ts`
4. `backend/mission/aggregate-builder.ts`
5. `src/hooks/useCachedRealtimeFeed.ts`
6. `src/hooks/useSpaceDomainSnapshot.ts`
7. `src/components/scene/SpaceSceneAdapter.tsx`
8. `backend/ml-client/fused-features.ts`
9. `backend/ml-client/fused-model.ts`
10. `backend/ml-client/fused-calibration.ts`

## How To Layer In Space Debris and Satellite Data

Use this pipeline:

```text
Raw SSA inputs
  -> normalize
  -> persist
  -> aggregate snapshot
  -> derive compact SSA features
  -> feed threat fusion + mission snapshot + fused model
  -> render operator views
```

### Layer 1: Raw inputs

Sources:

- open TLE catalog
- propagated satellite objects
- conjunction ingest (`CDM` / `OMM` / `OEM` / `OCM`)
- optional Privateer

### Layer 2: Normalized persistent state

Persist:

- normalized satellite objects
- normalized risk-zone bins
- normalized conjunction events

Add:

- object timestamp
- source
- freshness
- quality / uncertainty

### Layer 3: Space-domain snapshot

One snapshot per refresh window:

- `updatedAt`
- `sourceStatus`
- `riskZones`
- `satelliteObjects`
- `conjunctionsLatest`
- `summary`

### Layer 4: Model features

Feed into:

- threat fusion
- fused heliophysics model

Do not pass raw full catalogs into React or hot model paths.
Always collapse to compact features first.

### Layer 5: Mission and dashboard aggregates

Expose:

- `spaceDomainSummary` on dashboard latest
- `spaceDomain` block on mission core snapshot

This removes separate frontend clock drift and reduces extra polling.

### Layer 6: UI surfaces

Use different projections for different operator needs:

- Heliophysics dashboard:
  - only summary risk overlays and top conjunction pressure
- SDA page:
  - top high-value and unidentified objects
  - top conjunctions
  - shell crowding summaries
- command / operator pages:
  - action-oriented cards
  - freshness and trust metadata

## Specific SSA Modeling Recommendations

### Replace the current debris lane

Current state:

- risk zones become fake point objects
- debris threat uses coarse density and synthetic nearest distance

Replace with:

- conjunction-derived nearest miss distance
- collision probability if present
- shell density by orbit regime
- high-value object proximity score
- unidentified ratio
- freshness penalty

### Treat satellite objects as context, not just lists

Current state:

- UI renders high-value and unidentified lists
- scene does not use object summaries
- threat fusion does not use them

Next step:

- derive `highValueCrowdingScore`
- derive `unknownObjectPressure`
- derive `neighborApproachScore`

### Conjunction ingest should become the high-confidence SSA lane

Why:

- conjunction products are more operationally meaningful than coarse TLE bins
- TLE bins are useful context, but conjunction records are the best trigger for real SSA action

Policy:

- conjunction lane outranks raw TLE density
- TLE density remains the background shell-crowding prior

## Reliability Tests To Add

1. Cold-start source health hydration reads the same table ingest writes.
2. Space-domain snapshot returns consistent timestamps for risk, satellites, and conjunction summary.
3. Threat fusion changes when conjunction records are present.
4. Dashboard aggregate includes space-domain summary with stable contract.
5. `useCachedRealtimeFeed` preserves offline fallback semantics for SSA hooks.
6. Low-power mode automatically chooses the non-WebGL scene adapter.

## Concrete Immediate Wins

If only a few things are done next, do these:

1. Fix `source_health` vs `source_health_snapshots`.
2. Replace synthetic SSA threat inputs with a real `ssa-threat-context`.
3. Unify risk zones, satellites, and conjunctions into one backend `SpaceDomainSnapshot`.
4. Refactor SDA page to use `useSDAState` only.
5. Move `useRiskZones` and `useSatelliteObjects` onto a shared cached realtime hook.

## Bottom Line

The repo does not need an entirely new stack.

It needs a consolidation pass:

- one canonical space-domain snapshot,
- one real SSA threat-context builder,
- one aggregate builder,
- one cached realtime frontend primitive,
- and one scene adapter that respects constrained hardware by default.

After that, layering debris and satellite data into the fused model becomes straightforward and physically meaningful instead of heuristic and parallel.
