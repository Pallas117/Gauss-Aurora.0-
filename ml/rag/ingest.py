"""Document ingestion: PDF, Markdown, HTML. Section-aware chunking with overlap. M1-safe."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Iterator

from ml.rag import trust

def _extract_pdf_text(path: Path) -> str:
    try:
        import fitz
    except ImportError:
        return ""
    text_parts = []
    try:
        doc = fitz.open(path)
        try:
            for page in doc:
                text_parts.append(page.get_text())
        finally:
            doc.close()
    except Exception:
        return ""
    return "\n\n".join(text_parts)


def _extract_html_text(path: Path) -> str:
    from bs4 import BeautifulSoup
    raw = path.read_text(encoding="utf-8", errors="replace")
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)


def extract_text(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".pdf":
        return _extract_pdf_text(path)
    if suf in (".md", ".markdown"):
        return path.read_text(encoding="utf-8", errors="replace")
    if suf in (".html", ".htm"):
        return _extract_html_text(path)
    return ""


def _chunk_with_overlap(text: str, max_tokens: int, overlap_tokens: int) -> Iterator[str]:
    max_chars = max(100, max_tokens * 4)
    step = max(50, (max_tokens - overlap_tokens) * 4)
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            break_at = text.rfind("\n", start, end + 1)
            if break_at == -1:
                break_at = text.rfind(". ", start, end + 1)
            if break_at != -1 and break_at > start:
                end = break_at + 1
        chunk = text[start:end].strip()
        if chunk:
            yield chunk
        start = start + step
        if start >= len(text):
            break


def chunk_text(
    text: str,
    max_tokens: int = 512,
    overlap_tokens: int = 128,
    split_on_headings: bool = True,
) -> list[str]:
    if not text or not text.strip():
        return []
    text = text.replace("\r\n", "\n").strip()
    chunks = []
    if split_on_headings:
        sections = re.split(r"(?m)^(#{1,6}\s+.+)$", text)
        parts = []
        for block in sections:
            if block.strip().startswith("#"):
                if parts:
                    combined = "\n\n".join(parts)
                    chunks.extend(list(_chunk_with_overlap(combined, max_tokens, overlap_tokens)))
                    parts = []
                parts = [block]
            else:
                if block.strip():
                    parts.append(block.strip())
        if parts:
            combined = "\n\n".join(parts)
            chunks.extend(list(_chunk_with_overlap(combined, max_tokens, overlap_tokens)))
    else:
        chunks = list(_chunk_with_overlap(text, max_tokens, overlap_tokens))
    return chunks


def iter_doc_chunks(
    root_dir: str | Path,
    max_tokens: int = 512,
    overlap_tokens: int = 128,
    manifest_path: str | Path | None = None,
    require_approved: bool = False,
) -> Iterator[tuple[str, str, str]]:
    root = Path(root_dir).resolve()
    if not root.is_dir():
        return
    manifest = None
    if manifest_path is not None:
        manifest = trust.load_manifest(manifest_path)
    exts = {".pdf", ".md", ".markdown", ".html", ".htm"}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in exts:
            continue
        try:
            text = extract_text(path)
        except Exception:
            continue
        if not text.strip():
            continue
        rel_path = path.relative_to(root) if root != path else path.name
        fp = str(rel_path)
        if require_approved and not trust.index_allowed(manifest, fp):
            continue
        for i, chunk in enumerate(chunk_text(text, max_tokens=max_tokens, overlap_tokens=overlap_tokens)):
            chunk_id = f"{fp}::{i}"
            yield (fp, chunk, chunk_id)


def checksum_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
