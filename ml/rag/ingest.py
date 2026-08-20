"""Bounded document ingestion for the local Gauss memory fabric."""
from __future__ import annotations

import hashlib
import json
import re
import csv
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterator, NamedTuple

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


def _extract_structured_text(path: Path) -> str:
    """Turn small structured files into deterministic, searchable records."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    suffix = path.suffix.lower()
    if suffix in {".json", ".jsonl"}:
        records: list[object] = []
        if suffix == ".jsonl":
            for line in raw.splitlines():
                if line.strip():
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        records.append({"raw": line})
        else:
            try:
                parsed = json.loads(raw)
                records = parsed if isinstance(parsed, list) else [parsed]
            except json.JSONDecodeError:
                return ""
        return "\n".join(
            f"record {index}: {json.dumps(record, ensure_ascii=False, sort_keys=True)}"
            for index, record in enumerate(records)
        )
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        rows = csv.DictReader(io.StringIO(raw), delimiter=delimiter)
        return "\n".join(
            f"record {index}: {json.dumps(dict(row), ensure_ascii=False, sort_keys=True)}"
            for index, row in enumerate(rows)
        )
    return ""


def _extract_pptx_text(path: Path) -> str:
    """Extract slide text without requiring python-pptx or a model runtime."""
    slides: list[tuple[int, str]] = []
    try:
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                match = re.fullmatch(r"ppt/slides/slide(\d+)\.xml", name)
                if not match:
                    continue
                root = ET.fromstring(archive.read(name))
                text = " ".join(
                    item.text.strip()
                    for item in root.iter()
                    if item.tag.rsplit("}", 1)[-1] == "t" and item.text and item.text.strip()
                )
                if text:
                    slides.append((int(match.group(1)), text))
    except (OSError, zipfile.BadZipFile, ET.ParseError):
        return ""
    return "\n\n".join(f"# Slide {number}\n{text}" for number, text in sorted(slides))


def extract_text(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".pdf":
        return _extract_pdf_text(path)
    if suf in (".md", ".markdown"):
        return path.read_text(encoding="utf-8", errors="replace")
    if suf in (".html", ".htm"):
        return _extract_html_text(path)
    if suf in (".json", ".jsonl", ".csv", ".tsv"):
        return _extract_structured_text(path)
    if suf == ".pptx":
        return _extract_pptx_text(path)
    return ""


class DocumentChunk(NamedTuple):
    file_path: str
    text: str
    chunk_id: str
    section: str
    context_text: str


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


def _section_for_chunk(chunk: str) -> str:
    headings = re.findall(r"(?m)^#{1,6}\s+(.+)$", chunk)
    return headings[-1].strip() if headings else ""


def iter_memory_chunks(
    root_dir: str | Path,
    max_tokens: int = 512,
    overlap_tokens: int = 128,
    manifest_path: str | Path | None = None,
    require_approved: bool = True,
    max_files: int = 256,
    max_source_bytes: int = 256 * 1024 * 1024,
) -> Iterator[DocumentChunk]:
    """Yield trust-gated chunks with contextual text for embedding and FTS."""
    root = Path(root_dir).resolve()
    if not root.is_dir():
        return
    manifest = trust.load_manifest(manifest_path) if manifest_path else None
    extensions = {".pdf", ".md", ".markdown", ".html", ".htm", ".json", ".jsonl", ".csv", ".tsv", ".pptx"}
    seen_files = 0
    seen_bytes = 0
    for path in sorted(root.rglob("*")):
        if seen_files >= max_files or seen_bytes >= max_source_bytes:
            break
        if not path.is_file() or path.suffix.lower() not in extensions:
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size > max_source_bytes or seen_bytes + size > max_source_bytes:
            continue
        rel_path = path.relative_to(root).as_posix()
        if require_approved and not trust.index_allowed(manifest, rel_path):
            continue
        try:
            text = extract_text(path)
        except Exception:
            continue
        if not text.strip():
            continue
        seen_files += 1
        seen_bytes += size
        title = path.stem.replace("_", " ").replace("-", " ").strip()
        for index, chunk in enumerate(chunk_text(text, max_tokens=max_tokens, overlap_tokens=overlap_tokens)):
            section = _section_for_chunk(chunk)
            context = f"Source: {rel_path}\nTitle: {title}"
            if section:
                context += f"\nSection: {section}"
            context_text = f"{context}\n\n{chunk}".strip()
            chunk_id = f"{rel_path}::{index}"
            yield DocumentChunk(rel_path, chunk, chunk_id, section, context_text)


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
    exts = {".pdf", ".md", ".markdown", ".html", ".htm", ".json", ".jsonl", ".csv", ".tsv", ".pptx"}
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
