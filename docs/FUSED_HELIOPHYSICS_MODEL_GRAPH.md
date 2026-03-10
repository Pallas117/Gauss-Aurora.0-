# Fused On-Device Heliophysics Model Graph

This document defines the recommended on-device model stack for Project Gauss when the goal is:

- accurate heliophysics nowcasting,
- physically credible MMS reconnection visualization,
- bounded execution on an 8 GB Apple M1,
- and conservative handling of speculative exogenous priors such as earth-core or planetary context.

It is designed to sit on top of the current deterministic backbone:

- `backend/physics/mhd-nowcast.ts`
- `backend/physics/mms-probability.ts`
- `backend/ml-client/client.ts`
- `backend/routes/ai.ts`

## Decision

Do not make Surya the single "inner core" of the system.

Use a layered causal stack:

1. Deterministic physics backbone for near-Earth state.
2. MMS local geometry lane for reconnection directionality and probability.
3. Surya solar-context lane for upstream solar priors.
4. Reliability and source-quality lane for trust weighting.
5. Optional exogenous priors lane with hard influence caps.
6. Final calibrated fusion head for operational outputs.

This keeps causal structure aligned with known heliophysics:

- solar wind and IMF drive magnetospheric coupling,
- local electric and magnetic geometry drive MMS reconnection interpretation,
- solar imagery/model outputs improve upstream solar context,
- exogenous signals can modulate confidence only after validation.

## Causal Graph

```text
NOAA / ESA / JAXA -----> Canonical MHD State ----------------------+
                                                                   |
MMS tetrahedron + burst -----> MMS Vector Fusion ------------------+----> Fused Latent State ---> Calibrated Heads
                                                                   |
Surya forecast / flare -----> Solar Prior Lane --------------------+
                                                                   |
Source health / quality ----> Reliability Lane --------------------+
                                                                   |
Earth-core / planetary -----> Exogenous Prior Lane (capped) -------+
                                                                   |
RAG method priors ---------> Doctrine Prior Lane (capped) ---------+
```

## Runtime Lanes

### 1. Physics Backbone

Always-on, deterministic, cheap, and trusted.

Primary source:

- `backend/physics/mhd-nowcast.ts`

Core causal variables:

- IMF `Bz`, `By`, `Bt`
- solar-wind speed and density
- convective electric field `E = -v x B`
- dynamic pressure
- Newell coupling
- Akasofu epsilon
- estimated / measured `Dst`, `Kp`
- Shue standoff distance
- Alfvén speed
- propagation delay from L1

This lane is the default truth backbone for the UI and for model input when all learned models are disabled.

### 2. MMS Geometry Lane

Always-on when MMS data exists; deterministic fusion with local prediction fallback.

Primary source:

- `backend/physics/mms-probability.ts`

Core causal variables:

- current density magnitude
- LMN basis and normal vector
- directionality correction relative to electric field
- tetrahedron quality
- burst mode
- sample coverage
- reconnection probability and confidence
- provenance: measured, predicted, fused

This lane should own MMS visual orientation and reconnection-risk interpretation.
Surya must not directly determine MMS normal direction.

### 3. Solar Prior Lane

Use Surya as an upstream solar prior, not as the whole fused state engine.

Inputs:

- Surya forecast summary
- flare probability
- optional active-region descriptors when available

Allowed influence:

- storm escalation prior
- aurora intensity prior
- radiation-belt activity prior

Disallowed direct influence:

- direct MMS normal orientation
- direct tetrahedron quality inference

### 4. Reliability Lane

This lane gates trust, not physical causality.

Inputs:

- source health
- staleness
- interpolation / extrapolation flags
- low-confidence flags
- observed runtime cost
- power mode

Output:

- trust weights for each lane
- UI confidence / degraded-mode indicators

### 5. Exogenous Prior Lane

Use only as a slow prior.

Inputs already represented in the current request schema:

- `earthCore.geomagneticJerkIndex`
- `earthCore.schumannResonancePower`
- `earthCore.coreRotationAnomaly`
- `solarSystem.heliosphereCompression`
- `solarSystem.cosmicRayFlux`
- `solarSystem.planetaryAlignmentIndex`
- `solarSystem.lunarTidalIndex`

