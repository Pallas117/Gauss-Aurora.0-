"""LanceDB vector store: vector, text, file_path, chunk_id, checksum. SEU: verify checksum before LLM."""
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


def create_table_if_missing(db: lancedb.DBConnection) -> None:
    if TABLE_NAME in db.table_names():
        return
    db.create_table(
        TABLE_NAME,
        data=[
            {
                "vector": [0.0] * 384,
                "text": "",
                "file_path": "",
                "chunk_id": "",
                "checksum": "",
            }
        ],
        mode="overwrite",
    )


def add_chunks(
    db: lancedb.DBConnection,
    vectors: list[list[float]],
    texts: list[str],
    file_paths: list[str],
    chunk_ids: list[str],
    checksums: list[str],
) -> None:
    if not vectors:
        return
    table = db.open_table(TABLE_NAME)
    rows = [
        {
            "vector": v,
            "text": t,
            "file_path": fp,
            "chunk_id": cid,
            "checksum": cs,
        }
        for v, t, fp, cid, cs in zip(vectors, texts, file_paths, chunk_ids, checksums)
    ]
    table.add(rows)


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


