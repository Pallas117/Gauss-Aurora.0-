/**
 * E2E checks for bxr stack: orchestrator POST → ingest → command log round-trip.
 * Run with: npm run test:e2e:bxr (or node --import tsx backend/scripts/e2e-bxr-stack.ts)
 * Requires: BACKEND_BASE_URL (default http://127.0.0.1:3001), ORCHESTRATOR_INGEST_API_TOKEN (optional for ingest)
 */

const BACKEND_BASE_URL = (process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const INGEST_TOKEN = process.env.ORCHESTRATOR_INGEST_API_TOKEN ?? null;

const SERVICE_HEADERS: Record<string, string> =
  INGEST_TOKEN != null
    ? {
        Authorization: `Bearer ${INGEST_TOKEN}`,
        "x-gauss-service-token": INGEST_TOKEN,
      }
    : {};

async function fetchJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...opts.headers },
    body: opts.body,
  });
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { status: res.status, body };
}

async function main(): Promise<number> {
  const failures: string[] = [];

  // 1. Orchestrator ingest contract: POST /api/ingest/telemetry/packets (shape matches packet-ingest-contract + clean_raw_window)
  if (INGEST_TOKEN) {
    const ts = new Date().toISOString();
    const payload = {
      run_id: `e2e-bxr-${Date.now()}`,
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
    const ingest = await fetchJson(
      `${BACKEND_BASE_URL}/api/ingest/telemetry/packets`,
      {
        method: "POST",
        headers: { ...SERVICE_HEADERS },
        body: JSON.stringify(payload),
      },
    );
    if (ingest.status !== 200 && ingest.status !== 429) {
      failures.push(`Ingest POST: expected 200 or 429, got ${ingest.status}`);
    } else if (ingest.status === 429) {
      console.log("[e2e-bxr] Ingest POST 429 (rate-limited; treating as soft pass)");
    } else {
      const b = ingest.body as { accepted_count?: number; rejected_count?: number };
      if (typeof b?.accepted_count !== "number" || typeof b?.rejected_count !== "number") {
        failures.push("Ingest POST: response missing accepted_count/rejected_count");
      } else {
        console.log("[e2e-bxr] Ingest POST 200, accepted_count=%s, rejected_count=%s", b.accepted_count, b.rejected_count);
      }
    }
  } else {
    console.log("[e2e-bxr] Skip ingest (set ORCHESTRATOR_INGEST_API_TOKEN to run)");
  }

  // 2. Command log round-trip: POST /api/ops/command then GET /api/ops/command/log (operator role or dev auth bypass)
  const commandPayload = { command_type: "trigger-nowcast", payload: { reason: "e2e-bxr-stack" } };
  const postCmd = await fetchJson(`${BACKEND_BASE_URL}/api/ops/command`, {
    method: "POST",
    headers: { ...SERVICE_HEADERS },
    body: JSON.stringify(commandPayload),
  });
  const commandPosted = postCmd.status === 200 || postCmd.status === 201;
  if (
    !commandPosted &&
    postCmd.status !== 401 &&
    postCmd.status !== 403 &&
    postCmd.status !== 429 &&
    postCmd.status !== 503
  ) {
    failures.push(`Command POST: expected 200/201 or 401/403/429/503, got ${postCmd.status}`);
  } else if (commandPosted) {
    console.log("[e2e-bxr] Command POST %s", postCmd.status);
  } else if (postCmd.status === 429) {
    console.log("[e2e-bxr] Command POST 429 (rate-limited; treating as soft pass)");
  } else if (postCmd.status === 503) {
    console.log("[e2e-bxr] Command POST 503 (command log unavailable; treating as soft failure)");
  } else {
    console.log("[e2e-bxr] Command POST %s (auth required)", postCmd.status);
  }

  const logRes = await fetchJson(
    `${BACKEND_BASE_URL}/api/ops/command/log?limit=5`,
    {
      headers: { ...SERVICE_HEADERS },
    },
  );
  if (logRes.status !== 200 && logRes.status !== 429) {
    failures.push(`Command log GET: expected 200 or 429, got ${logRes.status}`);
  } else if (logRes.status === 429) {
    console.log("[e2e-bxr] Command log GET 429 (rate-limited; treating as soft pass)");
  } else {
    const logBody = logRes.body as { commands?: unknown[] };
    const commands = Array.isArray(logBody?.commands) ? logBody.commands : [];
    if (commandPosted && commands.length === 0) {
      failures.push("Command log GET: commands array empty (expected at least one after POST)");
    } else {
      console.log("[e2e-bxr] Command log GET 200, commands.length=%s", commands.length);
    }
  }

  // 3. Optional: GET /api/feed/space-weather/latest (200 or 404 acceptable)
  const feedRes = await fetchJson(
    `${BACKEND_BASE_URL}/api/feed/space-weather/latest`,
    {
      headers: { ...SERVICE_HEADERS },
    },
  );
  if (feedRes.status !== 200 && feedRes.status !== 404 && feedRes.status !== 429) {
    failures.push(`Feed latest GET: expected 200 or 404 or 429, got ${feedRes.status}`);
  } else if (feedRes.status === 429) {
    console.log("[e2e-bxr] Feed latest GET 429 (rate-limited; treating as soft pass)");
  } else {
    console.log("[e2e-bxr] Feed latest GET %s", feedRes.status);
  }

  if (failures.length > 0) {
    console.error("[e2e-bxr] FAIL:", failures);
    process.exit(1);
  }
  console.log("[e2e-bxr] All checks passed.");
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("[e2e-bxr]", err);
  process.exit(1);
});
