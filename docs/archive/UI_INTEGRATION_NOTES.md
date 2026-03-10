# UI Integration Notes (Gauss UI ZIP Hybrid Merge)

**Archived:** This document was moved to `docs/archive/` per doc-scan improvement plan. Gauss UI merge is complete; retain for merge-history reference. See [ARCHITECTURE.md](../ARCHITECTURE.md) and [VISION_AND_ROADMAP.md](../VISION_AND_ROADMAP.md) for current structure.

---

## Scope
This document tracks compatibility decisions while integrating `Gauss UI.zip` into the operational Gauss Aurora shell.

## Applied decisions
- Router migrated to data-router configuration (`createBrowserRouter` + `RouterProvider`).
- New primary operational shell route is `/`.
- Existing operational modules are preserved and wired into new pages (`/heliophysics`, scene modules, RAG, threat actions, feedback).
- Legacy sovereign entry portal remains available at `/portal` for rollback safety.
- Dark mode remains forced globally through `ThemeProvider(forceDark=true)`.

## Styling merge
- Imported shell styling is merged into:
  - `src/styles/theme-gauss-ui.css`
  - `src/styles/crt.css`
- Style load order is:
  1. `src/index.css`
  2. `src/styles/theme-gauss-ui.css`
  3. `src/styles/crt.css`

## Component/API adaptations
- ZIP router files referenced `react-router` imports and `src/app/*` aliases from the ZIP scaffold.
  - Adapted to project aliasing and `react-router-dom` route tree under `src/app/routes.tsx`.
- ZIP mock telemetry streams were replaced with live API hooks and aggregate endpoint wiring.
- Added aggregate endpoint `/api/ops/command/latest` to reduce fragmented polling for command shell cards.

## Dependency posture
- Core versions kept stable where risk is high (`three`, `vite`, Tailwind major).
- ZIP-specific optional ecosystem packages are allowed, but operational pages avoid hard dependency on optional globe overlay by default.
- `VITE_ENABLE_GLOBE_OVERLAY=false` remains default.

## Known constraints
- CyberTiger runtime details are role-gated (operator/admin) in aggregate responses.
- Some chronos widgets are simulation-labeled until dedicated live sources exist.
