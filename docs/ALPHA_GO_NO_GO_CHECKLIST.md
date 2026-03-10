# Project Gauss: Alpha Release Go/No-Go Checklist

**Target:** Alpha testers (design partners and KL Hackathon crew)  
**Environment:** Apple Silicon (M1/M2/M3), 8GB unified memory (6GB hard limit)  
**Protocol:** Verify all systems before issuing the `gauss.sh/install` command to third parties.

---

## 1. The 6GB "Apollo" Memory Audit

Alpha testers will uninstall if Gauss freezes their laptops. Prove extreme efficiency.

| Check | Status | How to verify / Notes |
|-------|--------|------------------------|
| **Baseline RAM check** | Implemented | Run `npm run memory:baseline` (or `python3 scripts/memory/baseline_ram_check.py --baseline 500`). Passes if sum RSS of gauss/node/vite/orchestrator processes &lt; 500MB. Requires `pip install psutil`. |
| **Polars lazy-load** | Code / Audit | Ingest path must use `pl.scan_csv()` not `pl.read_csv()`. Enforced by `backend/scripts/check-directive-python.py`. Run: `python3 backend/scripts/check-directive-python.py`. See `backend/gauss_physics_imputer.py`, `ml/rag/ingest.py`. |
| **Hot-swap: Surya then DeepSeek** | Implemented | `scripts/triad_pipeline.py`: Surya run → `gc.collect()` + `mx.metal.clear_cache()` → DeepSeek. `ml/surya_service.py` calls `gc.collect()` after request. |
| **Surya load → forecast → unload** | Implemented | Surya stub/real in triad; GC and cache clear in pipeline and surya_service. |
| **DeepSeek within 2.5GB cache** | Implemented | `scripts/process/run-mlx-deepseek.sh` passes `--cache-limit-gb 2.5` (or `MLX_CACHE_GB`). |
| **Panic ceiling (5.8GB OOM)** | Implemented | Run `npm run test:oom` (or `python3 gauss_test_suite.py`). Backend ingest-loop calls `isMemoryOverCeiling()` at each tick; when `scripts/memory/baseline_ram_check.py --ceiling 5800` exits 1, ingest tick is dropped. See `backend/memory-check.ts`, `backend/worker/ingest-loop.ts`. |

---

## 2. Sovereign Security and Air-Gap Verification

Primary moat: "Zero-Cloud." Prove data never leaves the machine.

| Check | Status | How to verify / Notes |
|-------|--------|------------------------|
| **Flight mode test** | Manual | Disconnect Wi‑Fi. Run full anomaly simulation. RAG + DeepSeek must run without internet (local RAG: `ml/rag/server.py`; local LLM: MLX or stub). |
| **Network egress audit** | Manual | Use Little Snitch or Wireshark. No `remote_gauss_api.py` in repo; ensure no backend/ML paths call HuggingFace, OpenAI, or AWS in core loop. Backend uses local Supabase and optional Turing pool. |
| **Tailscale mesh binding** | Config | FastAPI (if used) or Node backend: bind to `0.0.0.0` or Tailscale IP `100.x.x.x`. See `PROXY_HOST` in `.env`, `docs/TURING_TAILNET_DEVICES.md`. |
| **SEU checksum test** | Implemented | RAG: `ml/rag/server.py` verifies `ingest.checksum_text(text) != stored_cs` and skips corrupted chunks. Test: `pytest ml/rag/test_rag_checksum_directive.py`. Manually corrupt a string in LanceDB and confirm RAG flags mismatch. |

---

## 3. Backend Routing and Triad Orchestration

Nervous system (Rust) and brain (Python).

| Check | Status | How to verify / Notes |
|-------|--------|------------------------|
| **Rust watchdog speed** | Implemented | `gauss-orchestrator` uses `notify` (OS-level file events). Drop `telemetry.csv` in watched dir; detection is event-driven (no poll loop). Debounce: `ORCHESTRATOR_WATCH_DEBOUNCE_MS` (e.g. 1000ms). Confirm &lt; 50ms is achievable with low debounce. |
| **CCSDS parsing** | Implemented | `gauss-orchestrator/src/telemetry/ccsds.rs`: `parse_primary_header()` reads 6-byte header, extracts APID. Tests: `gauss-orchestrator/tests/ccsds_decoder_tests.rs`, fixtures in `tests/fixtures/`. |
| **Cloud-export buffer (Worker C)** | Implemented | `gauss-orchestrator/src/anonymization.rs`: `anonymize_payload()` strips `satellite_id`, `orbital_vector`, `latitude`, `longitude`, etc. `pipeline.rs` uses it before optional cloud POST. Tests: `anonymization.rs` unit tests, `integration_cloud_local.rs`. |

