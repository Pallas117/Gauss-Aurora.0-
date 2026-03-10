import { randomUUID } from "node:crypto";
import { clamp } from "../physics/coordinates.js";
import {
  clamp01,
  confidenceInterval,
  distance,
  magnitude,
  normalCdf,
  sigmoid,
} from "./probability-fusion-scoring.js";

export type ThreatType =
  | "collision"
  | "solar_flare"
  | "cyber"
  | "debris"
  | "radiation"
  | "anomaly";

export interface Factor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
  unit?: string;
}

export interface ThreatAssessment {
  threat_id: string;
  threat_type: ThreatType;
  probability: number;
  confidence_interval: [number, number];
  factors: Factor[];
  metadata?: Record<string, unknown>;
}

export interface FusedThreat {
  threat: ThreatAssessment;
  composite_score: number;
  actionable: boolean;
  recommended_action: string;
}

export interface OrbitalTelemetry {
  position: number[];
  velocity: number[];
  position_uncertainty?: number;
}

export interface NetworkTelemetry {
  packet_rate?: number;
  connection_attempts?: number;
  entropy?: number;
}

export interface TelemetryBundle {
  orbital?: OrbitalTelemetry;
  network?: NetworkTelemetry;
}

export interface SpaceTrackObject {
  position: number[];
  velocity?: number[];
}

export interface SolarExternalData {
  complexity?: number;
  magnetic_field?: number;
  history?: number;
}

export interface DebrisObject {
  position: number[];
}

export interface DebrisExternalData {
  objects?: DebrisObject[];
  density?: number;
}


export interface ExternalDataBundle {
  space_track?: {
    objects?: SpaceTrackObject[];
    historical_conjunction_rate?: number;
    max_probability_of_collision?: number;
    min_miss_distance_m?: number;
  };
  solar?: SolarExternalData;
  debris?: DebrisExternalData;
}

export interface ThreatResponseRow {
  id: string;
  type: ThreatType;
  probability: number;
  confidence_interval: [number, number];
  factors: Array<{
    name: string;
    weight: number;
    value: number;
    contribution: number;
    unit?: string;
  }>;
  composite_score: number;
  actionable: boolean;
  recommended_action: string;
}

export interface SpaceProbabilityResult {
  threats: ThreatResponseRow[];
}

class CollisionRiskModel {
  predict(
    orbitalState: OrbitalTelemetry,
    spaceTrack?: ExternalDataBundle["space_track"],
  ): ThreatAssessment {
    const pos = orbitalState.position ?? [0, 0, 0];
    const vel = orbitalState.velocity ?? [0, 0, 0];
    const posUncertainty = clamp(orbitalState.position_uncertainty ?? 0.1, 0.01, 2.5);

    let nearestDistance = Number.POSITIVE_INFINITY;
    let relativeSpeed = magnitude(vel);
    const trackObjects = spaceTrack?.objects ?? [];

    if (trackObjects.length > 0) {
      for (const obj of trackObjects) {
        const dist = distance(pos, obj.position ?? []);
        if (dist < nearestDistance) {
          nearestDistance = dist;
          const relVec = [
            Number(vel[0] ?? 0) - Number(obj.velocity?.[0] ?? 0),
            Number(vel[1] ?? 0) - Number(obj.velocity?.[1] ?? 0),
            Number(vel[2] ?? 0) - Number(obj.velocity?.[2] ?? 0),
          ];
          relativeSpeed = magnitude(relVec);
        }
      }
    } else {
      const syntheticObject = [
        Number(pos[0] ?? 0) + 24,
        Number(pos[1] ?? 0) - 12,
        Number(pos[2] ?? 0) + 8,
      ];
      nearestDistance = distance(pos, syntheticObject);
    }

    const historicalRate = clamp(spaceTrack?.historical_conjunction_rate ?? 0.02, 0, 1);
    const hasReportedCollisionProbability = spaceTrack?.max_probability_of_collision != null;
    const hasReportedMissDistance = spaceTrack?.min_miss_distance_m != null;
    const hasDirectConjunctionEvidence =
      hasReportedCollisionProbability || hasReportedMissDistance;
    const reportedCollisionProbability = clamp(
      spaceTrack?.max_probability_of_collision ?? 0,
      0,
      1,
    );
    const reportedMissDistanceM = clamp(
      spaceTrack?.min_miss_distance_m ?? 50_000,
      0,
      2_000_000,
    );
    const factors: Factor[] = [
      {
        name: "Closing Velocity",
        weight: hasDirectConjunctionEvidence ? 0.2 : 0.45,
        value: relativeSpeed,
        contribution: sigmoid(relativeSpeed, 0.8, 0.35),
        unit: "km/s",
      },
      {
        name: "Distance",
        weight: hasDirectConjunctionEvidence ? 0.1 : 0.3,
        value: nearestDistance,
        contribution: sigmoid(12 - nearestDistance, 3.5, 1.0),
        unit: "km",
      },
      {
        name: "Position Uncertainty",
        weight: hasDirectConjunctionEvidence ? 0.08 : 0.15,
        value: posUncertainty,
        contribution: 1 - clamp01(posUncertainty / 5),
        unit: "km",
      },
      {
        name: "Historical Conjunction Rate",
        weight: hasDirectConjunctionEvidence ? 0.07 : 0.1,
        value: historicalRate,
        contribution: clamp(historicalRate / 0.4, 0, 1),
      },
    ];

    if (hasReportedCollisionProbability) {
      factors.push({
        name: "Reported Collision Probability",
        weight: hasReportedMissDistance ? 0.35 : 0.55,
        value: reportedCollisionProbability,
        contribution: clamp(reportedCollisionProbability / 0.01, 0, 1),
      });
    }

    if (hasReportedMissDistance) {
      factors.push({
        name: "Reported Miss Distance",
        weight: hasReportedCollisionProbability ? 0.2 : 0.55,
        value: reportedMissDistanceM,
        contribution: sigmoid((10_000 - reportedMissDistanceM) / 1000, 1.4, 0),
        unit: "m",
      });
    }

    const totalWeight = factors.reduce((acc, factor) => acc + factor.weight, 0);

    const probability = clamp(
      factors.reduce((acc, factor) => acc + factor.weight * factor.contribution, 0) /
        Math.max(totalWeight, 1e-6),
      0.01,
      0.99,
    );
    const ci = confidenceInterval(probability, clamp(posUncertainty / 2.5, 0, 1), 0.9);

    return {
      threat_id: randomUUID(),
      threat_type: "collision",
      probability,
      confidence_interval: ci,
      factors,
    };
  }
}

