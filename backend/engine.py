"""SpaceProbabilityEngine and supporting models.

This module provides a Python-native probability fusion engine for
threat assessment across collision, solar flare, cyber, and debris signals.
It is intentionally deterministic and lightweight for local/offline testing.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import erf, exp, sqrt
from typing import Any, Dict, Iterable, List, Optional, Tuple
from uuid import uuid4

import requests


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def logistic(z: float) -> float:
    """Numerically stable logistic transform for large-magnitude inputs."""
    if z >= 0:
        return 1.0 / (1.0 + exp(-z))
    ez = exp(z)
    return ez / (1.0 + ez)


def sigmoid(x: float, scale: float = 1.0, shift: float = 0.0) -> float:
    safe_scale = scale if abs(scale) > 1e-9 else 1.0
    return logistic((x - shift) / safe_scale)


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


def vnorm(vec: Iterable[float]) -> float:
    values = [float(v) for v in vec]
    return sqrt(sum(v * v for v in values))


@dataclass
class Factor:
    name: str
    weight: float
    value: float
    contribution: float
    unit: Optional[str] = None


@dataclass
class ThreatAssessment:
    threat_id: str
    threat_type: str
    probability: float
    confidence_interval: Tuple[float, float]
    factors: List[Factor]
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class FusedThreat:
    threat: ThreatAssessment
    composite_score: float
    actionable: bool
    recommended_action: str


class CollisionRiskModel:
    """Collision-risk estimate with optional external conjunction context."""

    def _fetch_space_track_fallback(self) -> Dict[str, Any]:
        """Best-effort fallback fetch. Network failures are tolerated."""
        try:
            response = requests.get(
                "https://example.com/space-track/mock",
                timeout=2,
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict):
                return payload
        except Exception:
            pass
        return {"objects": [], "historical_conjunction_rate": 0.02}

    def _confidence_interval(self, probability: float, uncertainty: float) -> Tuple[float, float]:
        spread = 0.08 + clamp01(uncertainty / 5.0) * 0.45
        lower = clamp01(probability - spread)
        upper = clamp01(probability + spread)
        if lower > upper:
            lower, upper = upper, lower
        return (lower, upper)

    def predict(self, orbital_state: Dict[str, Any], space_track: Optional[Dict[str, Any]] = None) -> ThreatAssessment:
        position = [float(v) for v in orbital_state.get("position", [7000.0, 0.0, 0.0])]
        velocity = [float(v) for v in orbital_state.get("velocity", [0.0, 7.5, 0.0])]
        pos_uncertainty = float(orbital_state.get("position_uncertainty", 0.15))

        catalogue = space_track or self._fetch_space_track_fallback()
        objects = catalogue.get("objects", []) if isinstance(catalogue, dict) else []

        min_distance = float("inf")
        for obj in objects:
            obj_pos = obj.get("position") if isinstance(obj, dict) else None
            if not isinstance(obj_pos, list) or len(obj_pos) < 3:
                continue
            distance = vnorm([position[i] - float(obj_pos[i]) for i in range(3)])
            if distance < min_distance:
                min_distance = distance

        if min_distance == float("inf"):
            synthetic_obj = [position[0] + 2.5, position[1] + 1.2, position[2] - 0.8]
            min_distance = vnorm([position[i] - synthetic_obj[i] for i in range(3)])

        relative_speed = vnorm(velocity)
        historical_rate = 0.02
        if isinstance(catalogue, dict):
            historical_rate = float(catalogue.get("historical_conjunction_rate", 0.02))

        factors = [
            Factor(
                name="Closing Velocity",
                weight=0.45,
                value=relative_speed,
                contribution=clamp01(sigmoid(relative_speed, 1.0, 0.5)),
                unit="km/s",
            ),
            Factor(
                name="Distance",
                weight=0.30,
                value=min_distance,
                contribution=clamp01(sigmoid(10.0 - min_distance, 5.0, 1.0)),
                unit="km",
            ),
            Factor(
                name="Position Uncertainty",
                weight=0.15,
                value=pos_uncertainty,
                contribution=clamp01(1.0 - (pos_uncertainty / 5.0)),
                unit="km",
            ),
            Factor(
                name="Historical Conjunction Rate",
                weight=0.10,
                value=historical_rate,
                contribution=clamp01(historical_rate / 0.5),
            ),
        ]

        probability = clamp01(sum(f.weight * f.contribution for f in factors))
        ci = self._confidence_interval(probability, pos_uncertainty)

        return ThreatAssessment(
            threat_id=str(uuid4()),
            threat_type="collision",
            probability=probability,
            confidence_interval=ci,
            factors=factors,
            metadata={"distance_km": min_distance, "relative_speed_kms": relative_speed},
        )


class SolarFlareModel:
    def _flare_contrib(self, value: float, threshold: float, scale: float) -> float:
        return clamp01(sigmoid(value, scale, threshold))

    def predict(self, solar_data: Dict[str, Any]) -> ThreatAssessment:
        complexity = float(solar_data.get("complexity", 3.0))
        magnetic_field = float(solar_data.get("magnetic_field", 200.0))
        history = float(solar_data.get("history", 0.1))

        factors = [
            Factor(
                name="Active Region Complexity",
                weight=0.50,
                value=complexity,
                contribution=self._flare_contrib(complexity, 3.0, 0.7),
            ),
            Factor(
                name="Magnetic Field Strength",
                weight=0.30,
                value=magnetic_field,
                contribution=self._flare_contrib(magnetic_field, 250.0, 25.0),
                unit="Gauss",
            ),
            Factor(
                name="Historical Flare Rate",
                weight=0.20,
                value=history,
                contribution=clamp01(history / 0.5),
            ),
        ]

        probability = clamp01(sum(f.weight * f.contribution for f in factors))
        ci = (clamp01(probability - 0.15), clamp01(probability + 0.15))

        return ThreatAssessment(
            threat_id=str(uuid4()),
            threat_type="solar_flare",
            probability=probability,
            confidence_interval=ci,
            factors=factors,
        )


class CyberAnomalyModel:
    def _anomaly_score(self, value: float, baseline: float, std: float) -> float:
        safe_std = std if std > 1e-9 else 1.0
        z = abs(value - baseline) / safe_std
        return clamp01(2.0 * normal_cdf(z) - 1.0)

    def predict(self, network_flows: Dict[str, Any]) -> ThreatAssessment:
        packet_rate = float(network_flows.get("packet_rate", 100.0))
        connection_attempts = float(network_flows.get("connection_attempts", 5.0))
        entropy = float(network_flows.get("entropy", 4.5))

        factors = [
            Factor(
                name="Packet Rate Anomaly",
                weight=0.40,
                value=packet_rate,
                contribution=self._anomaly_score(packet_rate, baseline=100.0, std=20.0),
            ),
            Factor(
                name="Connection Attempts",
                weight=0.35,
                value=connection_attempts,
                contribution=self._anomaly_score(connection_attempts, baseline=5.0, std=2.0),
            ),
            Factor(
                name="Traffic Entropy",
                weight=0.25,
                value=entropy,
                contribution=self._anomaly_score(entropy, baseline=4.5, std=0.3),
            ),
        ]

        probability = clamp01(sum(f.weight * f.contribution for f in factors))
        ci = (clamp01(probability - 0.10), clamp01(probability + 0.10))

        return ThreatAssessment(
            threat_id=str(uuid4()),
            threat_type="cyber",
            probability=probability,
            confidence_interval=ci,
            factors=factors,
        )


class DebrisRiskModel:
    def _debris_risk(self, distance: float, threshold: float) -> float:
        return clamp01(sigmoid(threshold - distance, scale=1.5, shift=0.0))

    def predict(self, orbital_state: Dict[str, Any], debris_catalogue: Dict[str, Any]) -> ThreatAssessment:
        position = [float(v) for v in orbital_state.get("position", [7000.0, 0.0, 0.0])]
        objects = debris_catalogue.get("objects", []) if isinstance(debris_catalogue, dict) else []

        min_distance = float("inf")
        for obj in objects:
            obj_pos = obj.get("position") if isinstance(obj, dict) else None
            if not isinstance(obj_pos, list) or len(obj_pos) < 3:
                continue
            distance = vnorm([position[i] - float(obj_pos[i]) for i in range(3)])
            if distance < min_distance:
                min_distance = distance

        if min_distance == float("inf"):
            min_distance = 1_000_000.0

        density = float(debris_catalogue.get("density", 0.01)) if isinstance(debris_catalogue, dict) else 0.01

        factors = [
            Factor(
                name="Distance to Debris",
                weight=0.60,
                value=min_distance,
                contribution=self._debris_risk(min_distance, threshold=5.0),
                unit="km",
            ),
            Factor(
                name="Debris Density",
                weight=0.40,
                value=density,
                contribution=clamp01(density / 0.1),
            ),
        ]

        probability = clamp01(sum(f.weight * f.contribution for f in factors))
        ci = (clamp01(probability - 0.12), clamp01(probability + 0.12))

        return ThreatAssessment(
            threat_id=str(uuid4()),
            threat_type="debris",
            probability=probability,
            confidence_interval=ci,
            factors=factors,
        )


class ProbabilityFusionEngine:
    """Combines model outputs into actionable threat priorities."""

    SEVERITY: Dict[str, float] = {
        "collision": 5.0,
        "solar_flare": 4.0,
        "cyber": 3.5,
        "debris": 3.0,
        "radiation": 2.5,
        "anomaly": 2.0,
    }

    def __init__(self) -> None:
        self.actionable_threshold = 0.6
        self._actionable_threshold = 0.6

        self._collision_model = CollisionRiskModel()
        self._flare_model = SolarFlareModel()
        self._cyber_model = CyberAnomalyModel()
        self._debris_model = DebrisRiskModel()

    def assess_all_threats(self, telemetry: Dict[str, Any], external_data: Dict[str, Any]) -> List[ThreatAssessment]:
        threats: List[ThreatAssessment] = []

        orbital = telemetry.get("orbital") if isinstance(telemetry, dict) else None
        network = telemetry.get("network") if isinstance(telemetry, dict) else None
        solar = external_data.get("solar") if isinstance(external_data, dict) else None
        debris = external_data.get("debris") if isinstance(external_data, dict) else None
        space_track = external_data.get("space_track") if isinstance(external_data, dict) else None

        if isinstance(orbital, dict):
            threats.append(self._collision_model.predict(orbital, space_track if isinstance(space_track, dict) else None))

        if isinstance(solar, dict):
            threats.append(self._flare_model.predict(solar))

        if isinstance(network, dict):
            threats.append(self._cyber_model.predict(network))

        if isinstance(orbital, dict) and isinstance(debris, dict):
            threats.append(self._debris_model.predict(orbital, debris))

        return threats

    def _recommend_action(self, threat_type: str, composite: float) -> str:
        if composite > 0.8:
            return f"IMMEDIATE {threat_type.upper()} EVASION"
        if composite > 0.5:
            return f"PREPARE {threat_type.upper()} COUNTERMEASURES"
        if composite > 0.2:
            return f"MONITOR {threat_type.upper()} CLOSELY"
        return f"LOG {threat_type.upper()} ONLY"

    def fuse_threats(self, threats: List[ThreatAssessment]) -> List[FusedThreat]:
        fused: List[FusedThreat] = []
        for threat in threats:
            severity = self.SEVERITY.get(threat.threat_type, 3.0)
            composite = clamp01(float(threat.probability) * (severity / 5.0))
            actionable = composite > self.actionable_threshold
            fused.append(
                FusedThreat(
                    threat=threat,
                    composite_score=composite,
                    actionable=actionable,
                    recommended_action=self._recommend_action(threat.threat_type, composite),
                )
            )

        fused.sort(key=lambda item: item.composite_score, reverse=True)
        return fused


class SpaceProbabilityEngine:
    """Facade consumed by API and tests."""

    def __init__(self) -> None:
        self.fusion_engine = ProbabilityFusionEngine()

    def assess_all_threats(self, telemetry: Dict[str, Any], external_data: Dict[str, Any]) -> List[ThreatAssessment]:
        return self.fusion_engine.assess_all_threats(telemetry, external_data)

    def assess(self, telemetry: Dict[str, Any], external_data: Dict[str, Any]) -> List[ThreatAssessment]:
        return self.assess_all_threats(telemetry, external_data)

    def assessAllThreats(self, telemetry: Dict[str, Any], external_data: Dict[str, Any]) -> List[ThreatAssessment]:
        return self.assess_all_threats(telemetry, external_data)

    def fuse_threats(self, threats: List[ThreatAssessment]) -> List[FusedThreat]:
        return self.fusion_engine.fuse_threats(threats)

    def fuse(self, threats: List[ThreatAssessment]) -> List[FusedThreat]:
        return self.fuse_threats(threats)

    def fuseThreats(self, threats: List[ThreatAssessment]) -> List[FusedThreat]:
        return self.fuse_threats(threats)

    def process_telemetry(self, telemetry: Dict[str, Any], external_data: Dict[str, Any]) -> Dict[str, Any]:
        assessments = self.assess_all_threats(telemetry, external_data)
        fused = self.fuse_threats(assessments)

        rows = [
            {
                "id": item.threat.threat_id,
                "type": item.threat.threat_type,
                "probability": float(item.threat.probability),
                "confidence_interval": list(item.threat.confidence_interval),
                "factors": [
                    {
                        "name": factor.name,
                        "weight": float(factor.weight),
                        "value": float(factor.value),
                        "contribution": float(factor.contribution),
                        "unit": factor.unit,
                    }
                    for factor in item.threat.factors
                ],
                "composite_score": float(item.composite_score),
                "actionable": bool(item.actionable),
                "recommended_action": item.recommended_action,
            }
            for item in fused
        ]
        return {"threats": rows}

    def processTelemetry(self, telemetry: Dict[str, Any], external_data: Dict[str, Any]) -> Dict[str, Any]:
        return self.process_telemetry(telemetry, external_data)


__all__ = [
    "Factor",
    "ThreatAssessment",
    "FusedThreat",
    "CollisionRiskModel",
    "SolarFlareModel",
    "CyberAnomalyModel",
    "DebrisRiskModel",
    "ProbabilityFusionEngine",
    "SpaceProbabilityEngine",
]
