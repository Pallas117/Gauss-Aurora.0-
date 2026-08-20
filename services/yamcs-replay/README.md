# Yamcs replay boundary

This directory is a deterministic conformance fixture for the ground-side
Yamcs adapter. It does not vendor Yamcs or claim that a Yamcs server is running.
The Rust orchestrator owns CCSDS primary-header validation and the existing
XTCE/APID-map validation; `gauss-orchestrator::telemetry::yamcs` converts the
result into the versioned envelope in this fixture.

The intended local-first flow is:

1. Run the host cFS SIL application.
2. Replay CCSDS packets through the Rust orchestrator using the checked-in
   `config/xtce/baseline.xtce.xml` and `config/xtce/apid-map.json`.
3. Convert mapped packets to `gauss-yamcs-packet-v1`.
4. Post or stream that envelope to a locally deployed Yamcs instance.
5. Compare generation time, APID, sequence continuity, quality flags, and
   uncertainty during replay.

Yamcs deployment, authentication, archive configuration, and mission-specific
XTCE validation remain target integration work. Keep JSON at this ground
boundary; the cFS/onboard path remains fixed-size binary messages.
