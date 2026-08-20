# Deterministic MHD boundary

The first deterministic flight-boundary seam is `services/mhd-deterministic-cpp`. It is a dependency-free C++17 SIL fixture, not a replacement for NASA cFS or a validated production MHD solver.

```text
bounded telemetry → C++ fixture / cFS seam → gauss-mhd-fixture-v1 → Cesium probe
                                      ↘ existing Rust/JSON analytics contracts
```

The fixture uses fixed arrays, clamps non-finite inputs, caps output to 64 frames, and has a deterministic self-test. Its output contract is defined in `config/mhd-fixture.schema.json`. The browser implementation mirrors the same bounded equations in `src/lib/mhd-fixture.ts` so the Cesium probe can be tested without a live spacecraft or network service.

Cesium is intentionally opt-in at the runtime boundary: set `VITE_FEATURE_CESIUM_MHD=false` to disable it, and low-power mode disables it automatically so the existing SVG view remains the memory-safe path. The Cesium scene requests no terrain or imagery and creates only a fixed set of Earth, boundary, tail, field-line, and solar-wind entities.

This validates data-flow determinism and visual plumbing only. It does not establish flight readiness, physical-model validation, cFS certification, CCSDS conformance, or Yamcs integration.