Policy:

- disabled by default for action-critical decisions until ablation proves lift,
- low cadence only,
- influence capped to small residual modulation,
- never allowed to overturn strong physics evidence on its own.

### 6. Doctrine Prior Lane

RAG-derived priors from operator documents or validated method cards.

Use:

- only for policy / interpretation bias,
- not as substitute for measured telemetry.

## Exact Feature Graph

### Physics Tensor

Window:

- last 24 samples at 5 s cadence = 120 s context

Shape:

- `[24, 18]`

Features:

1. solar-wind speed
2. solar-wind density
3. IMF `Bz`
4. IMF `By`
5. IMF `Bt`
6. electric field `Ey`
7. dynamic pressure
8. Newell coupling
9. Akasofu epsilon
10. `Kp`
11. `Dst`
12. `Dst` slope
13. Shue `R0`
14. Alfvén speed
15. `sin(clock_angle)`
16. `cos(clock_angle)`
17. L1 delay seconds
18. storm tier ordinal

### MMS Tensor

Window:

- latest fused point plus previous point delta

Shape:

- `[20]`

Features:

1. current density magnitude
2. normal `x`
3. normal `y`
4. normal `z`
5. direction alignment
6. tetrahedron volume
7. tetrahedron condition number
8. div-curl ratio
9. quality confidence score
10. reconnection probability
11. reconnection confidence
12. lower CI
13. upper CI
14. sample-count normalized
15. burst-mode flag
16. freshness seconds normalized
17. provenance measured flag
18. provenance fused flag
19. direction corrected flag
20. previous-current delta magnitude

### Solar Prior Tensor

Window:

- latest Surya response summarized over forecast horizon

Shape:

- `[8]`

Features:

1. forecast mean
2. forecast max
3. forecast slope
4. forecast standard deviation
5. flare probability 24 h
6. horizon hours normalized
7. model freshness normalized
8. solar-prior availability flag

### Exogenous Tensor

Window:

- latest slow context snapshot, updated every 15 to 60 minutes

Shape:

- `[8]`

Features:

1. geomagnetic jerk index
2. Schumann resonance power
3. core rotation anomaly
4. heliosphere compression
5. cosmic ray flux
6. planetary alignment index
7. lunar tidal index
8. exogenous freshness normalized

### Reliability Tensor

Shape:

- `[10]`

Features:

1. canonical-source coverage ratio
2. MMS-source coverage ratio
3. stale ratio
4. interpolated ratio
5. extrapolated ratio
6. low-confidence ratio
7. source-health score
8. power-constrained flag
9. observed ingest-cost score
10. air-gap / degraded-mode flag

### Doctrine Tensor

Shape:

- `[6]`

Features:

1. weighted signed prior
2. confidence-weighted magnitude
3. solar-domain prior
4. geomagnetic-domain prior
5. ops-domain prior
6. doctrine freshness normalized

## Model Architecture

Use a compact multi-lane model, not a full transformer.

### Recommended Blocks

#### Physics Encoder

- causal depthwise 1D convolution
- 2 layers
- hidden width 32
- gated residual GRU width 48
- output embedding 48

#### MMS Encoder

- 2-layer MLP
- width 32
- output embedding 24

#### Solar Encoder

- 2-layer MLP
- width 24
- output embedding 16

#### Exogenous Encoder

- 2-layer MLP
- width 16
- output embedding 12

#### Reliability Encoder

- 2-layer MLP
- width 16
- output embedding 12

#### Doctrine Encoder

- 2-layer MLP
- width 16
- output embedding 12

#### Fusion Block

- concatenate embeddings
- gated residual fusion MLP
- width 64
- output latent size 48

This is small enough for ONNX or MLX deployment and materially cheaper than a generic TFT while still supporting lane-specific structure.

## Hard Causal Constraints

These constraints should be enforced in code, not just in training.

1. MMS orientation head may only consume:
   - MMS lane
   - physics lane
   - reliability lane
