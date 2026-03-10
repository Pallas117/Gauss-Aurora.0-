"""GAUSS simulated QKD engine.

This module provides a high-entropy session-key utility for local/dev use.
It is not a real quantum key distribution implementation.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass(frozen=True)
class SessionKeyRecord:
    """Stored key record for one session."""

    session_id: str
    key_hash: str
    key_id: str
    created_at: float
    expires_at: float
    rotations: int


class GaussQKDEngine:
    """Simulated QKD-like key manager for Gauss sessions.

    Design goals:
    - High-entropy key generation.
    - Short-lived keys with rotation.
    - Constant-time validation to reduce timing leak risk.
    """

    def __init__(self, default_ttl_seconds: int = 300):
        if default_ttl_seconds <= 0:
            raise ValueError("default_ttl_seconds must be > 0")
        self.default_ttl_seconds = int(default_ttl_seconds)
        self._active_keys: Dict[str, SessionKeyRecord] = {}
        print("GAUSS_QKD: Quantum entropy engine initialized.")

    @staticmethod
    def _now() -> float:
        return time.time()

    @staticmethod
    def _hash_key(key: str) -> str:
        return hashlib.sha3_512(key.encode("utf-8")).hexdigest()

    def generate_quantum_pulse(self) -> str:
        """Generate a 512-bit key hex string from system entropy."""

        # Mix entropy sources. secrets.token_bytes already uses os.urandom.
        entropy = secrets.token_bytes(64)
        nonce = os.urandom(16)
        tick = time.perf_counter_ns().to_bytes(8, "big", signed=False)
        raw = hashlib.sha3_512(entropy + nonce + tick).digest()
        return raw.hex()

    def rotate_session_key(self, session_id: str, ttl_seconds: Optional[int] = None) -> Dict[str, object]:
        """Rotate key for session and return new key material.

        Returns plaintext key once. Stored state keeps only a key hash.
        """

        if not session_id or not session_id.strip():
            raise ValueError("session_id is required")

        ttl = int(ttl_seconds if ttl_seconds is not None else self.default_ttl_seconds)
        if ttl <= 0:
            raise ValueError("ttl_seconds must be > 0")

        now = self._now()
        key = self.generate_quantum_pulse()
        key_hash = self._hash_key(key)
        prev = self._active_keys.get(session_id)
        rotations = 1 if prev is None else prev.rotations + 1

        record = SessionKeyRecord(
            session_id=session_id,
            key_hash=key_hash,
            key_id=hashlib.sha256(f"{session_id}:{now}:{rotations}".encode("utf-8")).hexdigest()[:16],
            created_at=now,
            expires_at=now + ttl,
            rotations=rotations,
        )
        self._active_keys[session_id] = record
        return {
            "session_id": session_id,
            "key": key,
            "key_id": record.key_id,
            "created_at": record.created_at,
            "expires_at": record.expires_at,
            "ttl_seconds": ttl,
            "rotations": rotations,
        }

    def validate_pulse(self, session_id: str, provided_key: str) -> bool:
        """Validate provided key against active record in constant time."""

        record = self._active_keys.get(session_id)
        if record is None:
            return False

        if self._now() > record.expires_at:
            # Fail closed and evict expired state.
            self._active_keys.pop(session_id, None)
            return False

        provided_hash = self._hash_key(provided_key)
        return hmac.compare_digest(record.key_hash, provided_hash)

    def purge_expired_keys(self) -> int:
        """Remove expired keys and return removed count."""

        now = self._now()
        expired = [sid for sid, record in self._active_keys.items() if now > record.expires_at]
        for sid in expired:
            self._active_keys.pop(sid, None)
        return len(expired)

    def active_session_count(self) -> int:
        """Return count of active in-memory key records."""

        return len(self._active_keys)

    def get_session_state(self, session_id: str) -> Optional[Dict[str, object]]:
        """Return non-secret metadata for session key state."""

        record = self._active_keys.get(session_id)
        if record is None:
            return None
        return {
            "session_id": record.session_id,
            "key_id": record.key_id,
            "created_at": record.created_at,
            "expires_at": record.expires_at,
            "rotations": record.rotations,
            "expired": self._now() > record.expires_at,
        }


if __name__ == "__main__":
    qkd = GaussQKDEngine()
    rotated = qkd.rotate_session_key("mission_alpha_01")
    preview = str(rotated["key"])[:16]
    print(f"QKD_PULSE: {preview}...[REDACTED]")
