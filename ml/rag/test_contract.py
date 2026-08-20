from __future__ import annotations

import unittest

from ml.rag import adapters, contract


class TestPortableMemoryContract(unittest.TestCase):
    def test_record_is_deterministic_and_round_trips_as_jsonl(self) -> None:
        record = contract.make_record(
            kind="chunk",
            content="Gauss runs local retrieval.",
            source_type="file",
            external_id="docs/pitch.md::chunk-1",
            truth_state="verified",
            provenance=["sha256:source"],
        )
        payload = adapters.JsonlMemoryAdapter().export_payload([record])
        restored = adapters.JsonlMemoryAdapter().import_payload(payload)
        self.assertEqual(restored, [record])
        self.assertEqual(record["recordId"], contract.make_record(
            kind="chunk",
            content="Gauss runs local retrieval.",
            source_type="file",
            external_id="docs/pitch.md::chunk-1",
            truth_state="verified",
            provenance=["sha256:source"],
        )["recordId"])

    def test_invalid_checksum_is_rejected(self) -> None:
        record = contract.make_record(kind="memory", content="safe", source_type="operator", external_id="one")
        record["content"] = "tampered"
        self.assertIn("checksum does not match content", contract.validate_record(record))


if __name__ == "__main__":
    unittest.main()
