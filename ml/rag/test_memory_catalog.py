from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ml.rag import memory


class TestMemoryCatalog(unittest.TestCase):
    def test_trust_gated_incremental_index_and_graph(self) -> None:
        with tempfile.TemporaryDirectory(prefix="gauss-memory-catalog-") as tmp:
            root = Path(tmp) / "docs"
            root.mkdir()
            approved = root / "edge.md"
            blocked = root / "blocked.md"
            approved.write_text("# Edge hardware\nJetson Orin NX supports quantization and PEFT.\n", encoding="utf-8")
            blocked.write_text("# blocked\nsecret\n", encoding="utf-8")
            manifest = root / ".gauss-doc-trust.json"
            manifest.write_text(json.dumps({"documents": [{"path": "edge.md", "indexAllowed": True}, {"path": "blocked.md", "indexAllowed": False}]}), encoding="utf-8")

            fake_lance = object()
            with patch.object(memory.store, "open_db", return_value=fake_lance), patch.object(memory.store, "create_table_if_missing"), patch.object(memory.store, "add_chunks"), patch.object(memory.embed, "embed_texts", side_effect=lambda texts, batch_size=16: [[0.0] * 384 for _ in texts]):
                catalog = memory.MemoryCatalog(Path(tmp) / "catalog.sqlite")
                first = catalog.index_root(root, manifest, require_approved=True)
                second = catalog.index_root(root, manifest, require_approved=True)
                self.assertEqual(first["indexedDocumentCount"], 1)
                self.assertEqual(second["skippedDocumentCount"], 1)
                result = catalog.search("Which hardware supports quantization?", query_vector=None)
                self.assertEqual(len(result["results"]), 1)
                self.assertTrue(result["results"][0]["verified"])
                graph = catalog.graph(depth=1)
                labels = {node["label"] for node in graph["nodes"]}
                self.assertIn("Jetson Orin NX", labels)
                self.assertNotIn("secret", " ".join(labels).lower())
                catalog.close()

    def test_memory_write_requires_approval_for_recall(self) -> None:
        with tempfile.TemporaryDirectory(prefix="gauss-memory-write-") as tmp:
            catalog = memory.MemoryCatalog(Path(tmp) / "catalog.sqlite")
            pending = catalog.remember("Pending", "Do not use yet.")
            self.assertEqual(pending["status"], "needs_review")
            approved = catalog.remember("Approved", "Use this memory.", approved=True)
            self.assertEqual(approved["status"], "approved")
            forgotten = catalog.forget(approved["id"])
            self.assertEqual(forgotten["status"], "superseded")
            catalog.close()

    def test_portable_import_stays_pending_until_explicit_approval(self) -> None:
        with tempfile.TemporaryDirectory(prefix="gauss-memory-import-") as tmp:
            catalog = memory.MemoryCatalog(Path(tmp) / "catalog.sqlite")
            from ml.rag import contract

            record = contract.make_record(
                kind="memory",
                content="A pitch deck retrieval result is evidence-linked.",
                source_type="external-tool",
                external_id="tool-1",
            )
            pending = catalog.import_records([record])
            self.assertEqual(pending["pendingReview"], 1)
            self.assertEqual(catalog.search("pitch deck", None)["results"], [])
            approved = catalog.import_records([record], approved=True)
            self.assertEqual(approved["imported"], 1)
            self.assertEqual(len(catalog.search("pitch deck", None)["results"]), 1)
            catalog.close()


if __name__ == "__main__":
    unittest.main()
