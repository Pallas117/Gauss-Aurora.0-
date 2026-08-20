"""Optional vector/KV compression adapters.

TurboQuant is intentionally an adapter boundary here.  The local RAG service
must remain usable when no compatible TurboQuant kernel or runtime is present.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


SUPPORTED_MODES = {"float32", "int8", "turboquant"}


@dataclass(frozen=True)
class QuantizationResult:
    values: list[float]
    mode: str
    scale: float | None = None
    available: bool = True
    note: str | None = None


class EmbeddingStore:
    """Stable interface for candidate-vector compression and reranking."""

    mode = "float32"

    def encode(self, vector: list[float]) -> QuantizationResult:
        return QuantizationResult([float(value) for value in vector], self.mode)

    def decode(self, result: QuantizationResult) -> list[float]:
        return [float(value) for value in result.values]

    def status(self) -> dict[str, Any]:
        return {"mode": self.mode, "available": True, "candidateOnly": False}


class Int8EmbeddingStore(EmbeddingStore):
    mode = "int8"

    def encode(self, vector: list[float]) -> QuantizationResult:
        maximum = max((abs(float(value)) for value in vector), default=0.0)
        scale = maximum / 127.0 if maximum else 1.0
        values = [float(max(-127, min(127, round(float(value) / scale)))) for value in vector]
        return QuantizationResult(values, self.mode, scale=scale, candidateOnly=True)

    def decode(self, result: QuantizationResult) -> list[float]:
        scale = result.scale or 1.0
        return [float(value) * scale for value in result.values]

    def status(self) -> dict[str, Any]:
        return {"mode": self.mode, "available": True, "candidateOnly": True}


class TurboQuantEmbeddingStore(EmbeddingStore):
    mode = "turboquant"

    def __init__(self) -> None:
        self._available = os.environ.get("GAUSS_TURBOQUANT_ENABLED", "0").strip().lower() in {"1", "true", "yes"}

    def encode(self, vector: list[float]) -> QuantizationResult:
        if not self._available:
            return QuantizationResult(
                [float(value) for value in vector],
                self.mode,
                available=False,
                note="TurboQuant runtime unavailable; using float32 candidate vectors.",
            )
        # The production PolarQuant/QJL kernel belongs in the model runtime.
        # Until a compatible local kernel is installed, preserve correctness.
        return QuantizationResult(
            [float(value) for value in vector],
            self.mode,
            available=False,
            note="TurboQuant adapter is reserved for a verified runtime kernel.",
        )

    def status(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "available": self._available,
            "candidateOnly": True,
            "note": "No production kernel is bundled with Gauss.",
        }


def get_embedding_store(mode: str | None = None) -> EmbeddingStore:
    selected = (mode or os.environ.get("GAUSS_EMBEDDING_MODE", "float32")).strip().lower()
    if selected == "int8":
        return Int8EmbeddingStore()
    if selected == "turboquant":
        return TurboQuantEmbeddingStore()
    return EmbeddingStore()


def get_kv_compression_status() -> dict[str, Any]:
    enabled = os.environ.get("GAUSS_TURBOQUANT_KV_ENABLED", "0").strip().lower() in {"1", "true", "yes"}
    return {
        "provider": "turboquant",
        "enabled": enabled,
        "available": False,
        "note": "KV compression requires an explicitly integrated local model runtime kernel.",
    }
