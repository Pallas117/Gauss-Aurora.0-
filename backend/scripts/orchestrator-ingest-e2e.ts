/**
 * Single check: POST one canonical packet to backend ingest (orchestrator contract).
 * Used by full-adherence-audit when ORCHESTRATOR_INGEST_API_TOKEN is set.
 * Exit 0 on success, 1 on failure. BACKEND_BASE_URL default http://127.0.0.1:3001.
 */

const BACKEND_BASE_URL = (process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const TOKEN = process.env.ORCHESTRATOR_INGEST_API_TOKEN ?? "";

async function main(): Promise<void> {
  if (!TOKEN.trim()) {
    console.error("ORCHESTRATOR_INGEST_API_TOKEN is required.");
    process.exit(1);
  }

  const ts = new Date().toISOString();
  const payload = {
    run_id: `audit-ingest-e2e-${Date.now()}`,
    source: "ccsds-orchestrator",
    format: "ccsds-bin" as const,
    dictionary_id: "gauss-baseline-v1",
    packets: [
      {
        timestamp: ts,
        apid: 900,
        seq_count: 1,
        payload_hex: "43E1400040E66666C0466666",
        canonical_point: {
          timestamp: ts,
          solarWind: { speed: 400, density: 5 },
          magneticField: { z: 0 },
        },
        quality_flags: { crc_checked: false, crc_valid: null, missing_parameters: false },
        uncertainty: { speed: { sigma: 8 }, density: { sigma: 0.6 }, bz: { sigma: 0.8 } },
      },
    ],
  };

  const res = await fetch(`${BACKEND_BASE_URL}/api/ingest/telemetry/packets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      "x-gauss-service-token": TOKEN,
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let body: { accepted_count?: number; rejected_count?: number } | null = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    console.error("Ingest response not JSON:", raw.slice(0, 200));
    process.exit(1);
  }

  if (res.status !== 200) {
    console.error(`Ingest POST: expected 200, got ${res.status}. Body: ${raw.slice(0, 300)}`);
    process.exit(1);
  }

  if (typeof body?.accepted_count !== "number" || typeof body?.rejected_count !== "number") {
    console.error("Ingest response missing accepted_count or rejected_count.");
    process.exit(1);
  }

  console.log(`OK: accepted_count=${body.accepted_count}, rejected_count=${body.rejected_count}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