class SolarFlareModel {
  predict(solarData: SolarExternalData): ThreatAssessment {
    const complexity = Number(solarData.complexity ?? 3);
    const magneticField = Number(solarData.magnetic_field ?? 200);
    const history = clamp(Number(solarData.history ?? 0.1), 0, 1);

    const factors: Factor[] = [
      {
        name: "Active Region Complexity",
        weight: 0.5,
        value: complexity,
        contribution: sigmoid(complexity, 0.8, 3.0),
      },
      {
        name: "Magnetic Field Strength",
        weight: 0.3,
        value: magneticField,
        contribution: sigmoid(magneticField, 70, 250),
        unit: "Gauss",
      },
      {
        name: "Historical Flare Rate",
        weight: 0.2,
        value: history,
        contribution: clamp(history / 0.5, 0, 1),
      },
    ];

    const probability = clamp(
      factors.reduce((acc, factor) => acc + factor.weight * factor.contribution, 0),
      0.01,
      0.99,
    );
    return {
      threat_id: randomUUID(),
      threat_type: "solar_flare",
      probability,
      confidence_interval: confidenceInterval(probability, 0.15, 0.9),
      factors,
    };
  }
}

class CyberAnomalyModel {
  predict(networkFlows: NetworkTelemetry): ThreatAssessment {
    const packetRate = Number(networkFlows.packet_rate ?? 100);
    const connectionAttempts = Number(networkFlows.connection_attempts ?? 5);
    const entropy = Number(networkFlows.entropy ?? 4.5);

    const factors: Factor[] = [
      {
        name: "Packet Rate Anomaly",
        weight: 0.4,
        value: packetRate,
        contribution: this.anomalyScore(packetRate, 100, 20),
      },
      {
        name: "Connection Attempts",
        weight: 0.35,
        value: connectionAttempts,
        contribution: this.anomalyScore(connectionAttempts, 5, 2),
      },
      {
        name: "Traffic Entropy",
        weight: 0.25,
        value: entropy,
        contribution: this.anomalyScore(entropy, 4.5, 0.3),
      },
    ];

    const probability = clamp(
      factors.reduce((acc, factor) => acc + factor.weight * factor.contribution, 0),
      0.01,
      0.99,
    );
    return {
      threat_id: randomUUID(),
      threat_type: "cyber",
      probability,
      confidence_interval: confidenceInterval(probability, 0.1, 0.9),
      factors,
    };
  }

  private anomalyScore(value: number, baseline: number, std: number): number {
    const safeStd = std > 1e-8 ? std : 1e-8;
    const z = Math.abs(value - baseline) / safeStd;
    return clamp(2 * normalCdf(z, 0, 1) - 1, 0, 1);
  }
}

