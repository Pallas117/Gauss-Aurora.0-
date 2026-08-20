import { getLatestCanonical, getSourceStatus, getExogenousContext } from "../state.js";

export interface PicoVizReport {
  timestamp: string;
  metadata: {
    system: Record<string, unknown>;
    exogenous: Record<string, unknown>;
  };
  content: string;
}

export async function generatePicoVizReport(): Promise<PicoVizReport> {
  const latest = getLatestCanonical();
  const sources = getSourceStatus();
  const exogenous = getExogenousContext();

  const unhealthy = sources.filter((s) => !s.healthy).length;
  const stormTier = latest?.alerts.stormTier ?? "unknown";

  // Visualizing the 3-layer redundancy status in the report content
  const redundancy = {
    layer1: latest ? "ACTIVE" : "MISSING",
    layer2: "ACTIVE", // PicoClaw itself
    layer3: process.env.GAUSS_BRAIN_URL ? "CONFIGURED" : "OFFLINE",
  };

  const report: PicoVizReport = {
    timestamp: new Date().toISOString(),
    metadata: {
      system: {
        unhealthySources: unhealthy,
        stormTier,
        redundancy,
      },
      exogenous: {
        geomagneticJerk: exogenous?.earthCore?.geomagneticJerkIndex ?? 0,
        cosmicRayFlux: exogenous?.solarSystem?.cosmicRayFlux ?? 0,
        schumannPower: exogenous?.earthCore?.schumannResonancePower ?? 0,
      },
    },
    content: `
Project Gauss: PicoClaw Multi-Layer Observability Report
======================================================
Status: ${stormTier.toUpperCase()} | Unhealthy Sources: ${unhealthy}
Redundancy: L1:${redundancy.layer1} | L2:${redundancy.layer2} | L3:${redundancy.layer3}

Electromagnetosphere & Exogenous Prior State:
---------------------------------------------
Earth-Core Geomagnetic Jerk: [${(exogenous?.earthCore?.geomagneticJerkIndex ?? 0).toFixed(4)}]
Schumann Resonance Power:    [${(exogenous?.earthCore?.schumannResonancePower ?? 0).toFixed(4)}]
Cosmic Ray MHD Flux:         [${(exogenous?.solarSystem?.cosmicRayFlux ?? 0).toFixed(4)}]
Heliosphere Compression:     [${(exogenous?.solarSystem?.heliosphereCompression ?? 0).toFixed(4)}]

Latest Deterministic Vector (MHD):
----------------------------------
Speed: ${latest?.solarWind.speed.toFixed(1)} km/s
Bz:    ${latest?.magneticField.bt.toFixed(2)} nT
`,
  };

  return report;
}
