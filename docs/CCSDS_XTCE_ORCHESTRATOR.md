# CCSDS/XTCE Production Path: Gauss Orchestrator

The **Gauss orchestrator** (Rust) is the **single production path** for CCSDS packet decode and XTCE-backed canonical mapping. Packet telemetry flows: file drop or optional HTTP → orchestrator decode + map → backend ingest → Supabase pipeline → space weather feed.

---

## Overview

| Layer | Role |
|-------|------|
| **Orchestrator** | Decodes CCSDS packets (binary/hex), applies XTCE dictionary identity + APID map, produces canonical Gauss points; posts to backend or returns decode-only JSON. |
| **Backend** | Accepts `POST /api/ingest/telemetry/packets` (admin/restricted), writes to `sw_raw_samples`; ingest worker runs `clean_raw_window` and `generate_nowcast_5s` so data appears on the feed. |
| **Supabase** | `sw_raw_samples` → `clean_raw_window` → `sw_clean_samples` → `generate_nowcast_5s` → `sw_nowcast_5s`; feed API reads from `sw_nowcast_5s`. |

---

## Required environment (orchestrator)

For production packet telemetry, set in the environment where the orchestrator runs (or in `.env` passed to it):

| Variable | Description | Example |
|----------|-------------|---------|
| `ORCHESTRATOR_DECODE_ENABLED` | Enable CCSDS decode and ingest path. | `true` (recommended when using packet telemetry) |
| `ORCHESTRATOR_TELEMETRY_DIR` | Directory watched for `.bin` / `.hex` / `.ccsds` files. | `./new_telemetry` |
| `ORCHESTRATOR_INGEST_API_URL` | Backend ingest endpoint. | `http://127.0.0.1:3001/api/ingest/telemetry/packets` |
| `ORCHESTRATOR_INGEST_API_TOKEN` | Admin/restricted token for ingest (Bearer + x-gauss-service-token). | (secret) |
| `ORCHESTRATOR_XTCE_PATH` | Path to XTCE dictionary XML (SpaceSystem identity). | `./gauss-orchestrator/config/xtce/baseline.xtce.xml` |
| `ORCHESTRATOR_APID_MAP_PATH` | Path to APID map JSON (byte layout → canonical fields). | `./gauss-orchestrator/config/xtce/apid-map.json` |

Optional: `ORCHESTRATOR_PACKET_MAX_BATCH`, `ORCHESTRATOR_PACKET_MAX_BYTES`, `ORCHESTRATOR_PACKET_CRC_ENABLED`, `ORCHESTRATOR_PHYSICS_VALIDATION`, `ORCHESTRATOR_REFINEMENT_API_URL`, etc. See `gauss-orchestrator/src/config.rs` and `gauss-orchestrator/DEVELOPMENT.md`.

---

## Flow: file-based ingest

1. Drop `.bin`, `.hex`, or `.ccsds` files into `ORCHESTRATOR_TELEMETRY_DIR`.
2. Orchestrator file watcher detects the file (when `ORCHESTRATOR_DECODE_ENABLED=true`).
3. **Decode:** CCSDS primary header + payload; format from extension (bin/hex/ccsds → binary, hex → hex decode).
4. **Map:** XTCE dictionary id + APID map look up each APID; decode payload bytes (offset/type/scale/bias) into `solarWind.speed`, `solarWind.density`, `magneticField.z`; build canonical point (Gauss schema).
5. Optional: physics validation, refinement API, 3-sigma filter (when configured).
6. **Ingest:** POST batches to `ORCHESTRATOR_INGEST_API_URL` with `source: "ccsds-orchestrator"`.
7. Backend writes rows to `sw_raw_samples` (source, stream `"canonical"`, observed_at, payload). Payload shape must match what `clean_raw_window` expects: top-level `solarWind`, `magneticField`, etc. (see Backend payload shape below).
8. On next ingest worker tick, backend runs `clean_raw_window` then `generate_nowcast_5s`; feed endpoints read from `sw_nowcast_5s`.

---

## XTCE vs APID map

