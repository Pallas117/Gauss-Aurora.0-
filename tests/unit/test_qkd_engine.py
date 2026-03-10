"""Unit tests for backend.gauss_qkd_engine.GaussQKDEngine."""

from __future__ import annotations

import time

import pytest

from backend.gauss_qkd_engine import GaussQKDEngine


def test_generate_quantum_pulse_length_and_uniqueness() -> None:
    engine = GaussQKDEngine()
    key_a = engine.generate_quantum_pulse()
    key_b = engine.generate_quantum_pulse()

    assert isinstance(key_a, str)
    assert isinstance(key_b, str)
    assert len(key_a) == 128  # 512-bit hash as hex
    assert len(key_b) == 128
    assert key_a != key_b


def test_rotate_and_validate_success() -> None:
    engine = GaussQKDEngine(default_ttl_seconds=300)
    rotated = engine.rotate_session_key("mission_alpha_01")
    key = str(rotated["key"])

    assert engine.validate_pulse("mission_alpha_01", key) is True
    assert engine.validate_pulse("mission_alpha_01", "bad-key") is False
    assert engine.validate_pulse("unknown_session", key) is False


def test_rotation_invalidates_previous_key() -> None:
    engine = GaussQKDEngine(default_ttl_seconds=300)
    old_key = str(engine.rotate_session_key("mission_alpha_02")["key"])
    new_key = str(engine.rotate_session_key("mission_alpha_02")["key"])

    assert old_key != new_key
    assert engine.validate_pulse("mission_alpha_02", old_key) is False
    assert engine.validate_pulse("mission_alpha_02", new_key) is True


def test_expired_key_fails_and_is_purged() -> None:
    engine = GaussQKDEngine(default_ttl_seconds=1)
    key = str(engine.rotate_session_key("mission_alpha_03", ttl_seconds=1)["key"])
    assert engine.validate_pulse("mission_alpha_03", key) is True

    time.sleep(1.1)
    assert engine.validate_pulse("mission_alpha_03", key) is False
    assert engine.get_session_state("mission_alpha_03") is None


def test_purge_expired_keys_count() -> None:
    engine = GaussQKDEngine(default_ttl_seconds=1)
    engine.rotate_session_key("session_a", ttl_seconds=1)
    engine.rotate_session_key("session_b", ttl_seconds=1)
    assert engine.active_session_count() == 2

    time.sleep(1.1)
    removed = engine.purge_expired_keys()
    assert removed == 2
    assert engine.active_session_count() == 0


def test_invalid_constructor_and_inputs() -> None:
    with pytest.raises(ValueError):
        GaussQKDEngine(default_ttl_seconds=0)

    engine = GaussQKDEngine()
    with pytest.raises(ValueError):
        engine.rotate_session_key("")
    with pytest.raises(ValueError):
        engine.rotate_session_key("session", ttl_seconds=0)
