from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from ml.rag import ingest, trust


class TestTrustManifest(unittest.TestCase):
    def test_iter_doc_chunks_only_indexes_manifest_approved_docs(self) -> None:
        with tempfile.TemporaryDirectory(prefix="gauss-rag-trust-") as tmp:
            root = Path(tmp)
            approved = root / "approved.md"
            blocked = root / "blocked.md"
            approved.write_text("# Approved\ntrusted\n", encoding="utf-8")
            blocked.write_text("# Blocked\nreview required\n", encoding="utf-8")

            manifest_path = trust.default_manifest_path(root)
            manifest_path.write_text(
                json.dumps(
                    {
                        "documents": [
                            {
                                "path": "approved.md",
                                "indexAllowed": True,
                            },
                            {
                                "path": "blocked.md",
                                "indexAllowed": False,
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )

            chunks = list(
                ingest.iter_doc_chunks(
                    root,
                    max_tokens=128,
                    overlap_tokens=16,
                    manifest_path=manifest_path,
                    require_approved=True,
                )
            )
            chunk_paths = {fp for fp, _, _ in chunks}

            self.assertIn("approved.md", chunk_paths)
            self.assertNotIn("blocked.md", chunk_paths)

    def test_load_manifest_returns_none_for_missing_or_malformed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="gauss-rag-trust-missing-") as tmp:
            root = Path(tmp)
            missing = root / ".gauss-doc-trust.json"
            self.assertIsNone(trust.load_manifest(missing))

            malformed = root / "bad.json"
            malformed.write_text("{not-json", encoding="utf-8")
            self.assertIsNone(trust.load_manifest(malformed))

    def test_index_allowed_rejects_path_traversal_like_keys(self) -> None:
        with tempfile.TemporaryDirectory(prefix="gauss-rag-trust-path-") as tmp:
            root = Path(tmp)
            manifest_path = trust.default_manifest_path(root)
            manifest_path.write_text(
                json.dumps(
                    {
                        "documents": [
                            {"path": "safe/approved.md", "indexAllowed": True},
                            {"path": "../escape.md", "indexAllowed": True},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            manifest = trust.load_manifest(manifest_path)
            self.assertTrue(trust.index_allowed(manifest, "safe/approved.md"))
            self.assertFalse(trust.index_allowed(manifest, "escape.md"))


if __name__ == "__main__":
    unittest.main()
