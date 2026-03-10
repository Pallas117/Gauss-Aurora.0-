"""PROJECT GAUSS directive: RAG must verify LanceDB checksum before passing context to LLM (SEU resilience)."""
from __future__ import annotations

import unittest
from unittest.mock import patch, MagicMock


def _checksum_verified_before_llm_in_server_code() -> bool:
    """Assert server.py verifies checksum before building context and calling LLM."""
    from pathlib import Path
    path = Path(__file__).resolve().parent / "server.py"
    text = path.read_text(encoding="utf-8", errors="replace")
    # Order must be: checksum check (continue on mismatch) -> context_parts -> context -> url and context -> LLM call
    idx_checksum = text.find("ingest.checksum_text(text) != stored_cs")
    idx_continue = text.find("continue", idx_checksum) if idx_checksum >= 0 else -1
    idx_context_parts = text.find("context_parts.append(text)")
    idx_join = text.find('"\\n\\n---\\n\\n".join(context_parts')
    if idx_join < 0:
        idx_join = text.find("join(context_parts")
    idx_httpx = text.find("client.post(")
    if idx_checksum < 0 or idx_context_parts < 0 or idx_join < 0 or idx_httpx < 0:
        return False
    if idx_continue < 0:
        return False
    # checksum check and continue must come before context_parts.append
    if idx_continue >= idx_context_parts:
        return False
    # context build must come after context_parts
    if idx_join <= idx_context_parts:
        return False
    # LLM call must come after context build
    if idx_httpx <= idx_join:
        return False
    return True


class TestRagChecksumDirective(unittest.TestCase):
    """SEU resilience: vector DB data must be checksum-verified before being passed to the LLM."""

    def test_server_verifies_checksum_before_llm_flow(self) -> None:
        self.assertTrue(
            _checksum_verified_before_llm_in_server_code(),
            "server.py must verify ingest.checksum_text(text) == stored_cs before adding to context and before LLM call",
        )


if __name__ == "__main__":
    unittest.main()
