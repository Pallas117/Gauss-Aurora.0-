# cFS, Yamcs, and ECC integration boundary

## Implemented in this iteration

- `services/cfs-gauss-mhd/` is a C11, fixed-memory cFS-shaped application
  boundary with a host software-in-the-loop test. It validates finite inputs,
  clamps the deterministic MHD fixture to bounded telemetry, and rejects bad
  samples without allocating memory.
- `gauss-orchestrator/src/telemetry/yamcs.rs` defines an explicit
  `gauss-yamcs-packet-v1` normalized envelope. The existing CCSDS and XTCE
  decoder remains upstream of this conversion.
- `services/yamcs-replay/fixtures/gauss-mhd-packets.jsonl` is a replay fixture
  for generation time, APID, sequence, quality, and uncertainty checks.
- `gauss-orchestrator/src/telemetry/ecc.rs` provides a self-contained SEC-DED
  Hamming(72,64) implementation and tests all 72 single-bit faults plus all
  2,556 two-bit combinations for detection.
- `gauss-orchestrator/src/telemetry/radiation.rs` and
  `config/radiation-envelope.schema.json` add a fail-closed radiation envelope
  gate. Stale, over-limit, unqualified, malformed, or unknown radiation data
  cannot authorize nominal action.

## Still required before flight use

1. Compile the cFS target adapter against the selected NASA cFS release and
   verify Software Bus message IDs, EVS events, scheduler timing, watchdog,
   tables, and command inhibition on the target processor.
2. Run a real Yamcs instance with mission XTCE, authentication, archive,
   replication, and replay tests. The checked-in fixture is not server evidence.
3. Replace the software ECC evidence with the selected processor/FPGA memory
   controller's radiation and fault-injection evidence. The codec protects
   software buffers and checkpoint records; it does not make COTS memory
   radiation hardened.
4. Populate the radiation envelope from independently reviewed environment,
   shielding, part-lot, TID, displacement-damage, and SEE test records.
5. Add hardware-in-the-loop, power-cycle, watchdog, link-loss, brownout,
   SEU/SEL, and model-checkpoint recovery tests.

The authoritative external references are NASA's radiation-hardness-assurance
guidelines and NEPP SEE/TID work, Yamcs' protocol and XTCE documentation, and
NASA cFS source and release artifacts. Open-source software interoperability is
not a qualification certificate.
