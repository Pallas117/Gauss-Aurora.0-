# Orchestrator flow: innovation opportunities

This memo summarizes concrete improvement opportunities for the gauss-orchestrator flow (file watch → decode → map → ingest, optional decode/pass/SSA APIs). It is an outcome of the orchestrator testing and flow innovation review. No implementation is implied; priorities are for planning only.

---

## High value

- **Observability (spans and metrics)** — **Done.** Span and summary log: `telemetry::process_packet_file` in [gauss-orchestrator/src/telemetry/mod.rs](../gauss-orchestrator/src/telemetry/mod.rs) has `#[tracing::instrument(skip(client, config), fields(file = %path.display()))]` and one structured log per file with `file`, `decoded_count`, `mapped_count`, `accepted_count`, `rejected_count`, and `duration_ms`.

- **Ingest retries** — **Done.** Retries: [ingest_client::post_ingest_packets](gauss-orchestrator/src/telemetry/ingest_client.rs) with configurable `ingest_retry_count` and `ingest_retry_backoff_ms` (env: `ORCHESTRATOR_INGEST_RETRY_COUNT`, `ORCHESTRATOR_INGEST_RETRY_BACKOFF_MS`). Retries on 5xx and connection errors with exponential backoff; on 413 with multiple packets, splits batch and retries each half.

- **Canonical-shape test**  
  Done: `decode_and_map_packets_produces_canonical_shape_for_backend` and decode API test assert that mapped packets have `solarWind.speed`, `solarWind.density`, `magneticField.z` and optional quality/uncertainty so the backend contract and Supabase pipeline stay in sync. Keep these tests as the single source of truth for the canonical shape.

---

## Medium value

- **Backpressure / bounded channel**  
  Today: File watcher sends paths over an unbounded mpsc; each path spawns a tokio task. Under high file throughput, many tasks can queue. **Opportunity:** Document current behavior; consider a bounded channel or semaphore to limit concurrent file processing for M1 memory directive.

- **Request / correlation ID**  
  Today: Pass API sets `X-Request-Id`; the decode/ingest path does not propagate a correlation ID (e.g. file name or `run_id`) to the backend. **Opportunity:** Pass `run_id` or a request_id in ingest headers or payload so backend logs can correlate with orchestrator runs.

- **Process-from-bytes API for tests**  
  Today: `decode_and_map_packets(bytes, format, config)` exists and is used by the decode API and by tests. **Opportunity:** Already in place; ensure all decode-path tests (including decode API integration test) use this code path so there is a single implementation under test.

---

## Lower / later

- **Streaming decode**  
  Today: Full file read into memory (capped by `packet_max_bytes`); decode then map then chunked POST. **Opportunity:** If decoder_registry can support streaming, consider streaming decode for very large files to reduce peak RAM. Document current max memory per file (e.g. `packet_max_bytes` plus decoded structures).

- **File dedup**  
  Today: Duplicate file processing would POST the same data again; `run_id` is per run. **Opportunity:** Optional dedup by file path + mtime or hash before processing, or document that duplicate files are accepted and backend/DB handles dedup if needed.

- **Benchmark suite**  
  Today: No `criterion` or `#[bench]` in the repo. **Opportunity:** Add a small benchmark for decode + map (e.g. 100 packets from fixture) to catch regressions and measure impact of changes.

- **run_one_file for E2E**  
  Today: File watcher and `process_path` live in the main binary; no library facade that runs “one file” for testing. **Opportunity:** Optional `orchestrator::run_one_file(path)` or similar in lib for E2E tests without spawning the full watcher.

---

## Flow summary

- **No spin loops:** Watcher uses notify (event-driven); main loop is `while let Some(path_str) = file_rx.recv().await`. Compliant with power directive.
- **Memory:** Single large read per file; chunked POST. Document and monitor for M1 8GB under load.
- **Testability:** `process_packet_file` and `decode_and_map_packets` take explicit dependencies (client, path/config, bytes); no global state for the telemetry path. Orchestrator tests are now part of the full-adherence audit.

---

## References

- Plan: Orchestrator testing and flow innovation.
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).
- CCSDS/XTCE path: [CCSDS_XTCE_ORCHESTRATOR.md](CCSDS_XTCE_ORCHESTRATOR.md).
- Orchestrator testing: [gauss-orchestrator/TESTING.md](../gauss-orchestrator/TESTING.md).
