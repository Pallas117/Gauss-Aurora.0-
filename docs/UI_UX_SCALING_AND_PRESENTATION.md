# UI/UX scaling and presentation

Guidance for making the app scale across devices and projection (remote ops, demos, hackathons, workshops) with **SDA (Space Domain Awareness) front and center**.

## What existing documents say

- **UI integration ([UI_INTEGRATION_NOTES.md](UI_INTEGRATION_NOTES.md))**  
  Shell styling lives in `theme-gauss-ui.css` and `crt.css`. Dark mode is forced globally. Router uses `createBrowserRouter`; primary operational shell is `/`. SDA is at `/sda`.

- **UI/UX designer agent (`.cursor/agents/ui-ux-designer.md`)**  
  Goals: minimal yet expressive; calm by default; **fast, fluid, and responsive even on modest hardware**; highly legible. Define a clear **hero** (e.g. the 3D SDA visualization). Layout: app chrome, primary panel, secondary panel, HUD. Prefer **GPU-accelerated transforms**; avoid heavy shadows/blur and overdraw.

- **Project Gauss directive (`.cursor/rules/PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE.mdc`)**  
  **UI/UX performance:** Prefer pure, hardware-accelerated SVG when memory pressure is high; avoid unnecessary heavy WebGL. **Do not store massive telemetry in React state**—keep only the last 50 events to prevent browser tab crashes.

- **Data fetching ([DATA_FETCHING_OPTIMIZATION.md](DATA_FETCHING_OPTIMIZATION.md))**  
  React Query caching and bounded data; frontend retention aligned with “last 50 events” and backend caps.

## Design decisions for scaling and SDA

1. **SDA front and center**  
   - SDA (3D magnetosphere / space situational awareness) is the primary “hero” for demos and ops.  
   - Default landing can be set to SDA via `VITE_DEFAULT_LANDING=sda` so opening the app goes straight to the visualization.  
   - On the SDA route, the 3D scene occupies the main content area; side panels (layers, physics) are secondary and can collapse or overlay so the globe is unobstructed when cast.

2. **Scale for projections and devices**  
   - Layout and typography scale with viewport using fluid values (e.g. `clamp()`) so the same build works on laptops, large monitors, and projectors.  
   - No fixed pixel heights that break on very large or very small screens; use `min-height` with `vh` and reasonable min/max so the SDA canvas and chrome remain usable.  
   - Shell is already responsive (sidebar stacks on smaller widths); ensure SDA page uses flexible grid and that the 3D container grows with available space on large displays.

3. **Presentation / cast mode**  
   - Optional **presentation mode** (e.g. `?presentation=1` on SDA or a toggle): minimal chrome, SDA full-bleed in the content area, nav as overlay or collapsed so a cast to a large room shows the visualization with minimal UI.  
   - Keeps one code path; no separate “kiosk” build required.

4. **Demos, hackathons, workshops**  
   - Same scaling and SDA-first behavior supports:  
     - Remote emergency use (one tab, cast to a room).  
     - Demos (open `/` or `/sda`, optionally with `?presentation=1`).  
     - Hackathons/workshops (responsive on various laptops and shared screens).

## Implementation notes

- **Env:** `VITE_DEFAULT_LANDING=sda` → index route redirects to `/sda`.  
- **CSS:** Fluid variables and `.gauss-shell--presentation` (or query param) for minimal chrome / full-bleed content when needed.  
- **SDA page:** Main scene container uses `min-height: min(70vh, 900px)` (or similar) and flex/grid so it grows on large viewports; side panel can be overlay or drawer in presentation mode.  
- **Memory:** No change to “last 50 events” or WebGL usage; scaling is layout/CSS and route default only.

## References

- [UI_INTEGRATION_NOTES.md](UI_INTEGRATION_NOTES.md)  
- [DATA_FETCHING_OPTIMIZATION.md](DATA_FETCHING_OPTIMIZATION.md)  
- `.cursor/agents/ui-ux-designer.md`  
- `.cursor/rules/PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE.mdc`