- **XTCE dictionary** (`baseline.xtce.xml`): Provides **SpaceSystem identity** (dictionary_id) and **parameter names** (e.g. `solarWind.speed`, `solarWind.density`, `magneticField.z`). The orchestrator loads it to validate/version the mapping; the XML is not used today to derive byte offsets or types.
- **APID map** (`apid-map.json`): **Mapping layer** from packet layout to canonical fields. Each APID has a list of parameters: `target` (canonical path), `offset` (bytes), `type` (e.g. `f32_be`, `i16_be`), optional `scale`/`bias`. This is the implementation of “map decoded payload to Gauss canonical schema.”

**XTCE compatibility:** Parameter names in the APID map match the XTCE ParameterSet where applicable. Adding a new parameter in the XTCE dictionary implies adding a corresponding entry in the APID map for each APID that carries it.

### Adding or changing APIDs

1. Edit `gauss-orchestrator/config/xtce/apid-map.json`: add or change the APID key (e.g. `"902"`) and its `parameters` array (target, offset, type, scale, bias).
2. Optionally update `gauss-orchestrator/config/xtce/baseline.xtce.xml` (e.g. add a container or parameter name) so the dictionary id and names stay in sync.
3. Ensure `dictionary_id` in the APID map file matches the SpaceSystem name in the XTCE file (or leave it unset to use the loaded XTCE dictionary id).

### Validating apid-map against XTCE

The orchestrator can validate that every parameter in the APID map exists in the XTCE `ParameterSet` and that its `type` matches the XTCE `parameterTypeRef` (and that the type is defined in the XTCE `ParameterTypeSet`). This keeps apid-map and the XTCE dictionary in sync.

- **From the orchestrator directory:** Run the integration test:  
  `cargo test baseline_xtce_and_apid_map_validate`  
  The test loads `config/xtce/baseline.xtce.xml` and `config/xtce/apid-map.json` and asserts validation passes.
- **Script (for CI):** From `gauss-orchestrator`, run:  
  `./scripts/validate-xtce-apid.sh`  
  It runs the same test and exits non-zero on failure.

When you add or change parameters in the APID map, ensure the **parameter name** (`target`) exists in the XTCE `ParameterSet` and the **type** (e.g. `f32_be`) matches the XTCE `parameterTypeRef` and is defined in the XTCE `ParameterTypeSet`. Validation catches unknown parameters and type mismatches.

---

## Backend payload shape (sw_raw_samples)

The backend packet ingest handler writes one row per packet to `sw_raw_samples` with:

- `source`: e.g. `ccsds-orchestrator`
- `stream`: `"canonical"`
- `observed_at`: packet timestamp (ISO 8601)
- `payload`: JSONB with **top-level** `solarWind`, `magneticField`, etc., so that Supabase `clean_raw_window` can read `payload #>> '{solarWind,speed}'`, `payload #>> '{solarWind,density}'`, `payload #>> '{magneticField,z}'`. The handler builds this by spreading the packet’s `canonical_point` into the payload and adding `quality`, `uncertainty`, and `packetMeta`. Do not store only a nested `canonical_point` key if `clean_raw_window` expects top-level fields.

See `backend/server.ts` (packet ingest route) and `supabase/migrations/20260217120000_space_weather_pipeline.sql` (`clean_raw_window`).

---

## Optional: HTTP decode API

When `ORCHESTRATOR_DECODE_API_BIND` is set (e.g. `127.0.0.1:8092`), the orchestrator exposes **POST /telemetry/decode** that accepts raw packet bytes or JSON and returns decode+map results **without** writing files or calling the ingest API.

- **Raw body:** Send binary payload; decoded as `ccsds-bin`.
- **JSON body:** `{ "format": "ccsds-bin" | "ccsds-hex", "payload": "<base64-encoded bytes>" }`.

Response: `{ "decoded_count", "mapped_count", "format", "dictionary_id", "packets": [MappedCanonicalPacket], "errors": [...] }`. Use this when another service receives raw packets and needs canonical packets without the file-based path.

---

## References

- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Orchestrator config and env: `gauss-orchestrator/src/config.rs`, [gauss-orchestrator/DEVELOPMENT.md](../gauss-orchestrator/DEVELOPMENT.md)
- Packet ingest contract: [backend/contracts/packet-ingest-contract.ts](../backend/contracts/packet-ingest-contract.ts)
- Competitive readiness / protocol parity: [COMPETITIVE_READINESS_SCORECARD.md](COMPETITIVE_READINESS_SCORECARD.md)