---

## 4. "Hard Sovereign" UI/UX (Codex HUD)

First visual impression must be flawless and high-speed.

| Check | Status | How to verify / Notes |
|-------|--------|------------------------|
| **Mobile viewport** | Manual | Open HUD on iPhone via Tailscale. Zero horizontal scroll; Bento cards stack. Test responsive layout and breakpoints. |
| **Zero-WebGL / SVG Ceres** | **Gap** | Checklist says "Three.js entirely removed and replaced with SVG Gauss Ceres logo." Current codebase uses **Three.js/WebGL** for the SDA 3D globe (`SpaceScene`, `HeliophysicsDashboard`). Project directive prefers SVG when memory pressure is high but does not require removing WebGL. **Product decision:** Either (a) add an optional "lite" mode (SVG-only landing/Ceres) for 8GB devices, or (b) document that Alpha runs 3D on capable devices and clarify checklist wording. |
| **Async terminal feed** | Implemented | Reasoning stream (e.g. `GaussRagPanel`, RAG answer) updates asynchronously; ensure auto-scroll and no main-thread lock (no massive state). |
| **250ms haptic rule** | Implemented | "Initiate Shielding" and primary actions use tactile button variant; UI state (depress/color) updates immediately. Backend confirmation can follow async. |

---

## 5. Tester Onboarding Experience

Frictionless setup for high-signal operator feedback.

| Check | Status | How to verify / Notes |
|-------|--------|------------------------|
| **1-line install** | Implemented | Run `curl -sSf https://gauss.sh/install | sh` (when gauss.sh points to script) or `./scripts/install/install.sh` in repo. Script: `scripts/install/install.sh` — clones (or uses cwd), `npm i`, Python `.venv`, copies `.env.example` to `.env`. Set `GAUSS_REPO_URL` and `GAUSS_INSTALL_DIR` as needed. |
| **Model pre-fetch** | Partial | DeepSeek-R1-Distill-Qwen-1.5B-4bit: MLX loads from HuggingFace on first run. Document in README; optionally add setup step to pre-download. |
| **Feedback loop (Mission Feedback)** | Backend | "Mission Feedback" button in HUD: confirm payload routes to local Notion/Airtable via n8n or equivalent. Backend has feedback routes; n8n webhook is optional (orchestrator can replace n8n per docs). |
| **Documentation (6GB + close Chrome)** | Doc | README must explain 6GB limitation and instruct closing Chrome/heavy apps before mission simulation. See **README section** below. |

---

## GO / NO-GO Declaration

If all boxes are checked, Project Gauss V0.5 is **cleared for Alpha distribution**.

**Current summary**

- **Implemented:** Polars directive, Surya/DeepSeek hot-swap and cache limit, RAG checksum (SEU), Rust file watcher, CCSDS parsing, anonymize_payload, tactile UI, async reasoning feed.
- **Partial / manual:** Baseline RAM (no script), flight mode and egress (manual), Tailscale binding (config), mobile viewport (manual), model pre-fetch (doc).
- **Gaps:** README 6GB/Chrome guidance (done); **clarification** on WebGL vs SVG-only for Alpha. Baseline RAM script, OOM test + PM drop, and install script are implemented.

---

## References

- `backend/scripts/check-directive-python.py` – Polars lazy load and GC/mx checks
- `backend/scripts/directive-adherence-audit.ts` – RAG checksum and mlx cache limit
- `ml/rag/test_rag_checksum_directive.py` – SEU checksum verification test
- `scripts/process/run-mlx-deepseek.sh` – MLX with `--cache-limit-gb 2.5`
- `gauss-orchestrator/src/anonymization.rs` – `anonymize_payload`, `anonymize_telemetry`
- `gauss-orchestrator/src/telemetry/ccsds.rs` – CCSDS primary header and APID
- `.cursor/rules/PROJECT-GAUSS-STRICT-OPTIMIZATION-DIRECTIVE.mdc` – 8GB / 6GB constraints
- `scripts/memory/baseline_ram_check.py` – Baseline (--baseline 500) and ceiling (--ceiling 5800)
- `backend/memory-check.ts` – Ingest-loop calls this; drops tick when over ceiling
- `gauss_test_suite.py` – OOM stress test; `npm run test:oom`
- `scripts/install/install.sh` – One-line install (clone, npm i, .venv)
