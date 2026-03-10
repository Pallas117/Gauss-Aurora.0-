"""Geometric morphing matcher for SDA integrity checks.

This module compares live geometry against nominal geometry to detect
physical anomalies such as damage, docking shifts, or debris impacts.
"""

from __future__ import annotations

import math
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

try:
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover - optional acceleration path
    np = None


Vertex = Tuple[float, float, float]
VertexSequence = Sequence[Sequence[float]] | Sequence[float]


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


class GeometricMorphMatcher:
    """Pattern matcher using geometric morph deltas.

    Notes:
    - Uses RMS of per-vertex Euclidean distance as a fast proxy metric.
    - Default tolerance is absolute geometry units (not percent normalized).
    - Nominal meshes can be registered per asset for repeated audits.
    """

    def __init__(self, tolerance: float = 0.05):
        if tolerance <= 0:
            raise ValueError("tolerance must be > 0")
        self.tolerance = float(tolerance)
        self._nominal_meshes: Dict[str, List[Vertex]] = {}

    def register_nominal_mesh(self, asset_id: str, nominal_vertices: VertexSequence) -> None:
        """Register/update nominal geometry for an asset."""

        if not asset_id or not asset_id.strip():
            raise ValueError("asset_id is required")
        self._nominal_meshes[asset_id] = self._normalize_vertices(nominal_vertices)

    def calculate_morph_delta(
        self,
        nominal_vertices: VertexSequence,
        live_vertices: VertexSequence,
    ) -> float:
        """Calculate RMS morph delta between nominal and live geometries.

        Delta = sqrt(mean(||live_i - nominal_i||^2))
        """

        if np is not None:
            nominal_arr = self._as_numpy_vertices(nominal_vertices)
            live_arr = self._as_numpy_vertices(live_vertices)
            if nominal_arr.shape != live_arr.shape:
                raise ValueError(
                    f"shape mismatch: nominal={nominal_arr.shape} live={live_arr.shape}"
                )
            per_vertex = np.linalg.norm(live_arr - nominal_arr, axis=1)
            return float(math.sqrt(float(np.mean(np.square(per_vertex)))))

        nominal = self._normalize_vertices(nominal_vertices)
        live = self._normalize_vertices(live_vertices)
        if len(nominal) != len(live):
            raise ValueError(f"vertex count mismatch: nominal={len(nominal)} live={len(live)}")

        squared = 0.0
        for (nx, ny, nz), (lx, ly, lz) in zip(nominal, live):
            dx = lx - nx
            dy = ly - ny
            dz = lz - nz
            squared += dx * dx + dy * dy + dz * dz
        return math.sqrt(squared / max(len(nominal), 1))

    def audit_physical_integrity(
        self,
        asset_id: str,
        live_data: VertexSequence,
        nominal_vertices: Optional[VertexSequence] = None,
    ) -> dict:
        """Audit one asset and classify geometric integrity.

        Resolution order for nominal state:
        1. explicit `nominal_vertices` argument
        2. registered nominal mesh for `asset_id`
        3. fallback singleton [1.0, 1.0, 1.0]
        """

        if nominal_vertices is not None:
            nominal = nominal_vertices
        elif asset_id in self._nominal_meshes:
            nominal = self._nominal_meshes[asset_id]
        else:
            nominal = [1.0, 1.0, 1.0]

        delta = self.calculate_morph_delta(nominal, live_data)
        is_anomalous = delta > self.tolerance
        ratio = delta / self.tolerance

        if is_anomalous:
            # Confidence in anomaly rises as delta moves past threshold.
            confidence = _clamp((ratio - 1.0) / 1.5, 0.0, 1.0)
        else:
            # Confidence in nominal state decays near threshold.
            confidence = _clamp(1.0 - ratio, 0.0, 1.0)

        return {
            "asset": asset_id,
            "morph_delta": round(delta, 6),
            "threshold": self.tolerance,
            "delta_ratio": round(ratio, 6),
            "status": "ANOMALY_DETECTED" if is_anomalous else "GEOMETRY_NOMINAL",
            "confidence": round(confidence, 6),
        }

    @staticmethod
    def _normalize_vertices(vertices: VertexSequence) -> List[Vertex]:
        """Normalize input to a list of 3D vertices."""

        if isinstance(vertices, Sequence) and len(vertices) > 0 and not isinstance(vertices[0], Sequence):  # type: ignore[index]
            if len(vertices) != 3:
                raise ValueError("single-vertex input must have length 3")
            x, y, z = vertices  # type: ignore[misc]
            return [(float(x), float(y), float(z))]

        output: List[Vertex] = []
        for row in vertices:  # type: ignore[assignment]
            if not isinstance(row, Sequence) or len(row) != 3:
                raise ValueError("vertex rows must each contain exactly 3 values")
            output.append((float(row[0]), float(row[1]), float(row[2])))

        if len(output) == 0:
            raise ValueError("vertices cannot be empty")
        return output

    @staticmethod
    def _as_numpy_vertices(vertices: VertexSequence):
        """Convert vertices to numpy matrix (N,3)."""

        arr = np.asarray(vertices, dtype=float)  # type: ignore[union-attr]
        if arr.ndim == 1:
            if arr.shape[0] != 3:
                raise ValueError("single-vertex input must have length 3")
            arr = arr.reshape(1, 3)
        elif arr.ndim == 2:
            if arr.shape[1] != 3:
                raise ValueError("vertex rows must each contain exactly 3 values")
        else:
            raise ValueError("vertices must be 1D or 2D")
        if arr.shape[0] == 0:
            raise ValueError("vertices cannot be empty")
        return arr


if __name__ == "__main__":
    matcher = GeometricMorphMatcher()
    result = matcher.audit_physical_integrity("CubeSat-01", [1.02, 0.98, 1.08])
    print(f"[MORPH_AUDIT] {result}")
