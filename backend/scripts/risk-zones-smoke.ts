/**
 * Risk-zones API smoke: GET /api/ssa/risk-zones and assert response shape.
 * Skips when BACKEND_BASE_URL is unset so CI can run only when the backend is available.
 * See docs/DEBRIS_RISK_3D.md.
 */

const baseUrl = (process.env.BACKEND_BASE_URL ?? "").trim();
if (!baseUrl) {
  console.log("Risk-zones smoke skipped (BACKEND_BASE_URL not set).");
  process.exit(0);
}

const url = `${baseUrl.replace(/\/$/, "")}/api/ssa/risk-zones`;

fetch(url, { signal: AbortSignal.timeout(10_000) })
  .then((res) => {
    if (!res.ok) {
      console.error(`Risk-zones smoke failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    return res.json() as Promise<{ riskZones?: unknown[]; updatedAt?: string }>;
  })
  .then((data) => {
    if (!Array.isArray(data.riskZones)) {
      console.error("Risk-zones smoke failed: response missing riskZones array.");
      process.exit(1);
    }
    console.log(
      `Risk-zones smoke OK: ${data.riskZones.length} zone(s)${data.updatedAt ? `, updatedAt=${data.updatedAt}` : ""}`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("Risk-zones smoke failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
