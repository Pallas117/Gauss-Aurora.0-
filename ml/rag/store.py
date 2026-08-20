"""LanceDB vector store with deterministic chunk replacement and checksums."""
from __future__ import annotations

import gc
import os
from pathlib import Path
from typing import Any

import lancedb


def get_db_path() -> Path:
    p = os.environ.get("GAUSS_RAG_DB_PATH")
    if p:
        return Path(p)
    return Path.cwd() / "data" / "gauss_rag_lancedb"


def open_db() -> lancedb.DBConnection:
    db_path = get_db_path()
    db_path.mkdir(parents=True, exist_ok=True)
    return lancedb.connect(str(db_path))


TABLE_NAME = "chunks"


def _create_memory_table(db: lancedb.DBConnection) -> None:
    db.create_table(
        TABLE_NAME,
        data=[
            {
                "vector": [0.0] * 384,
                "text": "",
                "file_path": "",
                "chunk_id": "",
                "checksum": "",
                "context_text": "",
                "embedding_mode": "float32",
            }
        ],
        mode="overwrite",
    )


def create_table_if_missing(db: lancedb.DBConnection) -> None:
    if TABLE_NAME not in db.table_names():
        _create_memory_table(db)
        return
    table = db.open_table(TABLE_NAME)
    field_names = set(getattr(table.schema, "names", ()))
    required_fields = {"context_text", "embedding_mode"}
    if required_fields.issubset(field_names):
        return

    # Migrate the pre-memory RAG schema while preserving its vectors. SQLite
    # remains authoritative; migrated rows are only a warm semantic cache.
    legacy_rows = table.to_arrow().to_pylist()
    db.drop_table(TABLE_NAME)
    _create_memory_table(db)
    if legacy_rows:
        migrated_rows = []
        for row in legacy_rows:
            migrated_rows.append(
                {
                    "vector": row.get("vector", [0.0] * 384),
                    "text": row.get("text", ""),
                    "file_path": row.get("file_path", ""),
                    "chunk_id": row.get("chunk_id", ""),
                    "checksum": row.get("checksum", ""),
                    "context_text": row.get("text", ""),
                    "embedding_mode": "float32",
                }
            )
        db.open_table(TABLE_NAME).add(migrated_rows)


def add_chunks(
    db: lancedb.DBConnection,
    vectors: list[list[float]],
    texts: list[str],
    file_paths: list[str],
    chunk_ids: list[str],
    checksums: list[str],
    context_texts: list[str] | None = None,
    embedding_mode: str = "float32",
) -> None:
    if not vectors:
        return
    table = db.open_table(TABLE_NAME)
    contexts = context_texts or texts
    rows = [
        {
            "vector": v,
            "text": t,
            "file_path": fp,
            "chunk_id": cid,
            "checksum": cs,
            "context_text": context,
            "embedding_mode": embedding_mode,
        }
        for v, t, fp, cid, cs, context in zip(vectors, texts, file_paths, chunk_ids, checksums, contexts)
    ]
    table.add(rows)


def delete_file(db: lancedb.DBConnection, file_path: str) -> None:
    if TABLE_NAME not in db.table_names():
        return
    table = db.open_table(TABLE_NAME)
    try:
        table.delete(f"file_path = '{file_path.replace(chr(39), chr(39) * 2)}'")
    except Exception:
        # Older LanceDB versions may not expose predicate deletes. The
        # catalog still remains authoritative and stale rows are checksum
        # rejected before they reach the model.
        return


def clear_table(db: lancedb.DBConnection) -> None:
    if TABLE_NAME not in db.table_names():
        return
    db.drop_table(TABLE_NAME)
    create_table_if_missing(db)


def search(
    db: lancedb.DBConnection,
    query_vector: list[float],
    top_k: int = 10,
) -> list[dict[str, Any]]:
    if TABLE_NAME not in db.table_names():
        return []
    table = db.open_table(TABLE_NAME)
    rs = table.search(query_vector).limit(top_k).to_list()
    return rs
