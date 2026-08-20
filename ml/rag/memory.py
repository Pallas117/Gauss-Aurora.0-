"""Evidence-linked hybrid memory catalog for Gauss.

SQLite owns exact search, provenance, and graph relationships. LanceDB remains
the semantic candidate store. All writes are local, deterministic, and bounded.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from collections import defaultdict, deque
from functools import wraps
from pathlib import Path
from threading import RLock
from typing import Any, Iterable

from ml.rag import contract, embed, ingest, quantize, store


MAX_FILES = 256
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_NODES = 25_000
MAX_EDGES = 100_000
MAX_GRAPH_NODES = 200
MAX_GRAPH_EDGES = 400
MAX_TRAVERSAL_DEPTH = 2

KNOWN_TERMS: tuple[tuple[str, str], ...] = (
    ("Jetson Orin NX", "hardware"),
    ("Jetson Orin Nano", "hardware"),
    ("Jetson AGX Xavier", "hardware"),
    ("Myriad 2", "hardware"),
    ("Coral Edge TPU", "hardware"),
    ("XQR Versal VE2102", "hardware"),
    ("Qualcomm RB5", "hardware"),
    ("Spaceborne Computer-2", "hardware"),
    ("Total Ionizing Dose", "risk"),
    ("Single Event Upsets", "risk"),
    ("SWaP", "constraint"),
    ("quantization", "technique"),
    ("pruning", "technique"),
    ("RemoteTrimmer", "technique"),
    ("knowledge distillation", "technique"),
    ("parameter-efficient fine-tuning", "technique"),
    ("PEFT", "technique"),
    ("LoRA", "technique"),
    ("QLoRA", "technique"),
    ("TensorRT", "software"),
    ("OpenVINO", "software"),
    ("Solar-Aware Scheduling", "operation"),
    ("Thermal-Aware Scheduling", "operation"),
    ("Synthetic Aperture Radar", "sensor"),
    ("SAR", "sensor"),
    ("nanosatellite", "platform"),
    ("picosatellite", "platform"),
    ("CubeSat", "platform"),
    ("LEO", "orbit"),
    ("GEO", "orbit"),
)


def _now() -> int:
    return int(time.time())


def datetime_from_epoch(value: int | None) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}:{digest}"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _canonical_term(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _extract_entities(text: str) -> list[tuple[str, str]]:
    found: dict[str, tuple[str, str]] = {}
    lowered = text.lower()
    for label, kind in KNOWN_TERMS:
        if label.lower() in lowered:
            found[_canonical_term(label)] = (label, kind)
    for acronym in re.findall(r"\b[A-Z][A-Z0-9]{2,7}\b", text):
        if acronym not in {"JSON", "HTML", "PDF", "CPU", "GPU", "RAM", "AI"}:
            found.setdefault(_canonical_term(acronym), (acronym, "concept"))
    return sorted(found.values(), key=lambda item: (_canonical_term(item[1]), item[0].lower()))[:64]


def _synchronized(method):
    @wraps(method)
    def synchronized(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return synchronized


class MemoryCatalog:
    def __init__(self, db_path: str | Path | None = None) -> None:
        selected = db_path or os.environ.get("GAUSS_MEMORY_DB_PATH") or "data/gauss_memory/catalog.sqlite"
        self.db_path = Path(selected).resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self.connection = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA synchronous=NORMAL")
        self._create_schema()

    def _create_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
              id TEXT PRIMARY KEY,
              source_path TEXT NOT NULL UNIQUE,
              root_path TEXT NOT NULL,
              source_sha256 TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              title TEXT NOT NULL,
              trust_state TEXT NOT NULL,
              active INTEGER NOT NULL DEFAULT 1,
              indexed_at INTEGER NOT NULL,
              embedding_mode TEXT NOT NULL DEFAULT 'float32'
            );
            CREATE TABLE IF NOT EXISTS chunks (
              id TEXT PRIMARY KEY,
              document_id TEXT NOT NULL REFERENCES documents(id),
              ordinal INTEGER NOT NULL,
              section TEXT NOT NULL,
              file_path TEXT NOT NULL,
              text TEXT NOT NULL,
              context_text TEXT NOT NULL,
              checksum TEXT NOT NULL,
              active INTEGER NOT NULL DEFAULT 1,
              UNIQUE(document_id, ordinal)
            );
            CREATE TABLE IF NOT EXISTS entities (
              id TEXT PRIMARY KEY,
              label TEXT NOT NULL,
              kind TEXT NOT NULL,
              canonical_key TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS edges (
              source_id TEXT NOT NULL,
              target_id TEXT NOT NULL,
              relation TEXT NOT NULL,
              confidence REAL NOT NULL,
              evidence_chunk_id TEXT,
              PRIMARY KEY(source_id, target_id, relation, evidence_chunk_id)
            );
            CREATE TABLE IF NOT EXISTS memories (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              source TEXT NOT NULL,
              checksum TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
              chunk_id UNINDEXED,
              file_path UNINDEXED,
              context_text,
              text
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
              memory_id UNINDEXED,
              title,
              content
            );
            CREATE TABLE IF NOT EXISTS memory_records (
              record_id TEXT PRIMARY KEY,
              payload_json TEXT NOT NULL,
              status TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            """
        )
        self.connection.commit()

    @_synchronized
    def close(self) -> None:
        self.connection.close()

    @_synchronized
    def status(self) -> dict[str, Any]:
        counts = {}
        for table, key in (("documents", "documents"), ("chunks", "chunks"), ("entities", "nodes"), ("edges", "edges"), ("memories", "memories"), ("memory_records", "portableRecords")):
            counts[key] = int(self.connection.execute(f"SELECT COUNT(*) FROM {table} WHERE 1").fetchone()[0])
        latest = self.connection.execute("SELECT MAX(indexed_at) FROM documents WHERE active=1").fetchone()[0]
        return {
            "ok": True,
            "state": "nominal" if counts["chunks"] else "unknown",
            "dbPath": str(self.db_path),
            "lastIndexAt": latest,
            **counts,
            "limits": {
                "maxFiles": MAX_FILES,
                "maxSourceBytes": MAX_SOURCE_BYTES,
                "maxNodes": MAX_NODES,
                "maxEdges": MAX_EDGES,
                "maxGraphNodes": MAX_GRAPH_NODES,
                "maxGraphEdges": MAX_GRAPH_EDGES,
                "maxTraversalDepth": MAX_TRAVERSAL_DEPTH,
            },
            "embedding": quantize.get_embedding_store().status(),
            "kvCompression": quantize.get_kv_compression_status(),
        }

    def _source_path(self, root: Path, rel_path: str) -> str:
        return f"{root.as_posix()}::{rel_path}"

    def _delete_document(self, document_id: str, source_key: str) -> None:
        chunk_ids = [row[0] for row in self.connection.execute("SELECT id FROM chunks WHERE document_id=?", (document_id,)).fetchall()]
        for chunk_id in chunk_ids:
            self.connection.execute("DELETE FROM chunks_fts WHERE chunk_id=?", (chunk_id,))
        self.connection.execute("DELETE FROM edges WHERE evidence_chunk_id IN (SELECT id FROM chunks WHERE document_id=?)", (document_id,))
        self.connection.execute("DELETE FROM edges WHERE source_id=? OR target_id=?", (document_id, document_id))
        for chunk_id in chunk_ids:
            self.connection.execute("DELETE FROM edges WHERE source_id=? OR target_id=?", (chunk_id, chunk_id))
        self.connection.execute("DELETE FROM chunks WHERE document_id=?", (document_id,))
        self.connection.execute("DELETE FROM documents WHERE id=?", (document_id,))
        try:
            store.delete_file(self._lance_db(), source_key)
        except Exception:
            pass

    def _lance_db(self):
        db = store.open_db()
        store.create_table_if_missing(db)
        return db

    def _reset_documents(self) -> None:
        self.connection.execute("DELETE FROM chunks_fts")
        self.connection.execute("DELETE FROM edges")
        self.connection.execute("DELETE FROM chunks")
        self.connection.execute("DELETE FROM documents")
        self.connection.execute("DELETE FROM entities")
        try:
            store.clear_table(self._lance_db())
        except Exception:
            pass

    @_synchronized
    def index_root(
        self,
        root_dir: str | Path,
        manifest_path: str | Path | None = None,
        require_approved: bool = True,
        mode: str = "incremental",
    ) -> dict[str, Any]:
        root = Path(root_dir).resolve()
        if not root.is_dir():
            return {"ok": False, "error": f"Directory not found: {root}"}
        if mode == "rebuild":
            self._reset_documents()
        grouped: dict[str, list[ingest.DocumentChunk]] = defaultdict(list)
        for chunk in ingest.iter_memory_chunks(
            root,
            manifest_path=manifest_path,
            require_approved=require_approved,
            max_files=MAX_FILES,
            max_source_bytes=MAX_SOURCE_BYTES,
        ):
            grouped[chunk.file_path].append(chunk)
        indexed = skipped = 0
        warnings: list[str] = []
        lance_db = self._lance_db()
        for rel_path, chunks in sorted(grouped.items()):
            source = root / rel_path
            try:
                source_sha = _sha256_file(source)
                size_bytes = source.stat().st_size
            except OSError as exc:
                warnings.append(f"{rel_path}: {exc}")
                continue
            source_path = self._source_path(root, rel_path)
            document_id = _stable_id("doc", source_path)
            previous = self.connection.execute("SELECT source_sha256 FROM documents WHERE id=?", (document_id,)).fetchone()
            if mode == "incremental" and previous and previous[0] == source_sha:
                skipped += 1
                continue
            if previous:
                self._delete_document(document_id, rel_path)
            title = source.stem.replace("_", " ").replace("-", " ").strip()
            self.connection.execute(
                "INSERT INTO documents(id, source_path, root_path, source_sha256, size_bytes, title, trust_state, indexed_at, embedding_mode) VALUES(?,?,?,?,?,?,?,?,?)",
                (document_id, source_path, str(root), source_sha, size_bytes, title, "approved" if require_approved else "review", _now(), quantize.get_embedding_store().mode),
            )
            contexts: list[str] = []
            records: list[tuple[str, str, str, str, str]] = []
            entity_ids: set[str] = set()
            for ordinal, chunk in enumerate(chunks):
                chunk_db_id = _stable_id("chunk", f"{document_id}:{ordinal}:{chunk.checksum if hasattr(chunk, 'checksum') else ingest.checksum_text(chunk.text)}")
                checksum = ingest.checksum_text(chunk.text)
                self.connection.execute(
                    "INSERT INTO chunks(id, document_id, ordinal, section, file_path, text, context_text, checksum) VALUES(?,?,?,?,?,?,?,?)",
                    (chunk_db_id, document_id, ordinal, chunk.section, rel_path, chunk.text, chunk.context_text, checksum),
                )
                self.connection.execute("INSERT INTO chunks_fts(chunk_id, file_path, context_text, text) VALUES(?,?,?,?)", (chunk_db_id, rel_path, chunk.context_text, chunk.text))
                self.connection.execute("INSERT INTO edges(source_id, target_id, relation, confidence, evidence_chunk_id) VALUES(?,?,?,?,?)", (document_id, chunk_db_id, "contains", 1.0, chunk_db_id))
                contexts.append(chunk.context_text)
                records.append((chunk_db_id, chunk.text, rel_path, chunk.context_text, checksum))
                entities = _extract_entities(chunk.context_text)
                for label, kind in entities:
                    canonical = _canonical_term(label)
                    entity_id = _stable_id("entity", f"{kind}:{canonical}")
                    self.connection.execute("INSERT OR IGNORE INTO entities(id, label, kind, canonical_key) VALUES(?,?,?,?)", (entity_id, label, kind, canonical))
                    self.connection.execute("INSERT OR IGNORE INTO edges(source_id, target_id, relation, confidence, evidence_chunk_id) VALUES(?,?,?,?,?)", (chunk_db_id, entity_id, "mentions", 0.9, chunk_db_id))
                    self.connection.execute("INSERT OR IGNORE INTO edges(source_id, target_id, relation, confidence, evidence_chunk_id) VALUES(?,?,?,?,?)", (document_id, entity_id, "contains_concept", 0.8, chunk_db_id))
                    entity_ids.add(entity_id)
            vectors: list[list[float]] = []
            try:
                vectors = embed.embed_texts(contexts, batch_size=16)
            except Exception as exc:
                warnings.append(f"{rel_path}: embedding unavailable ({str(exc)[:120]})")
            if vectors:
                store.add_chunks(lance_db, vectors, [row[1] for row in records], [row[2] for row in records], [row[0] for row in records], [row[4] for row in records], context_texts=[row[3] for row in records])
            indexed += 1
        self.connection.commit()
        return {
            "ok": True,
            "indexedDocumentCount": indexed,
            "skippedDocumentCount": skipped,
            "chunkCount": int(self.connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]),
            "warnings": warnings[:32],
            "mode": mode,
        }

    def _fts_query(self, query: str) -> str:
        tokens = re.findall(r"[\w'-]+", query.lower())[:24]
        return " OR ".join(f'"{token.replace(chr(34), "")}"' for token in tokens) or '""'

    @_synchronized
    def search(self, query: str, query_vector: list[float] | None = None, top_k: int = 8) -> dict[str, Any]:
        top_k = max(1, min(int(top_k), 50))
        fts_hits = self.connection.execute(
            "SELECT chunk_id, file_path, context_text, text, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?",
            (self._fts_query(query), top_k),
        ).fetchall()
        combined: dict[str, dict[str, Any]] = {}
        for rank, row in enumerate(fts_hits):
            combined[row[0]] = {"chunkId": row[0], "filePath": row[1], "text": row[3], "contextText": row[2], "lexicalRank": rank + 1, "score": 1.0 / (60 + rank + 1)}
        if query_vector is not None:
            try:
                vector_hits = store.search(self._lance_db(), query_vector, top_k=top_k)
            except Exception:
                vector_hits = []
            for rank, row in enumerate(vector_hits):
                chunk_id = row.get("chunk_id") or ""
                if not chunk_id:
                    continue
                item = combined.setdefault(chunk_id, {"chunkId": chunk_id, "filePath": row.get("file_path") or "", "text": row.get("text") or "", "contextText": row.get("context_text") or row.get("text") or ""})
                item["vectorRank"] = rank + 1
                item["score"] = float(item.get("score", 0.0)) + 1.0 / (60 + rank + 1)
        memory_hits = self.connection.execute(
            "SELECT memory_id, title, content, bm25(memories_fts) AS rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
            (self._fts_query(query), top_k),
        ).fetchall()
        for rank, row in enumerate(memory_hits):
            memory_row = self.connection.execute("SELECT checksum, status FROM memories WHERE id=?", (row[0],)).fetchone()
            if not memory_row or memory_row[1] != "approved" or ingest.checksum_text(row[2]) != memory_row[0]:
                continue
            combined[f"memory:{row[0]}"] = {
                "chunkId": f"memory:{row[0]}",
                "filePath": f"memory:{row[0]}",
                "text": row[2],
                "contextText": f"Memory: {row[1]}\n\n{row[2]}",
                "lexicalRank": rank + 1,
                "score": 1.0 / (60 + rank + 1),
                "checksum": memory_row[0],
                "verified": True,
                "sourceSha256": memory_row[0],
            }
        hits = sorted(combined.values(), key=lambda item: (-float(item.get("score", 0.0)), item.get("filePath", "")))[:top_k]
        for hit in hits:
            if hit.get("chunkId", "").startswith("memory:"):
                continue
            row = self.connection.execute("SELECT checksum FROM chunks WHERE id=?", (hit["chunkId"],)).fetchone()
            hit["checksum"] = row[0] if row else None
            hit["verified"] = bool(row and ingest.checksum_text(hit["text"]) == row[0])
            source_row = self.connection.execute("SELECT d.source_sha256 FROM documents d JOIN chunks c ON c.document_id=d.id WHERE c.id=?", (hit["chunkId"],)).fetchone()
            hit["sourceSha256"] = source_row[0] if source_row else None
        return {"ok": True, "query": query, "results": [hit for hit in hits if hit["verified"]], "graph": self.graph(max_nodes=MAX_GRAPH_NODES, max_edges=MAX_GRAPH_EDGES)}

    @_synchronized
    def remember(self, title: str, content: str, source: str = "operator", approved: bool = False) -> dict[str, Any]:
        normalized = content.strip()
        if not normalized:
            return {"ok": False, "error": "content is required"}
        memory_id = _stable_id("memory", f"{title}:{normalized}")
        now = _now()
        status = "approved" if approved else "needs_review"
        checksum = ingest.checksum_text(normalized)
        portable = contract.make_record(
            kind="memory",
            content=normalized[:32_000],
            source_type="operator",
            external_id=memory_id,
            source_label=source,
            truth_state="verified" if approved else "needs_review",
            confidence=1.0 if approved else None,
        )
        self.connection.execute("INSERT OR REPLACE INTO memories(id, title, content, source, checksum, status, created_at, updated_at) VALUES(?,?,?,?,?,?,COALESCE((SELECT created_at FROM memories WHERE id=?),?),?)", (memory_id, title.strip()[:200], normalized[:32_000], source[:500], checksum, status, memory_id, now, now))
        self.connection.execute("INSERT OR REPLACE INTO memory_records(record_id, payload_json, status, updated_at) VALUES(?,?,?,?)", (memory_id, json.dumps(portable, ensure_ascii=False, sort_keys=True), status, now))
        self.connection.execute("DELETE FROM memories_fts WHERE memory_id=?", (memory_id,))
        if approved:
            self.connection.execute("INSERT INTO memories_fts(memory_id, title, content) VALUES(?,?,?)", (memory_id, title, normalized))
        self.connection.commit()
        return {"ok": True, "id": memory_id, "status": status, "checksum": checksum}

    @_synchronized
    def compact(self, title: str, content: str, source: str = "session") -> dict[str, Any]:
        return self.remember(title or "Session compaction", content, source=source, approved=False)

    @_synchronized
    def forget(self, memory_id: str) -> dict[str, Any]:
        self.connection.execute("UPDATE memories SET status='superseded', updated_at=? WHERE id=?", (_now(), memory_id))
        self.connection.execute("UPDATE memory_records SET status='superseded', updated_at=? WHERE record_id=?", (_now(), memory_id))
        self.connection.execute("DELETE FROM memories_fts WHERE memory_id=?", (memory_id,))
        self.connection.commit()
        return {"ok": True, "id": memory_id, "status": "superseded"}

    @_synchronized
    def export_records(self, query: str = "", limit: int = 64, approved_only: bool = True) -> list[dict[str, Any]]:
        """Export canonical records without exposing storage-specific fields."""
        limit = max(1, min(int(limit), 256))
        if query.strip():
            hits = self.search(query, None, top_k=limit).get("results", [])
            chunk_ids = [hit.get("chunkId") for hit in hits if hit.get("chunkId") and not str(hit.get("chunkId")).startswith("memory:")]
            rows = []
            if chunk_ids:
                placeholders = ",".join("?" for _ in chunk_ids)
                rows = self.connection.execute(
                    f"SELECT c.id, c.text, c.section, c.file_path, c.checksum, d.source_sha256, d.title, d.trust_state, d.indexed_at FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id IN ({placeholders})",
                    chunk_ids,
                ).fetchall()
        else:
            rows = self.connection.execute(
                "SELECT c.id, c.text, c.section, c.file_path, c.checksum, d.source_sha256, d.title, d.trust_state, d.indexed_at FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.active=1 ORDER BY d.indexed_at DESC, c.ordinal LIMIT ?",
                (limit,),
            ).fetchall()
        records: dict[str, dict[str, Any]] = {}
        for row in rows:
            truth_state = "verified" if row[7] == "approved" else "needs_review"
            if approved_only and truth_state != "verified":
                continue
            record = contract.make_record(
                kind="chunk",
                content=row[1],
                source_type="file",
                external_id=f"{row[3]}::{row[0]}",
                source_label=row[6],
                observed_at=datetime_from_epoch(row[8]),
                truth_state=truth_state,
                confidence=1.0 if truth_state == "verified" else 0.2,
                provenance=[row[5], row[4]],
                metadata={"filePath": row[3], "section": row[2], "sourceSha256": row[5]},
            )
            records[record["recordId"]] = record
        portable_rows = self.connection.execute("SELECT payload_json, status FROM memory_records ORDER BY updated_at DESC LIMIT ?", (limit,)).fetchall()
        for row in portable_rows:
            if approved_only and row[1] != "approved":
                continue
            try:
                record = json.loads(row[0])
            except json.JSONDecodeError:
                continue
            if not query.strip() or query.lower() in f"{record.get('content', '')} {record.get('source', {}).get('label', '')}".lower():
                records[record["recordId"]] = record
        return list(records.values())[:limit]

    @_synchronized
    def import_records(self, records: list[dict[str, Any]], approved: bool = False) -> dict[str, Any]:
        imported = 0
        pending = 0
        errors: list[str] = []
        now = _now()
        for index, record in enumerate(records[:256]):
            validation = contract.validate_record(record)
            if validation:
                errors.append(f"record {index}: {'; '.join(validation)}")
                continue
            status = "approved" if approved else "needs_review"
            payload = dict(record)
            payload["truthState"] = "verified" if approved else "needs_review"
            self.connection.execute("INSERT OR REPLACE INTO memory_records(record_id, payload_json, status, updated_at) VALUES(?,?,?,?)", (payload["recordId"], json.dumps(payload, ensure_ascii=False, sort_keys=True), status, now))
            if approved:
                self.connection.execute("INSERT OR REPLACE INTO memories(id, title, content, source, checksum, status, created_at, updated_at) VALUES(?,?,?,?,?,?,COALESCE((SELECT created_at FROM memories WHERE id=?),?),?)", (payload["recordId"], str(payload.get("source", {}).get("label", "Imported memory"))[:200], payload["content"][:32_000], f"{payload['source']['type']}:{payload['source']['externalId']}"[:500], payload["checksum"], status, payload["recordId"], now, now))
                self.connection.execute("DELETE FROM memories_fts WHERE memory_id=?", (payload["recordId"],))
                self.connection.execute("INSERT INTO memories_fts(memory_id, title, content) VALUES(?,?,?)", (payload["recordId"], str(payload.get("source", {}).get("label", "Imported memory"))[:200], payload["content"][:32_000]))
                imported += 1
            else:
                pending += 1
        self.connection.commit()
        return {"ok": not errors, "imported": imported, "pendingReview": pending, "errors": errors[:32]}

    @_synchronized
    def graph(self, focus: str | None = None, depth: int = 1, kind: str | None = None, source: str | None = None, max_nodes: int = MAX_GRAPH_NODES, max_edges: int = MAX_GRAPH_EDGES) -> dict[str, Any]:
        max_nodes = max(1, min(int(max_nodes), MAX_GRAPH_NODES, MAX_GRAPH_NODES))
        max_edges = max(1, min(int(max_edges), MAX_GRAPH_EDGES))
        depth = max(0, min(int(depth), MAX_TRAVERSAL_DEPTH))
        node_ids: list[str] = []
        if focus:
            node_ids = [focus]
        else:
            doc_rows = self.connection.execute("SELECT id FROM documents WHERE active=1 ORDER BY indexed_at DESC LIMIT 24").fetchall()
            entity_rows = self.connection.execute("SELECT id FROM entities ORDER BY label LIMIT 96").fetchall()
            node_ids = [row[0] for row in doc_rows] + [row[0] for row in entity_rows]
        visited: dict[str, int] = {}
        queue: deque[tuple[str, int]] = deque((node_id, 0) for node_id in node_ids)
        while queue and len(visited) < max_nodes:
            node_id, current_depth = queue.popleft()
            if node_id in visited or current_depth > depth:
                continue
            visited[node_id] = current_depth
            if current_depth == depth:
                continue
            relations = self.connection.execute("SELECT source_id, target_id FROM edges WHERE source_id=? OR target_id=? LIMIT ?", (node_id, node_id, max_edges)).fetchall()
            for relation in relations:
                neighbor = relation[1] if relation[0] == node_id else relation[0]
                queue.append((neighbor, current_depth + 1))
        ids = list(visited)
        nodes: list[dict[str, Any]] = []
        for node_id in ids:
            if node_id.startswith("doc:"):
                row = self.connection.execute("SELECT id, title, source_path, trust_state, source_sha256 FROM documents WHERE id=?", (node_id,)).fetchone()
                if row:
                    nodes.append({"id": row[0], "label": row[1], "type": "document", "sourcePath": row[2], "truthState": row[3], "sourceSha256": row[4]})
            elif node_id.startswith("chunk:"):
                row = self.connection.execute("SELECT id, section, file_path, checksum FROM chunks WHERE id=?", (node_id,)).fetchone()
                if row:
                    nodes.append({"id": row[0], "label": row[1] or row[2], "type": "chunk", "sourcePath": row[2], "sourceSha256": row[3]})
            else:
                row = self.connection.execute("SELECT id, label, kind FROM entities WHERE id=?", (node_id,)).fetchone()
                if row:
                    nodes.append({"id": row[0], "label": row[1], "type": row[2], "truthState": "observed"})
        if kind:
            nodes = [node for node in nodes if node["type"] == kind]
        if source:
            nodes = [node for node in nodes if source.lower() in str(node.get("sourcePath", "")).lower()]
        allowed = {node["id"] for node in nodes}
        edges: list[dict[str, Any]] = []
        for row in self.connection.execute("SELECT source_id, target_id, relation, confidence, evidence_chunk_id FROM edges LIMIT ?", (max_edges * 4,)).fetchall():
            if row[0] in allowed and row[1] in allowed:
                edges.append({"source": row[0], "target": row[1], "relation": row[2], "confidence": row[3], "evidenceChunkId": row[4]})
                if len(edges) >= max_edges:
                    break
        return {"ok": True, "state": "nominal" if nodes else "unknown", "focus": focus, "depth": depth, "nodes": nodes[:max_nodes], "edges": edges, "truncated": len(nodes) >= max_nodes or len(edges) >= max_edges}
