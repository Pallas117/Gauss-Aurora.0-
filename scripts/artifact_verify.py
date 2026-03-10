#!/usr/bin/env python3
"""Verify a model artifact directory: read manifest.json and compare checkpoint checksum. Exit 0 if ok."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: artifact_verify.py <artifact_version_dir>", file=sys.stderr)
        return 2
    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 2
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        print(f"Missing manifest.json in {root}", file=sys.stderr)
        return 2
    try:
        raw = manifest_path.read_text()
        manifest = json.loads(raw)
    except (OSError, json.JSONDecodeError) as e:
        print(f"Failed to read manifest: {e}", file=sys.stderr)
        return 2
    checksum_claimed = (manifest.get("checksum") or "").strip()
    if not checksum_claimed:
        print("manifest.json missing 'checksum'", file=sys.stderr)
        return 2
    if checksum_claimed.startswith("sha256:"):
        checksum_claimed = checksum_claimed[7:]
    primary = manifest.get("primary_file") or "checkpoint.pt"
    ckpt_path = root / primary
    if not ckpt_path.is_file():
        print(f"Checkpoint file not found: {ckpt_path}", file=sys.stderr)
        return 2
    h = hashlib.sha256()
    with open(ckpt_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    computed = h.hexdigest()
    if computed != checksum_claimed:
        print(f"Checksum mismatch: computed {computed}, manifest {checksum_claimed}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
