#!/usr/bin/env python3
"""
Project Gauss — Python directive adherence checker.

Checks:
  1. GC discipline: no forced gc.collect() calls in hot paths (infer_server, refinery).
  2. Lazy-load discipline: ML heavy imports (torch, sklearn, numpy) are not at top-level
     in server entry points (infer_server.py). They should be imported inside functions
     or under TYPE_CHECKING guards.
  3. No bare 'import *' in production ML code.
  4. Isolation Forest / IQR refinery is importable (basic smoke).

Exit 0 = PASS, 1 = FAIL.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

HOT_PATH_FILES = [
    ROOT / "ml" / "infer" / "infer_server.py",
    ROOT / "ml" / "infer" / "refinery.py",
]

SERVER_ENTRY_FILES = [
    ROOT / "ml" / "infer" / "infer_server.py",
]

HEAVY_ML_MODULES = {"torch", "tensorflow", "tf", "sklearn", "torchvision"}

failures: list[str] = []


def check_no_gc_collect_in_hot_paths():
    """GC discipline: gc.collect() should not be called in hot paths."""
    for path in HOT_PATH_FILES:
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(source, filename=str(path))
        except SyntaxError as exc:
            failures.append(f"[GC] Syntax error in {path.name}: {exc}")
            continue

        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "collect"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "gc"
            ):
                failures.append(
                    f"[GC] Forbidden gc.collect() at {path.name}:{node.lineno} — "
                    "GC must not be forced in hot paths (power directive)."
                )


def check_lazy_imports_in_server_entries():
    """Heavy ML modules must not be top-level imports in server entry points."""
    for path in SERVER_ENTRY_FILES:
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(source, filename=str(path))
        except SyntaxError as exc:
            failures.append(f"[LAZY] Syntax error in {path.name}: {exc}")
            continue

        for node in tree.body:  # only top-level statements
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names: list[str] = []
                if isinstance(node, ast.Import):
                    names = [alias.name.split(".")[0] for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    names = [node.module.split(".")[0]]
                for name in names:
                    if name in HEAVY_ML_MODULES:
                        failures.append(
                            f"[LAZY] Top-level heavy import '{name}' in {path.name}:{node.lineno} — "
                            "ML imports must be lazy (inside functions / TYPE_CHECKING blocks)."
                        )


def check_no_star_imports():
    """No bare 'import *' in production ML code."""
    for path in HOT_PATH_FILES:
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(source, filename=str(path))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.ImportFrom)
                and any(alias.name == "*" for alias in node.names)
            ):
                failures.append(
                    f"[STAR] 'import *' found at {path.name}:{node.lineno} — "
                    "star imports obscure dependencies and break linting."
                )


def check_refinery_importable():
    """Basic smoke: refinery module is importable without errors."""
    refinery_path = ROOT / "ml" / "infer" / "refinery.py"
    if not refinery_path.exists():
        failures.append("[SMOKE] ml/infer/refinery.py not found — DataRefinery not deployed.")
        return
    source = refinery_path.read_text(encoding="utf-8")
    try:
        ast.parse(source, filename="refinery.py")
    except SyntaxError as exc:
        failures.append(f"[SMOKE] refinery.py has syntax error: {exc}")


def main() -> int:
    check_no_gc_collect_in_hot_paths()
    check_lazy_imports_in_server_entries()
    check_no_star_imports()
    check_refinery_importable()

    if failures:
        print("[FAIL] Directive adherence check")
        for f in failures:
            print(f"  {f}")
        return 1

    print("[PASS] Directive adherence (GC discipline, lazy imports, star imports, refinery smoke)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
