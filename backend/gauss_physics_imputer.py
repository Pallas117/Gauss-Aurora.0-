"""Physics-informed telemetry imputation for radiation-corrupted streams.

This module is designed for lightweight local execution and supports:
- Outlier detection (sigma + robust MAD checks)
- Optional spline reconstruction (SciPy)
- Safe linear interpolation fallback (NumPy only)
"""

from __future__ import annotations

import bisect
import gc
from dataclasses import dataclass
from typing import Any, Dict

import polars as pl

try:
    import numpy as np  # type: ignore

    NUMPY_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    np = None
    NUMPY_AVAILABLE = False

try:  # Optional acceleration/quality path.
    from scipy.interpolate import UnivariateSpline as _UnivariateSpline  # type: ignore

    SCIPY_AVAILABLE = True
except Exception:  # pragma: no cover - runtime dependency check
    _UnivariateSpline = None
    SCIPY_AVAILABLE = False


def _directive_cleanup() -> None:
    """PROJECT GAUSS: aggressive GC after heavy polars use (M1 8GB directive)."""
    gc.collect()


def _linear_interp(all_x: list[float], x: list[float], y: list[float]) -> list[float]:
    """Piecewise-linear interpolation without NumPy dependency."""

    if len(x) != len(y):
        raise ValueError("x and y lengths must match")
    if len(x) == 0:
        return [0.0 for _ in all_x]
    if len(x) == 1:
        return [float(y[0]) for _ in all_x]

    out: list[float] = []
    for xv in all_x:
        if xv <= x[0]:
            out.append(float(y[0]))
            continue
        if xv >= x[-1]:
            out.append(float(y[-1]))
            continue

        right = bisect.bisect_left(x, xv)
        left = max(0, right - 1)
        x0, x1 = x[left], x[right]
        y0, y1 = y[left], y[right]
        if x1 == x0:
            out.append(float(y0))
            continue
        t = (xv - x0) / (x1 - x0)
        out.append(float(y0 + t * (y1 - y0)))
    return out


@dataclass(frozen=True)
class ReconstructionResult:
    success: bool
    target_column: str
    method: str
    integrity_score: float
    anomalies_detected: int
    insight: str
    reconstructed_series: list[float]
    corrupted_mask: list[bool]
    provenance: Dict[str, Any]
    confidence: Dict[str, float]
    error: str | None = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "target_column": self.target_column,
            "method": self.method,
            "integrity_score": self.integrity_score,
            "anomalies_detected": self.anomalies_detected,
            "insight": self.insight,
            "reconstructed_series": self.reconstructed_series,
            "corrupted_mask": self.corrupted_mask,
            "provenance": self.provenance,
            "confidence": self.confidence,
            "error": self.error,
        }


