/**
 * Protocol conformance harness (GAUSS-COMP-004): validates orchestrator decode API output.
 * Sends a fixture (gauss-orchestrator/tests/fixtures/ccsds_valid.bin) to the decode API and
 * asserts response shape (packets with timestamp, apid). Skips when ORCHESTRATOR_DECODE_API_BIND is unset.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { decode } from "../decoder-registry.js";

const FIXTURE_REL = "gauss-orchestrator/tests/fixtures/ccsds_valid.bin";

function main(): void {
  const bind = (process.env.ORCHESTRATOR_DECODE_API_BIND ?? "").trim();
  if (!bind) {
    console.log("Protocol conformance skipped (ORCHESTRATOR_DECODE_API_BIND not set).");
    process.exit(0);
  }

  const root = process.cwd();
  const fixturePath = path.join(root, FIXTURE_REL);
  let raw: Buffer;
  try {
    raw = readFileSync(fixturePath);
  } catch (err) {
    console.error(`Fixture not found: ${fixturePath}`);
    process.exit(1);
  }

  decode(raw)
    .then((result) => {
      if (result.errors.length > 0 && result.packets.length === 0) {
        console.error("Conformance failed: orchestrator decode returned no packets:", result.errors);
        process.exit(1);
      }
      if (result.packets.length === 0) {
        console.error("Conformance failed: expected at least one decoded packet.");
        process.exit(1);
      }
      const first = result.packets[0]!;
      if (typeof first.timestamp !== "string" || first.timestamp.length === 0) {
        console.error("Conformance failed: first packet missing timestamp.");
        process.exit(1);
      }
      if (typeof first.apid !== "number") {
        console.error("Conformance failed: first packet missing apid.");
        process.exit(1);
      }
      console.log(
        `Protocol conformance OK: ${result.packets.length} packet(s), first apid=${first.apid} timestamp=${first.timestamp}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Conformance failed:", err);
      process.exit(1);
    });
}

main();
