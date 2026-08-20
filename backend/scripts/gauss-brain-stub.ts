/**
 * Gauss Brain stub: health check and basic smoke test of the local LLM endpoint.
 * If GAUSS_BRAIN_URL is not set, exits 0 with a skip notice.
 * If set, pings /health or /v1/models and reports the result.
 */

const BRAIN_URL = (process.env.GAUSS_BRAIN_URL ?? "").trim().replace(/\/$/, "");

async function main(): Promise<void> {
  if (!BRAIN_URL) {
    console.log("[SKIP] GAUSS_BRAIN_URL not set — Gauss Brain stub skipped.");
    process.exit(0);
  }

  console.log(`[INFO] Gauss Brain stub: probing ${BRAIN_URL}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${BRAIN_URL}/v1/models`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (res.ok) {
      const body = await res.json() as Record<string, unknown>;
      console.log(`[PASS] Gauss Brain responded: ${JSON.stringify(body).slice(0, 200)}`);
      process.exit(0);
    }
    console.error(`[FAIL] Gauss Brain returned HTTP ${res.status}`);
    process.exit(1);
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[FAIL] Gauss Brain unreachable at ${BRAIN_URL}: ${err instanceof Error ? err.message : String(err)}`);
    console.log("       Start with: npm run dev:stack:mlx  (or set GAUSS_BRAIN_URL to your LLM server)");
    process.exit(1);
  }
}

void main();
