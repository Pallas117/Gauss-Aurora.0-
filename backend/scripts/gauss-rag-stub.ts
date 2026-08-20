/**
 * Gauss RAG stub: health check for the local RAG service.
 * If GAUSS_RAG_URL is not set, exits 0 with a skip notice.
 */

const RAG_URL = (process.env.GAUSS_RAG_URL ?? process.env.VITE_GAUSS_RAG_URL ?? "").trim().replace(/\/$/, "");

async function main(): Promise<void> {
  if (!RAG_URL) {
    console.log("[SKIP] GAUSS_RAG_URL not set — RAG stub skipped.");
    process.exit(0);
  }

  console.log(`[INFO] Gauss RAG stub: probing ${RAG_URL}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${RAG_URL}/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (res.ok) {
      console.log(`[PASS] Gauss RAG service healthy at ${RAG_URL}`);
      process.exit(0);
    }
    console.error(`[FAIL] Gauss RAG returned HTTP ${res.status}`);
    process.exit(1);
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[WARN] Gauss RAG unreachable at ${RAG_URL}: ${err instanceof Error ? err.message : String(err)}`);
    console.log("       Start with: npm run dev:rag");
    process.exit(0); // RAG is optional; warn but don't hard-fail
  }
}

void main();
