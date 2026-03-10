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


if __name__ == "__main__":
    unittest.main()
