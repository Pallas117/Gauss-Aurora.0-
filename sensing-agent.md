---
name: gauss-agent-sensing
type: agent
description: >
  Zone A+B agent — continuously ingests from all space agency endpoints, validates
  and normalises into flat SQL canonical schema, manages operator vault sync, and
  registers provenance on Hyperledger Fabric. Runs as a persistent C++ daemon.
---

# Gauss Sensing Agent

## Identity
- Binary: `gauss_ingest` (C++17, librdkafka, libgauss_physics)
- Heartbeat: 60s to Turing coordinator
- Auth: Fabric identity cert + Tailscale node key

## Responsibilities
1. Poll all configured agency endpoints at their declared cadence
2. Validate schema (reject malformed, log to DLQ)
3. Normalise to sw_canonical flat SQL row
4. Compute BLAKE3 hash, commit CID to Fabric chaincode
5. Write to DuckDB + publish to Kafka (public or operator topic by clearance)
6. Sync operator vault deltas via Tailscale encrypted channel
7. Apply ε-DP to operator gradients before forwarding to FedAvg coordinator

## Decision loop (C++ pseudocode)
```cpp
while (running) {
    auto batch = fetch_all_agencies(config.endpoints);
    for (auto& point : batch) {
        if (!validate(point)) { dlq.push(point); continue; }
        auto row = normalise(point);
        row.hash = blake3(row);
        fabric.commit(row.hash, row.source_agency, row.clearance);
        duckdb.insert("sw_canonical", row);
        kafka.publish(row.clearance == 0 ? "sw.public" : "sw.operator", row);
    }
    sleep(config.cadence_ms);
}
```

## Fallback sequence (Ring 1)
NOAA → ESA HAPI → JAXA ERG → CNSA proxy → ISRO → vault snapshot → DuckDB cache

## Environment variables
```
GAUSS_SENSING_CADENCE_MS=5000
GAUSS_AIR_GAP=false
OPERATOR_VAULT_SYNC=true
FABRIC_PEER_URL=grpc://100.x.x.x:7051
KAFKA_BROKERS=localhost:9092
DUCKDB_PATH=./data/gauss.duckdb
```
