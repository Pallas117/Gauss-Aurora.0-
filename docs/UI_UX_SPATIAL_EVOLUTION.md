# UI/UX Spatial Evolution Plan

Bridge between legacy aerospace reliability (Analogue NASA) and future-state spatial computing (AR Morphism). Medium: Mobile (iPhone 13) to Desktop (M1) to Projection/AR (VisionOS / Holographic Displays).

## Phase 1: V1 "Analogue NASA" (Q2–Q4 2026)

Establishing trust, tactility, and high-integrity data. The UI should feel like a physical machine: Apollo-era aesthetic, 60fps on iPhone.

### Core UX Principles (V1)

- **Mechanical tactility:** Buttons look physically depressible (hard shadows, inset borders). Use the `tactile` or `tactileDanger` button variant or `.btn-tactile` utility.
- **CRT terminal aesthetic:** The DeepSeek-R1 / RAG reasoning feed uses phosphor-style text, scanlines (`.crt-overlay`), and optional flicker (`.animate-flicker`) in a bezel-like container.
- **Hardware monospace:** All numbers use JetBrains Mono (and `tabular-nums` where appropriate) so operators can read rapid data without character jitter.
- **Data density over whitespace:** Use `.data-grid` for telemetry tables; prefer dense, grid-bounded blocks and `.data-label` / `.hud-value` patterns.

### Figma / Midjourney Prompts (V1)

**Prompt 1 (Main Dashboard):**  
"A highly tactical, NASA-inspired aerospace command dashboard. True black background (#050505). High contrast monospaced typography in bright volt green (#CCFF00) and solar red (#FF4D00). Features physical-looking toggle switches, a dark segmented data grid, and a central terminal feed with a subtle CRT phosphor glow. Utilitarian, mission-critical, no gradients, brutalist UI design."

**Prompt 2 (Telemetry Component):**  
"UI component design for a satellite telemetry readout. Looks like a physical piece of avionics hardware. Matte dark grey casing, inset digital display, sharp volt green numbers showing X-ray flux. A chunky, mechanical 'INITIATE SHIELDING' button with an orange safety cover."

---

## Phase 2: MVP "AR Morphism" (2027 Roadmap)

Evolving into spatial, holographic, and sensor-driven ops. Operators may project the UI onto transparent OLEDs or view it through AR headsets.

### Core UX Principles (MVP)

- **Projection-safe contrast:** True black (`#000000`) is mandatory; in projection and AR, black is transparent so UI elements "float."
- **Z-depth and glassmorphism:** Panels use `backdrop-blur-xl` and low opacity (`--gauss-panel-opacity`) for frosted glass; enable via `data-gauss-ui="mvp"`.
- **Sensor-driven sizing:** For AR hand-tracking and projector IR, use larger tap targets (documented; implement with `.touch-target-lg` or similar when targeting VisionOS/WebXR).
- **Holographic affordances:** Use `.holographic-affordance` (1px inner glow) on key floating elements in MVP mode.

### Figma / Midjourney Prompts (MVP)

**Prompt 3 (Holographic Projection UI):**  
"Spatial computing AR interface for satellite operations. Pitch black background. Floating glassmorphic panels with frosted translucency. A glowing neon green (#CCFF00) 3D elliptical orbit suspended in the center. UI elements have extreme Z-depth, casting subtle glowing shadows. Minimalist, futuristic holographic projection, Minority Report style but hyper-realistic and readable."

**Prompt 4 (Sensor-Driven Hand-Tracking Component):**  
"AR hand-tracking UI element for space operations. A floating, translucent dark-glass control panel. Large, chunky interactive targets glowing in neon orange. Subtle 1px light-refraction borders around the elements. Designed for holographic spatial computing."

---

## Bridge Strategy (Code Today for 2027)

### Strict color variables

All V1/MVP colors use CSS variables so switching from "Matte Grey" (V1) to "Translucent Glass" (MVP) is a single switch.

- `--gauss-bg-base`: V1 `#050505`; MVP `#000000` (set by `data-gauss-ui="mvp"`).
- `--gauss-panel-bg`: Panel tint; panels use `--gauss-panel-opacity` for background alpha.
- `--gauss-neon-primary`: `#CCFF00` (volt green).
- `--gauss-neon-danger`: `#FF4D00` (solar red).

Tailwind: `bg-gauss-bg`, `text-gauss-neon`, `text-gauss-danger`, `bg-gauss-neon`, etc.

### Glass toggle

- **V1:** `--gauss-panel-opacity: 0.92` (default). `.hud-panel` and gauss-shell use `rgba(0,0,0, var(--gauss-panel-opacity))` with `backdrop-blur-xl`.
- **MVP:** Set `data-gauss-ui="mvp"` on `<html>` (or root). This sets `--gauss-panel-opacity: 0.1` and `--gauss-bg-base: #000000`. Panels become translucent and projection-ready without component changes.

Toggle via theme provider, URL param (e.g. `?gauss-ui=mvp`), or feature flag.

### SVG over canvas

- Use SVGs for branding, nav icons, and UI chrome so they scale in AR/WebXR and can be extruded later.
- Keep the SDA 3D globe as WebGL; do not replace with SVG. For new decorative or UI elements, prefer SVG.

---

## How to switch V1 ↔ MVP

1. **V1 (default):** No attribute. Uses `--gauss-bg-base: #050505` and `--gauss-panel-opacity: 0.92`.
2. **MVP (projection/AR):** Set `data-gauss-ui="mvp"` on the document root (e.g. `<html data-gauss-ui="mvp">`). Optionally drive from URL:  
   `if (new URLSearchParams(location.search).get('gauss-ui') === 'mvp') document.documentElement.setAttribute('data-gauss-ui', 'mvp');`

---

## References

- [UI_UX_SCALING_AND_PRESENTATION.md](UI_UX_SCALING_AND_PRESENTATION.md) – Scaling, SDA-first layout, presentation mode.
- `.cursor/rules/PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE.mdc` – Memory, power, and UI performance (e.g. SVG preference, last 50 events cap).