2. Surya lane may influence:
   - storm escalation
   - aurora
   - radiation
   - but not raw MMS normal direction
3. Exogenous plus doctrine lanes may only act as bounded residuals:
   - exogenous delta cap: `+/- 0.10`
   - doctrine delta cap: `+/- 0.08`
4. If reliability lane detects degraded inputs, the model must widen uncertainty and lower action confidence.
5. If deterministic physics and learned fused output disagree strongly, operator output should surface both and prefer the deterministic path for safety.

## Output Heads

Use multi-task outputs from one shared latent.

### Head A: Storm Escalation

- target: probability of tier escalation within 30 minutes
- output: `P(quiet->watch|watch->warning|warning->severe)`

### Head B: Aurora Intensity

- target: normalized aurora intensity over 30 minutes
- output: `P10`, `P50`, `P90`

### Head C: MMS Reconnection

- target: reconnection probability within 5 minutes
- output: probability + confidence interval

### Head D: Radiation Activity

- target: belt/radiation activity index over 30 minutes
- output: normalized activity + confidence interval

### Head E: Operator Action

- classes:
  - `monitor`
  - `log`
  - `alert`
  - `reconfigure`
  - `hold`

### Head F: Trust / Calibration

- output:
  - calibration temperature
  - disagreement score vs deterministic backbone
  - degraded-mode explanation tokens

## Training Strategy

### Training Targets

- canonical storm tier transitions
- aurora-map intensity summaries
- MMS event / reconnection labels
- operator-action labels from rules or reviewed logs

### Loss

Use:

- BCE for escalation and reconnection
- pinball or CRPS-style loss for quantile heads
- cross-entropy for action class
- consistency penalty against deterministic physics during quiet regimes

Suggested total loss:

```text
L = 1.0 * L_storm
  + 1.0 * L_reconnection
  + 0.7 * L_aurora_quantiles
  + 0.5 * L_radiation_quantiles
  + 0.4 * L_action
  + 0.3 * L_consistency
```

## Ablation Rules

Before enabling any speculative priors in production:

1. Train baseline with physics + MMS + reliability only.
2. Add Surya lane and measure lift.
3. Add exogenous lane and measure lift.
4. Add doctrine lane and measure lift.

Do not enable a lane globally unless it improves:

- Brier score,
- calibration,
- and action precision / recall

without destabilizing quiet-period behavior.

Planetary-alignment features should remain off by default until they beat baseline in repeated ablations.

## On-Device Scheduling

### Always On

- deterministic physics backbone
- MMS vector fusion
- reliability lane

### Conditional

- fused model head inference when:
  - storm tier is `watch` or higher,
  - gate marks the request urgent,
  - or operator explicitly requests an analysis

### Low-Frequency

- Surya lane refresh every 15 to 30 minutes unless flare risk rises
- exogenous lane refresh every 30 to 60 minutes

### Power Save

- skip fused learned inference under severe power pressure
- fall back to deterministic `computeCanonicalPoint` and `fuseMmsVector`

## Recommended Implementation Map

1. Add `backend/ml-client/fused-features.ts`
   - builds the exact tensors above from current types
2. Add `backend/ml-client/fused-model.ts`
   - ONNX or MLX runtime wrapper
3. Add `backend/ml-client/fused-calibration.ts`
   - temperature scaling and disagreement checks
4. Extend `backend/types.ts`
   - add a `FusedForecastResponse` shape
5. Wire into `backend/ml-client/client.ts`
   - deterministic gate first
   - fused residual path second
   - deterministic fallback always available
6. Expose in `backend/routes/ai.ts`
   - new route or upgraded nowcast response
7. Surface in dashboard and command pages
   - show lane contributions and disagreement score

## Bottom Line

The best on-device architecture for this repo is:

- deterministic MHD + MMS fusion as the causal backbone,
- Surya as a solar prior lane,
- source-quality as a trust lane,
- exogenous and planetary context as tightly capped optional priors,
- and a compact multi-task fusion head for calibrated decision support.

That gives you a system that is physically grounded, computationally realistic on the M1, and flexible enough to test broader causal theories without letting speculative signals dominate the operational picture.
