import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPacketIngestRequestContract,
  packetIngestRequestContract,
} from "./packet-ingest-contract.js";

test("packet ingest contract accepts valid payload", () => {
  const payload = {
    run_id: "run-001",
    source: "ccsds-orchestrator",
    format: "ccsds-bin",
    dictionary_id: "gauss-baseline-v1",
    packets: [
      {
        timestamp: "2026-02-23T00:00:00.000Z",
        apid: 900,
        seq_count: 42,
        payload_hex: "3F8000004000000000000000",
        canonical_point: {
          timestamp: "2026-02-23T00:00:00.000Z",
          solarWind: { speed: 400, density: 6 },
          magneticField: { z: -2.5 },
        },
        quality_flags: {
          crc_checked: false,
          crc_valid: null,
          missing_parameters: false,
        },
        uncertainty: {
          speed: { sigma: 8 },
          density: { sigma: 0.6 },
          bz: { sigma: 0.8 },
        },
      },
    ],
  };

  const parsed = assertPacketIngestRequestContract(payload);
  assert.equal(parsed.packets.length, 1);
  assert.equal(parsed.packets[0]?.apid, 900);
});

test("packet ingest contract rejects invalid APID and payload hex", () => {
  const payload = {
    run_id: "run-001",
    source: "ccsds-orchestrator",
    format: "ccsds-bin",
    dictionary_id: "gauss-baseline-v1",
    packets: [
      {
        timestamp: "2026-02-23T00:00:00.000Z",
        apid: 5000,
        seq_count: 42,
        payload_hex: "XYZ",
        canonical_point: {
          timestamp: "2026-02-23T00:00:00.000Z",
          solarWind: { speed: 400, density: 6 },
          magneticField: { z: -2.5 },
        },
        quality_flags: {
          crc_checked: true,
          crc_valid: false,
          missing_parameters: false,
        },
        uncertainty: {},
      },
    ],
  };

  const result = packetIngestRequestContract.safeParse(payload);
  assert.equal(result.success, false);
});