class DebrisRiskModel {
  predict(orbitalState: OrbitalTelemetry, debrisCatalogue: DebrisExternalData): ThreatAssessment {
    const pos = orbitalState.position ?? [0, 0, 0];
    const objects = debrisCatalogue.objects ?? [];
    let minDist = Number.POSITIVE_INFINITY;

    for (const object of objects) {
      const dist = distance(pos, object.position ?? []);
      if (dist < minDist) {
        minDist = dist;
      }
    }
    if (!Number.isFinite(minDist)) {
      minDist = 25;
    }

    const density = clamp(Number(debrisCatalogue.density ?? 0.01), 0, 1);
    const factors: Factor[] = [
      {
        name: "Distance to Debris",
        weight: 0.6,
        value: minDist,
        contribution: sigmoid(-(minDist - 5), 1.5, 0),
      },
      {
        name: "Debris Density",
        weight: 0.4,
        value: density,
        contribution: clamp(density / 0.1, 0, 1),
      },
    ];

    const probability = clamp(
      factors.reduce((acc, factor) => acc + factor.weight * factor.contribution, 0),
      0.01,
      0.99,
    );
    return {
      threat_id: randomUUID(),
      threat_type: "debris",
      probability,
      confidence_interval: confidenceInterval(probability, 0.12, 0.9),
      factors,
    };
  }
}

export class ProbabilityFusionEngine {
  static readonly SEVERITY: Record<ThreatType, number> = {
    collision: 5,
    solar_flare: 4,
    cyber: 3.5,
    debris: 3,
    radiation: 2.5,
    anomaly: 2,
  };

  private readonly collisionModel = new CollisionRiskModel();
  private readonly flareModel = new SolarFlareModel();
  private readonly cyberModel = new CyberAnomalyModel();
  private readonly debrisModel = new DebrisRiskModel();

  constructor(private readonly actionableThreshold = 0.6) {}

  assessAllThreats(telemetry: TelemetryBundle, externalData: ExternalDataBundle): ThreatAssessment[] {
    const threats: ThreatAssessment[] = [];

    if (telemetry.orbital) {
      threats.push(this.collisionModel.predict(telemetry.orbital, externalData.space_track));
    }
    if (externalData.solar) {
      threats.push(this.flareModel.predict(externalData.solar));
    }
    if (telemetry.network) {
      threats.push(this.cyberModel.predict(telemetry.network));
    }
    if (telemetry.orbital && externalData.debris) {
      threats.push(this.debrisModel.predict(telemetry.orbital, externalData.debris));
    }

    return threats;
  }

  fuseThreats(threats: ThreatAssessment[]): FusedThreat[] {
    const fused = threats.map((threat) => {
      const severity = ProbabilityFusionEngine.SEVERITY[threat.threat_type] ?? 3;
      const composite = clamp01(threat.probability * (severity / 5));
      const actionable = composite > this.actionableThreshold;
      return {
        threat,
        composite_score: composite,
        actionable,
        recommended_action: this.recommendAction(threat.threat_type, composite),
      };
    });

    fused.sort((a, b) => b.composite_score - a.composite_score);
    return fused;
  }

  private recommendAction(threatType: ThreatType, composite: number): string {
    if (composite > 0.8) return `IMMEDIATE ${threatType.toUpperCase()} EVASION`;
    if (composite > 0.5) return `PREPARE ${threatType.toUpperCase()} COUNTERMEASURES`;
    if (composite > 0.2) return `MONITOR ${threatType.toUpperCase()} CLOSELY`;
    return `LOG ${threatType.toUpperCase()} ONLY`;
  }
}

export class SpaceProbabilityEngine {
  readonly fusionEngine: ProbabilityFusionEngine;

  constructor(options?: { actionableThreshold?: number }) {
    this.fusionEngine = new ProbabilityFusionEngine(options?.actionableThreshold);
  }

  assess(telemetry: TelemetryBundle, externalData: ExternalDataBundle): ThreatAssessment[] {
    return this.fusionEngine.assessAllThreats(telemetry, externalData);
  }

  fuse(threats: ThreatAssessment[]): FusedThreat[] {
    return this.fusionEngine.fuseThreats(threats);
  }

  processTelemetry(telemetry: TelemetryBundle, externalData: ExternalDataBundle): SpaceProbabilityResult {
    const assessments = this.assess(telemetry, externalData);
    const fused = this.fuse(assessments);

    return {
      threats: fused.map((item) => ({
        id: item.threat.threat_id,
        type: item.threat.threat_type,
        probability: item.threat.probability,
        confidence_interval: item.threat.confidence_interval,
        factors: item.threat.factors.map((factor) => ({
          name: factor.name,
          weight: factor.weight,
          value: factor.value,
          contribution: factor.contribution,
          unit: factor.unit,
        })),
        composite_score: item.composite_score,
        actionable: item.actionable,
        recommended_action: item.recommended_action,
      })),
    };
  }
}
