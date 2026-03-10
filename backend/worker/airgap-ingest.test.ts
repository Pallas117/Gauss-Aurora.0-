import assert from "node:assert/strict";
import test from "node:test";
import { IngestionWorker } from "./ingest-loop.js";

test("air-gapped mode does not call external adapters and marks sources disabled", async () => {
  const originalAirGap = process.env.GAUSS_AIR_GAP;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const realFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (() => {
    fetchCalled = true;
    throw new Error("fetch should not be called in air-gapped ingest tick");
  }) as unknown as typeof fetch;

  process.env.GAUSS_AIR_GAP = "true";
  // Ensure Supabase is disabled for this test so no DB-related network calls occur.
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";

  try {
    const worker = new IngestionWorker(undefined, { skipMemoryCeiling: true });
    const result = await worker.tick();

    assert.equal(fetchCalled, false);
    assert.ok(result.canonicalPoint, "expected canonical point even when air-gapped");
    assert.ok(result.auroraMap, "expected aurora map even when air-gapped");
    assert.ok(
      (result.sourceStatus ?? []).every((s) => s.healthy === false && s.message === "disabled: air-gapped"),
      "expected all source statuses disabled in air-gapped mode",
    );
    assert.equal(result.canonicalPoint?.quality.stale, true);
    assert.equal(result.canonicalPoint?.quality.lowConfidence, true);
  } finally {
    globalThis.fetch = realFetch;
    if (originalAirGap === undefined) delete process.env.GAUSS_AIR_GAP;
    else process.env.GAUSS_AIR_GAP = originalAirGap;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
  }
});

