# Space Debris Risk 3D and Backend MEO/GEO

This doc describes the Privateer-capable data path for space debris / risk zones, the risk-zones API, and the minimal 3D overlay in the live scene. It aligns with the [PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE](.cursor/rules/PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE.mdc): 8GB M1, no heavy WebGL, at most 50 points in React state, no spin loops.

## Environment

Optional env (see `.env.example`): `PRIVATEER_API_URL`, `PRIVATEER_API_KEY` (or `PRIVATEER_API_TOKEN`) for Privateer; `TLE_CATALOG_URL` for open TLE when Privateer is not set. Run `npm run test:risk-zones` to validate the risk-zones API response shape; the script skips when `BACKEND_BASE_URL` is unset, and requires the backend to be running when the URL is set.

## Privateer adapter

- **Location:** `backend/adapters/privateer.ts`
- **Behavior:** When `PRIVATEER_API_URL` and `PRIVATEER_API_KEY` (or `PRIVATEER_API_TOKEN`) are set, the adapter calls the Privateer API and normalizes the response to `RiskZone[]`. When not set, it returns a small stub list (2–3 fixed MEO/GEO zones) so the contract is stable and the frontend can develop against it.
- **Signature:** `fetchPrivateerRiskZones(options?: { orbitTypes?: ['MEO','GEO'] }): Promise<RiskZone[]>` where `RiskZone` has `orbitType`, `altitudeKm`, `longitudeDeg?`, `latitudeDeg?`, `riskScore`, `objectCount?`, `id?`.
- **Cadence:** No high-frequency polling; the ingest loop (or caller) controls cadence (e.g. same as NOAA or every 5 min; see `debrisMs` in the worker).

## Ingest and bounded store

- **Ingest:** The ingestion worker uses the Privateer adapter when `PRIVATEER_API_URL` is set; otherwise it uses the open TLE/catalog client (`backend/ssa/open-catalog-client.ts`). Low-cadence fetch only (e.g. `debrisMs` in `WorkerCadenceConfig`).
- **Store:** Risk zones are stored in a bounded in-memory store (last 50 zones) in `backend/state.ts` via `setRiskZones` / `getRiskZones`. No unbounded arrays.

## Risk-zones API and threat pipeline

- **Endpoint:** `GET /api/ssa/risk-zones` returns `{ riskZones: RiskZone[], updatedAt: string }` from the bounded store. Response is cached with `Cache-Control: public, max-age=300` (5 min).
- **Threat pipeline:** Where the mission snapshot or threat summary is built, Privateer-derived (or open-catalog) risk zones are merged into the threat context: `evaluateInferenceUrgency` receives `riskZones` and they are converted to `DebrisExternalData` for the debris threat model. See `backend/ml-client/probability-gate.ts` and `backend/server.ts` (mission snapshot).

## Frontend: 3D overlay and feature flag

- **Feature flag:** `VITE_FEATURE_DEBRIS_3D=true` enables fetching risk zones and passing them into the 3D scene.
- **Data flow:** When the flag is on and the user has access, `useRiskZones` fetches `GET /api/ssa/risk-zones` and maps the response to `RiskZonePoint[]`. The dashboard caps at 50 points in React state and combines radiation + risk into a single `data` prop for the scene.
- **Overlay:** The same overlay used for radiation (`RadiationDataOverlay`) supports a unified `VisualizationPoint` type: radiation points use flux for color; risk points use `riskScore` (amber to red). One geometry pattern (points), no extra shaders. See `src/lib/types/radiation.ts` (`RiskZonePoint`, `VisualizationPoint`, `isRiskZonePoint`) and `src/components/scene/RadiationDataOverlay.tsx`.
- **Low power:** When `powerMode === 'low-power'`, the dashboard reduces the debris overlay (e.g. only GEO, cap 25 points) to limit cost.

## MEO/GEO focus

- The adapter and ingest filter by `orbitType: 'MEO' | 'GEO'`. LEO can be added later by extending the filter. Only high-risk cells (e.g. above a threshold) need be exposed to limit payload and UI points; the current implementation returns all zones from the source up to the store cap (50).

## Related

- [CYBERTIGER_COMPLIANCE_BASELINE.md](CYBERTIGER_COMPLIANCE_BASELINE.md) — security and audit context
- [SURYA_INTEGRATION.md](SURYA_INTEGRATION.md) — heliophysics and 3D radiation
- [ARCHITECTURE.md](ARCHITECTURE.md) — overall system layout
