import assert from "node:assert/strict";
import test from "node:test";
import { fetchEsaReadout, getEsaStatus } from "./adapters/esa-hapi.js";
import { fetchJaxaReadout, getJaxaStatus } from "./adapters/jaxa-erg.js";
import { fetchMmsCdawebSamples, getMmsCdawebStatus } from "./adapters/mms-cdaweb.js";
import { fetchMmsBurstWindows, getMmsLaspStatus } from "./adapters/mms-lasp.js";
import { fetchNoaaReadout, getNoaaStatus } from "./adapters/noaa-swpc.js";
import { IngestionWorker } from "./worker/ingest-loop.js";

async function withOfflineFetch<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed: offline simulation");
  }) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("adapters degrade gracefully when upstream internet is unavailable", async () => {
  await withOfflineFetch(async () => {
    const noaa = await fetchNoaaReadout();
    const esa = await fetchEsaReadout();
    const jaxa = await fetchJaxaReadout();
    const mms = await fetchMmsCdawebSamples();
    const lasp = await fetchMmsBurstWindows();

    assert.equal(noaa, null);
    assert.equal(esa, null);
    assert.equal(jaxa, null);
    assert.deepEqual(mms, []);
    assert.deepEqual(lasp, []);

    assert.equal(getNoaaStatus().healthy, false);
    assert.equal(getEsaStatus().healthy, false);
    assert.equal(getJaxaStatus().healthy, false);
    assert.equal(getMmsCdawebStatus().healthy, false);
    assert.equal(getMmsLaspStatus().healthy, false);
  });
});

test("ingestion worker still emits canonical point and aurora map when offline", async () => {
  await withOfflineFetch(async () => {
    const worker = new IngestionWorker(undefined, { skipMemoryCeiling: true });
    const result = await worker.tick();

    assert.ok(result.canonicalPoint, "canonical point should still be computed");
    assert.equal(typeof result.canonicalPoint.timestamp, "string");
    assert.equal(result.canonicalPoint.source, "fusion");

    assert.equal(result.canonicalPoint.quality.stale, true);
    assert.equal(result.canonicalPoint.quality.interpolated, true);
    assert.equal(result.canonicalPoint.quality.lowConfidence, true);

    assert.ok(result.auroraMap.grid.length > 0, "aurora map should still be generated");
    assert.ok(result.sourceStatus.length >= 5, "source status should include configured upstreams");

    const noaaStatus = result.sourceStatus.find((item) => item.source === "noaa-swpc");
    assert.ok(noaaStatus);
    assert.equal(noaaStatus.healthy, false);
  });
});
