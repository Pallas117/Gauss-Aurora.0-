/**
 * Lightweight physics refinement for canonical telemetry packets.
 * Bounds aligned with mhd-nowcast and orchestrator physics_validation.
 * Used by POST /api/ingest/telemetry/refine (no LLM, < 500 ms).
 */

const SPEED_MIN = 250;
const SPEED_MAX = 2000;
const DENSITY_MIN = 0.01;
const DENSITY_MAX = 1000;
const BZ_MIN = -100;
const BZ_MAX = 100;

function clamp(v: number, minV: number, maxV: number): number {
  if (v !== v || v === Infinity || v === -Infinity) return minV;
  return Math.min(maxV, Math.max(minV, v));
}

export interface CanonicalPacketLike {
  timestamp: string;
  apid: number;
  seq_count: number;
  payload_hex: string;
  canonical_point: {
    timestamp: string;
    solarWind: { speed: number; density: number };
    magneticField: { z: number };
  };
  quality_flags: Record<string, unknown>;
  uncertainty: Record<string, unknown>;
}

export interface RefineResult {
  packets: CanonicalPacketLike[];
  clamped_count: number;
  interpolated_count: number;
}

export function refineCanonicalPackets(packets: CanonicalPacketLike[]): RefineResult {
  let clamped_count = 0;
  const out: CanonicalPacketLike[] = [];

  for (const p of packets) {
    const cp = p.canonical_point;
    const sw = cp.solarWind;
    const mf = cp.magneticField;
    const rawSpeed = Number(sw.speed);
    const rawDensity = Number(sw.density);
    const rawBz = Number(mf.z);

    const speed = clamp(rawSpeed, SPEED_MIN, SPEED_MAX);
    const density = clamp(rawDensity, DENSITY_MIN, DENSITY_MAX);
    const bz = clamp(rawBz, BZ_MIN, BZ_MAX);

    if (
      speed !== rawSpeed ||
      density !== rawDensity ||
      bz !== rawBz
    ) {
      clamped_count += 1;
    }

    out.push({
      ...p,
      canonical_point: {
        ...cp,
        solarWind: { ...sw, speed, density },
        magneticField: { ...mf, z: bz },
      },
    });
  }

  return {
    packets: out,
    clamped_count,
    interpolated_count: 0,
  };
}
