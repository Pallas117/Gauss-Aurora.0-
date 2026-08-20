# Local Model Service Integration Doctrine

Project Gauss should wire its local model service the way durable deep-space missions and critical autonomy experiments wired survivability: preserve a tiny truthful health core, keep autonomy adjustable, and degrade in tiers before margins are exhausted.

## Source Mission Patterns

### Voyager
- Keep the nominal control path tiny and deterministic.
- Preserve truthful subsystem health even when optional functions are shed.
- Accept staged load shedding to extend mission life rather than keeping everything online.

### Deep Space 1 Remote Agent
- Separate planning, execution, and diagnosis.
- Keep autonomy bounded by explicit rules and fallback envelopes.
- Treat autonomy experiments as adjustable and reversible, not unconstrained.

### New Horizons
- Use hibernation, duty cycling, and fault protection as first-class operating modes.
- Wake heavier subsystems only for bounded mission phases, anomalies, or operator request.

### Landsat 5
- Outlast the design life by protecting the minimum mission service first and adapting operations around aging constraints.

## Gauss Service Doctrine

### 1. One truth source for model reachability
- `GAUSS_BRAIN_URL` and `ORCHESTRATOR_LOCAL_ENGINE_URL` must describe the same local transport.
- Prefer `http://127.0.0.1:8088/v1` for the primary MLX path.
- Prefer `http://127.0.0.1:8089/v1` only as the bounded stub fallback.
- Never allow cloud or unknown endpoints to masquerade as the local operator path.

### 2. Tiered degradation
- Primary: MLX DeepSeek on port `8088`.
- Fallback: local stub on port `8089`.
- Final safe state: deterministic-only reasoning with truthful `projected` or `warming` public status.

### 3. Adjustable autonomy
- The model may interpret and propose, but routing, approval, RAM governance, and safety fallbacks remain deterministic.
- Under constrained RAM, the model is opt-in only.
- Under critical RAM, the model is off.

### 4. Bounded self-repair
- First repair the wiring contract.
- Then repair reachability.
- Only then repair richer behavior.
- Never claim a restart, model load, or healthy endpoint without a real probe proving it.

### 5. Hibernation before collapse
- If RAM, power, or thermal headroom falls, suspend background reasoning before core health and public awareness collapse.
- Preserve `/health`, public SDA continuity, and minimal ops state before any model-backed feature.

## Expected Local Wiring

### Primary MLX path
- `GAUSS_BRAIN_URL=http://127.0.0.1:8088/v1`
- `ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8088/v1/chat/completions`
- Start command: `npm run dev:brain:mlx`

### Stub fallback path
- `GAUSS_BRAIN_URL=http://127.0.0.1:8089/v1`
- `ORCHESTRATOR_LOCAL_ENGINE_URL=http://127.0.0.1:8089/v1/chat/completions`
- Start command: `npm run dev:brain:stub`

### Verification
- Probe the configured endpoint with a bounded ping.
- Confirm parseable chat output.
- Confirm the models endpoint when available.
- Prefer deterministic fallback if any of those checks fail.

## Operational Rule

Zero tolerance for hallucination applies to service health as well as analysis. If the model or the auditor is uncertain about reachability, startup state, or transport correctness, it must say more evidence is needed and recommend the smallest safe repair or experiment.