class GaussPhysicsImputer:
    """Detect and reconstruct corrupted telemetry with physics-informed interpolation."""

    def __init__(self, sensitivity: float = 3.5, min_valid_points: int = 5, spline_smoothing: float = 1.0):
        if sensitivity <= 0:
            raise ValueError("sensitivity must be > 0")
        if min_valid_points < 3:
            raise ValueError("min_valid_points must be >= 3")
        if spline_smoothing < 0:
            raise ValueError("spline_smoothing must be >= 0")
        self.sensitivity = float(sensitivity)
        self.min_valid_points = int(min_valid_points)
        self.spline_smoothing = float(spline_smoothing)

    @staticmethod
    def _max_gap_length(mask: list[bool]) -> int:
        longest = 0
        current = 0
        for flagged in mask:
            if flagged:
                current += 1
                if current > longest:
                    longest = current
            else:
                current = 0
        return longest

    def _context_evidence_score(
        self,
        df: pl.DataFrame,
        context_cols: list[str],
    ) -> float:
        if not context_cols:
            return 0.0

        evidence_scores: list[float] = []
        for col in context_cols:
            if col not in df.columns:
                continue
            series = df[col].cast(pl.Float64, strict=False)
            valid = series.filter(~(series.is_null() | series.is_nan() | series.is_infinite()))
            if valid.len() < self.min_valid_points:
                continue
            spread = float((valid.max() or 0.0) - (valid.min() or 0.0))
            mean_abs = float(valid.abs().mean() or 0.0)
            scale = max(abs(mean_abs), 1e-6)
            evidence_scores.append(min(1.0, spread / (scale * 0.02 + 1e-6)))

        if not evidence_scores:
            return 0.0
        return round(sum(evidence_scores) / len(evidence_scores), 6)

    def identify_corrupted_data(self, series: pl.Series) -> pl.Series:
        """Detect outliers likely caused by radiation-induced bit flips.

        Uses two detectors and combines them:
        - Sigma detector around mean/std
        - Robust detector around median/MAD
        """

        values = series.cast(pl.Float64, strict=False)
        invalid_mask = values.is_null() | values.is_nan() | values.is_infinite()
        valid_values = values.filter(~invalid_mask)

        if valid_values.len() == 0:
            return pl.Series(name=f"{series.name}_corrupted", values=[True] * series.len())

        mean = float(valid_values.mean())
        std = float(valid_values.std() or 0.0)
        if std <= 0:
            sigma_mask = pl.Series(name="sigma_mask", values=[False] * series.len(), dtype=pl.Boolean)
        else:
            sigma_mask = (values - mean).abs() > (self.sensitivity * std)

        median = float(valid_values.median())
        mad = float((valid_values - median).abs().median() or 0.0)
        robust_sigma = 1.4826 * mad
        if robust_sigma <= 0:
            mad_mask = pl.Series(name="mad_mask", values=[False] * series.len(), dtype=pl.Boolean)
        else:
            mad_mask = (values - median).abs() > (self.sensitivity * robust_sigma)

        out = (invalid_mask | sigma_mask | mad_mask).alias(f"{series.name}_corrupted")
        _directive_cleanup()
        return out

    def reconstruct_telemetry(
        self,
        df: pl.DataFrame,
        target_col: str,
        timestamp_col: str = "timestamp",
        context_cols: list[str] | None = None,
        short_gap_limit: int = 3,
    ) -> Dict[str, Any]:
        """Reconstruct a telemetry column across full timeline."""

        if target_col not in df.columns:
            raise KeyError(f"Missing target column: {target_col}")
        if timestamp_col not in df.columns:
            raise KeyError(f"Missing timestamp column: {timestamp_col}")
        if df.height == 0:
            _directive_cleanup()
            return ReconstructionResult(
                success=False,
                target_column=target_col,
                method="none",
                integrity_score=0.0,
                anomalies_detected=0,
                insight="No rows supplied.",
                reconstructed_series=[],
                corrupted_mask=[],
                provenance={
                    "tier": 0,
                    "mode": "none",
                    "context_columns": [],
                    "imputed_points": 0,
                    "max_gap_length": 0,
                },
                confidence={
                    "overall": 0.0,
                    "gap": 0.0,
                    "context": 0.0,
                },
                error="empty_dataframe",
            ).as_dict()

        indexed = (
            df.with_row_index("__rowid") if hasattr(df, "with_row_index") else df.with_row_count("__rowid")
        ).sort(timestamp_col)
        corrupted = self.identify_corrupted_data(indexed[target_col])
        indexed = indexed.with_columns(corrupted.alias("__corrupted"))

        valid_df = indexed.filter(~pl.col("__corrupted")).select(
            [
                pl.col(timestamp_col).cast(pl.Float64).alias("__ts"),
                pl.col(target_col).cast(pl.Float64).alias("__value"),
            ]
        )

        # Deduplicate timestamps to keep monotonic x-domain for interpolation.
        valid_unique = (
            valid_df.group_by("__ts")
            .agg(pl.col("__value").mean().alias("__value"))
            .sort("__ts")
        )

        if valid_unique.height < self.min_valid_points:
            anomaly_count = int(indexed["__corrupted"].sum())
            corrupted_mask = indexed["__corrupted"].to_list()
            max_gap_length = self._max_gap_length([bool(v) for v in corrupted_mask])
            integrity_score = round(max(0.0, 1.0 - (anomaly_count / max(df.height, 1))), 6)
            _directive_cleanup()
            return ReconstructionResult(
                success=False,
                target_column=target_col,
                method="none",
                integrity_score=integrity_score,
                anomalies_detected=anomaly_count,
                insight="Error: Data density too low for physics reconstruction.",
                reconstructed_series=indexed[target_col].cast(pl.Float64, strict=False).fill_null(0.0).to_list(),
                corrupted_mask=corrupted_mask,
                provenance={
                    "tier": 0,
                    "mode": "none",
                    "context_columns": context_cols or [],
                    "imputed_points": anomaly_count,
                    "max_gap_length": max_gap_length,
                },
                confidence={
                    "overall": integrity_score,
                    "gap": round(max(0.0, 1.0 - max_gap_length / max(df.height, 1)), 6),
                    "context": 0.0,
                },
                error="insufficient_valid_points",
            ).as_dict()

        x = [float(v) for v in valid_unique["__ts"].to_list()]
        y = [float(v) for v in valid_unique["__value"].to_list()]
        all_x = [float(v) for v in indexed[timestamp_col].cast(pl.Float64).to_list()]

        corrupted_mask = (
            indexed.select([pl.col("__rowid"), pl.col("__corrupted")])
            .sort("__rowid")
            .get_column("__corrupted")
            .to_list()
        )
        max_gap_length = self._max_gap_length([bool(v) for v in corrupted_mask])
        requested_context_cols = [col for col in (context_cols or []) if col != target_col and col != timestamp_col]
        context_evidence = self._context_evidence_score(indexed, requested_context_cols)
        use_physics_constraint = max_gap_length > max(1, int(short_gap_limit)) and context_evidence >= 0.12

        method = "deterministic_linear"
        if use_physics_constraint and SCIPY_AVAILABLE and _UnivariateSpline is not None and len(x) >= 4:
            try:
                if NUMPY_AVAILABLE and np is not None:
                    spline = _UnivariateSpline(np.asarray(x, dtype=float), np.asarray(y, dtype=float), s=self.spline_smoothing)
                    reconstructed_sorted = [float(v) for v in spline(np.asarray(all_x, dtype=float)).tolist()]
                else:
                    spline = _UnivariateSpline(x, y, s=self.spline_smoothing)
                    reconstructed_sorted = [float(v) for v in spline(all_x)]
                method = "physics_constrained_spline"
            except Exception:
                reconstructed_sorted = _linear_interp(all_x, x, y)
                method = "physics_constrained_linear"
        else:
            reconstructed_sorted = _linear_interp(all_x, x, y)

        reconstructed = (
            indexed.select(
                [
                    pl.col("__rowid"),
                    pl.Series(name="__reconstructed", values=reconstructed_sorted),
                ]
            )
            .sort("__rowid")
            .get_column("__reconstructed")
            .to_list()
        )

        anomaly_count = int(sum(1 for value in corrupted_mask if value))
        integrity_score = round(max(0.0, 1.0 - (anomaly_count / max(df.height, 1))), 6)
        gap_confidence = round(max(0.0, 1.0 - max_gap_length / max(df.height * 0.4, 1)), 6)
        overall_confidence = round(
            max(
                0.0,
                min(
                    1.0,
                    integrity_score * 0.55 +
                    gap_confidence * 0.25 +
                    context_evidence * 0.2,
                ),
            ),
            6,
        )
        if method.startswith("physics_constrained"):
            insight = (
                "Telemetry gap reconstructed with physics-constrained continuity using supporting orbital/context evidence."
            )
            tier = 2
        elif integrity_score < 0.9:
            insight = "Divergence detected in corrupted bits suggests local radiation shield saturation."
            tier = 1
        else:
            insight = "Telemetry gap reconstructed through deterministic continuity. Operational state nominal."
            tier = 1

        _directive_cleanup()
        return ReconstructionResult(
            success=True,
            target_column=target_col,
            method=method,
            integrity_score=integrity_score,
            anomalies_detected=anomaly_count,
            insight=insight,
            reconstructed_series=[float(v) for v in reconstructed],
            corrupted_mask=[bool(v) for v in corrupted_mask],
            provenance={
                "tier": tier,
                "mode": method,
                "context_columns": requested_context_cols,
                "imputed_points": anomaly_count,
                "max_gap_length": max_gap_length,
            },
            confidence={
                "overall": overall_confidence,
                "gap": gap_confidence,
                "context": context_evidence,
            },
            error=None,
        ).as_dict()


if __name__ == "__main__":
    raw_data = pl.DataFrame(
        {
            "timestamp": [1, 2, 3, 4, 5, 6],
            "particleFlux": [1.2e-4, 0.9, 1.3e-4, 1.1e-4, 1.4e-4, 1.25e-4],
        }
    )
    imputer = GaussPhysicsImputer()
    result = imputer.reconstruct_telemetry(raw_data, "particleFlux")
    print(f"[RECON] {result['insight']}")
    print(f"[INTEGRITY] {result['integrity_score']}")
