/**
 * Surya-driven radiation visualization helpers.
 * Maps Surya forecast output to 3D scene visual activity and RadiationDataPoint[].
 * See docs/PLAN_SURYA_3D_LIVE_RADIATION.md and docs/SURYA_INTEGRATION.md.
 */

import type { RadiationDataPoint } from "@/lib/types/radiation";
import type { SuryaForecastResponse } from "@/hooks/useSuryaForecast";
import { withVisualizationPriority } from "@/lib/visual-priority";

/** Default LEO altitude (km) for Surya proxy points when no physical position is provided. */
const SURYA_PROXY_ALTITUDE_KM = 400;
/** Default L-shell for Surya proxy. */
const SURYA_PROXY_L_SHELL = 1.5;
/** Scale forecast value (0–1) to a plausible flux proxy for visualization. Documented in SURYA_INTEGRATION.md. */
const SURYA_VALUE_TO_FLUX_SCALE = 1e4;

const DEFAULT_ENERGY_RANGE = { min: 0.1, max: 10 };

/**
 * Compute a single [0, 1] activity value from Surya forecast (for blending into belt intensity etc.).
 * Uses mean of forecast values; when backend adds flare_probability_24h it can be used instead.
 */
export function suryaActivityFromResponse(
  data: SuryaForecastResponse | null
): number {
  if (!data?.forecast?.length) return 0;
  const sum = data.forecast.reduce((a, p) => a + p.value, 0);
  const mean = sum / data.forecast.length;
  return Math.max(0, Math.min(1, mean));
}

/**
 * Map Surya forecast time series to RadiationDataPoint[] for the 3D overlay.
 * Each forecast point becomes one proxy point at nominal LEO; value is scaled to a flux proxy.
 */
export function suryaForecastToRadiationPoints(
  data: SuryaForecastResponse | null
): RadiationDataPoint[] {
  if (!data?.forecast?.length) return [];
  return data.forecast.map((p) =>
    withVisualizationPriority({
      timestamp: p.time,
      flux: Math.max(0, p.value) * SURYA_VALUE_TO_FLUX_SCALE,
      altitude: SURYA_PROXY_ALTITUDE_KM,
      L_shell: SURYA_PROXY_L_SHELL,
      orbitType: "LEO" as const,
      particleType: "electron" as const,
      energyRange: DEFAULT_ENERGY_RANGE,
    }),
  );
}
