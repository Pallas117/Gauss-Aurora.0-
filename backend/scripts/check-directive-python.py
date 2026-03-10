#!/usr/bin/env python3
"""PROJECT GAUSS directive checks for Python: GC after heavy use, no pl.read_* (use scan)."""

from __future__ import annotations

import ast
import sys
from pathlib import Path


def find_python_files(roots: list[Path], exclude_self: Path | None = None) -> list[Path]:
    out: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        for p in root.rglob("*.py"):
            if "node_modules" in p.parts or ".venv" in p.parts or "__pycache__" in p.parts:
                continue
            if exclude_self and p.resolve() == exclude_self.resolve():
                continue
            out.append(p)
    return sorted(out)


def check_no_read_csv_parquet(files: list[Path]) -> list[str]:
    """Fail on pl.read_csv / pl.read_parquet (directive: use pl.scan_* only)."""
    errors: list[str] = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            errors.append(f"{path}: could not read: {e}")
            continue
        if "pl.read_csv(" in text or "pl.read_parquet(" in text:
            errors.append(f"{path}: directive forbids pl.read_csv/pl.read_parquet; use pl.scan_csv/pl.scan_parquet")
    return errors


def get_function_bodies(path: Path, source: str) -> list[tuple[str, str, int]]:
    """Return list of (function_name, body_source, lineno)."""
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return []
    result: list[tuple[str, int, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            start = node.lineno - 1
            end = node.end_lineno if hasattr(node, "end_lineno") and node.end_lineno else node.lineno
            result.append((node.name, start, end))
    bodies: list[tuple[str, str, int]] = []
    lines = source.splitlines()
    for name, start, end in result:
        body = "\n".join(lines[start:end])
        bodies.append((name, body, start + 1))
    return bodies


def check_gc_in_heavy_functions(files: list[Path]) -> list[str]:
    """Require gc.collect (and for mlx: mx.metal.clear_cache) in functions that use polars/torch/mlx."""
    errors: list[str] = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        uses_polars = "import polars" in text or "from polars" in text
        uses_torch = "import torch" in text or "from torch" in text
        uses_mlx = "import mlx" in text or "from mlx" in text
        if not (uses_polars or uses_torch or uses_mlx):
            continue

        for name, body, lineno in get_function_bodies(path, text):
            if name.startswith("_"):
                continue
            uses_pl = "pl." in body or "polars." in body
            uses_t = "torch." in body
            uses_m = "mlx." in body
            if not (uses_pl or uses_t or uses_m):
                continue
            has_gc = "gc.collect" in body or "_directive_cleanup" in body
            if not has_gc:
                errors.append(f"{path}:{lineno}: function '{name}' uses polars/torch/mlx but has no gc.collect or _directive_cleanup")
            if uses_m and (uses_mlx or "mlx." in body):
                has_mx_clear = "mx.metal.clear_cache" in body or "metal.clear_cache" in body
                if not has_mx_clear:
                    errors.append(f"{path}:{lineno}: function '{name}' uses mlx; add mx.metal.clear_cache() (directive)")
    return errors


def main() -> int:
    this_script = Path(__file__).resolve()
    repo_root = this_script.parents[2]
    roots = [
        repo_root / "backend",
        repo_root / "ml",
    ]
    files = find_python_files(roots, exclude_self=this_script)
    all_errors: list[str] = []

    all_errors.extend(check_no_read_csv_parquet(files))
    all_errors.extend(check_gc_in_heavy_functions(files))

    if all_errors:
        for err in all_errors:
            print(err, file=sys.stderr)
        return 1
    print("check-directive-python: PASS (lazy load + GC cleanup)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
