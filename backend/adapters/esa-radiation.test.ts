import assert from "node:assert/strict";
import test from "node:test";
import { fetchEsaRadiationReadout, getEsaRadiationStatus } from "./esa-radiation.js";

test("ESA radiation adapter reports explicit not-configured state", async () => {
  const previous = { token: process.env.ESA_SWE_HAPI_TOKEN, dataset: process.env.ESA_SWE_HAPI_DATASET };
  delete process.env.ESA_SWE_HAPI_TOKEN;
  delete process.env.ESA_SWE_HAPI_DATASET;
  try {
    assert.equal(await fetchEsaRadiationReadout(), null);
    assert.equal(getEsaRadiationStatus().healthy, false);
    assert.match(getEsaRadiationStatus().message ?? "", /not_configured/);
  } finally {
    if (previous.token === undefined) delete process.env.ESA_SWE_HAPI_TOKEN; else process.env.ESA_SWE_HAPI_TOKEN = previous.token;
    if (previous.dataset === undefined) delete process.env.ESA_SWE_HAPI_DATASET; else process.env.ESA_SWE_HAPI_DATASET = previous.dataset;
  }
});

test("ESA radiation adapter preserves configured dataset and energy labels", async () => {
  const previousFetch = globalThis.fetch;
  const previous = Object.fromEntries(["TOKEN", "DATASET", "TIME_PARAMETER", "PROTON_PARAMETER", "ELECTRON_PARAMETER", "PROTON_ENERGY", "ELECTRON_ENERGY"].map((suffix) => [`ESA_SWE_HAPI_${suffix}`, process.env[`ESA_SWE_HAPI_${suffix}`]]));
  process.env.ESA_SWE_HAPI_TOKEN = "test-token";
  process.env.ESA_SWE_HAPI_DATASET = "test-dataset";
  process.env.ESA_SWE_HAPI_TIME_PARAMETER = "utc";
  process.env.ESA_SWE_HAPI_PROTON_PARAMETER = "proton";
  process.env.ESA_SWE_HAPI_ELECTRON_PARAMETER = "electron";
  process.env.ESA_SWE_HAPI_PROTON_ENERGY = ">10 MeV";
  process.env.ESA_SWE_HAPI_ELECTRON_ENERGY = ">2 MeV";
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: [["2026-07-17T00:00:00Z", 12, 34]] }) })) as typeof fetch;
  try {
    const readout = await fetchEsaRadiationReadout();
    assert.equal(readout?.source, "esa-swe-ngrm");
    assert.equal(readout?.dataset, "test-dataset");
    assert.equal(readout?.protonFlux, 12);
    assert.equal(readout?.electronEnergy, ">2 MeV");
    assert.equal(getEsaRadiationStatus().healthy, true);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
