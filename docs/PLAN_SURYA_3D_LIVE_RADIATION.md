# Plan: Live 3D visualization from Surya radiation data

## Goal

Drive the 3D space weather visualization (Van Allen belts, magnetosphere, radiation overlay) **live** from radiation-related data produced or analysed by the Surya model, so that when Surya returns forecast or flare outputs, the globe reflects them in real time.

## Current state

- **3D scene** ([SpaceScene](src/components/scene/SpaceScene.tsx)) receives:
  - **Visual params:** `magnetopauseCompression`, `beltIntensity`, `reconnectionStrength` — today derived only from canonical mission/solar wind (`latest`: Kp, Bz, dynamic pressure). See [HeliophysicsDashboard](src/pages/HeliophysicsDashboard.tsx) `visual` useMemo.
  - **Radiation overlay:** Optional `data?: RadiationDataPoint[]` — **not passed** by the main dashboard; only used in examples. When provided, [RadiationDataOverlay](src/components/scene/RadiationDataOverlay.tsx) / LOD render flux as points on orbit rings.
- **Surya** ([useSuryaForecast](src/hooks/useSuryaForecast.ts)): Fetches `POST /api/ai/surya/forecast`; stub returns 501 with shape `{ forecast: [], model, horizonHours }`. Contract includes `forecast: { time, value }[]` and (optional) `flare_probability_24h`. When real inference exists, these can represent EUV/flux proxy or flare-driven radiation risk.
- **Radiation types** ([radiation.ts](src/lib/types/radiation.ts)): `RadiationDataPoint` has `timestamp`, `flux`, `altitude`, `L_shell`, `orbitType`, `particleType`, `energyRange`. Existing hooks (`useRadiationData`) pull from NASA OMNI, SPENVIS, ERG, CSES — not from Surya.

## Proposed behaviour

1. **Surya-driven visual params**  
   When Surya forecast or flare data is available (stub or real), blend it into the 3D scene’s visual parameters:
   - **Belt intensity:** Combine current Kp-derived intensity with a Surya “activity” signal (e.g. mean of `forecast[].value` or `flare_probability_24h`) so that higher Surya activity increases belt intensity.
   - **Optional:** Use Surya to nudge magnetopause or reconnection strength if the API later exposes relevant scalars (e.g. solar wind / IMF proxy).

2. **Surya-driven radiation overlay**  
   Map Surya’s `forecast[]` (time, value) to a small set of `RadiationDataPoint` for the 3D overlay:
   - Treat each `forecast` point as a flux proxy at a nominal orbit (e.g. LEO 400 km, L_shell 1.5, or spread across LEO/MEO/GEO) so that “radiation analysed by Surya” appears as live points on the globe.
   - When the backend returns real flux/EUV values, the same mapping can use a documented scale (value → flux) so the overlay stays physically meaningful.

3. **Feature flag and fallback**  
   - Use `VITE_FEATURE_SURYA_STUB` (or a dedicated `VITE_FEATURE_SURYA_3D_LIVE`) to gate Surya-driven 3D behaviour.
   - When the flag is off: current behaviour only (canonical `latest` for visual params; no Surya radiation overlay).
   - When the flag is on but Surya returns stub/empty: use harmless defaults (e.g. Surya contribution 0, or a single placeholder radiation point) so the pipeline is exercised without changing the look dramatically.

## Implementation steps

### 1. Surya “activity” for visual params

- In the frontend, from `useSuryaForecast()`:
  - Compute a single **activity** value in `[0, 1]`: e.g. `flare_probability_24h` if present, or mean of `forecast[].value`, or 0 if empty/stub.
- In HeliophysicsDashboard (or a small helper):
  - When `VITE_FEATURE_SURYA_3D_LIVE` (or `VITE_FEATURE_SURYA_STUB`) is true and Surya data exists, blend activity into `visual`:
    - e.g. `beltIntensity = 0.7 * kpDerived + 0.3 * suryaActivity`.
  - Pass the blended `visual` into SpaceScene as today; no change to SpaceScene props for visual params.

### 2. Map Surya forecast to RadiationDataPoint[]

- Add a small mapper (e.g. in `src/lib/suryaRadiation.ts` or next to `useSuryaForecast`):
  - Input: `SuryaForecastResponse` (forecast array, model, horizonHours).
  - Output: `RadiationDataPoint[]`: one point per forecast entry (or a capped subset), with:
    - `timestamp` from `time`
    - `flux` from `value` scaled to a plausible range (e.g. `value * 1e4` or a constant scale documented in SURYA_INTEGRATION.md)
    - Fixed `altitude`, `L_shell`, `orbitType` (e.g. LEO), `particleType` and `energyRange` as constants for “Surya proxy”.
- When Surya is enabled and forecast length > 0, pass this array to SpaceScene as `data={suryaRadiationPoints}` and set `layers.radiationData = true` when Surya is the source so the overlay is visible.

### 3. Wire dashboard to Surya + 3D

- In HeliophysicsDashboard:
  - Call `useSuryaForecast()` when `VITE_FEATURE_SURYA_STUB === 'true'` or when a Surya 3D flag is set (reuse or add env).
  - Compute blended `visual` (step 1) and `suryaRadiationPoints` (step 2).
  - Pass `visual` into SpaceScene as today.
  - Pass `data={suryaRadiationPoints}` to SpaceScene when the array is non-empty; ensure `layers.radiationData` is true when showing Surya radiation so the overlay renders.
- Ensure orbit filter for the overlay includes the orbit type(s) used by the Surya points (e.g. LEO).

### 4. Docs and contract

- In [SURYA_INTEGRATION.md](SURYA_INTEGRATION.md):
  - Add a short “Live 3D visualization” section: when Surya data is available and the feature flag is on, the 3D scene uses Surya to modulate belt intensity and can show a radiation overlay from the forecast time series; `forecast[].value` is interpreted as a normalized activity/flux proxy (0–1) until the backend documents a physical scale.
- In the mapper, add a comment or constant documenting the flux scale (e.g. placeholder scale until backend specifies units).

### 5. Optional: Layer toggle and attribution

- In the UI (e.g. layer toggles or Surya panel), indicate when the 3D view is “Surya‑driven” (e.g. “Belt intensity + radiation from Surya” when flag is on and data present).
- Optional: small badge or tooltip on the 3D panel: “Radiation overlay: Surya forecast” when `data` is from Surya.

## Constraints (project directive)

- **Memory:** No new heavy state; Surya forecast is a small array. Avoid storing large histories; map only the current response to radiation points.
- **No spin loops:** Use existing Surya fetch interval or on-demand fetch; no new high-frequency polling.
- **UI:** Do not keep massive telemetry in React state; Surya forecast is bounded (e.g. 12–24 points).

## Summary

| Item | Action |
|------|--------|
| Visual params | Blend Surya “activity” (from forecast/flare) into belt intensity (and optionally others) when flag is on. |
| Radiation overlay | Map Surya `forecast[]` to `RadiationDataPoint[]` and pass as `data` to SpaceScene; enable radiation layer when Surya data is present. |
| Feature flag | Use `VITE_FEATURE_SURYA_STUB` or `VITE_FEATURE_SURYA_3D_LIVE` to gate behaviour; fallback when Surya empty/stub. |
| Docs | Document live 3D behaviour and flux proxy convention in SURYA_INTEGRATION.md. |

Once the backend serves real Surya forecast/flare values, the same pipeline will drive the 3D view live from “radiation data analysed by the Surya model” without further contract changes.
