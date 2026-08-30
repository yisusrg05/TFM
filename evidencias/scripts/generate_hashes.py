#!/usr/bin/env python3
"""Genera inventarios SHA-256 reproducibles para las evidencias."""

from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_ROOT = ROOT / "evidencias"


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest().upper()


def files_below(root: Path):
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.name != "SHA256SUMS.txt"
    )


def write_inventory(root: Path) -> None:
    rows = []
    for path in files_below(root):
        relative = path.relative_to(root).as_posix()
        rows.append(f"{digest(path)}  {relative}")
    (root / "SHA256SUMS.txt").write_text("\n".join(rows) + "\n", encoding="utf-8")


def main() -> None:
    write_inventory(EVIDENCE_ROOT / "fase1")
    write_inventory(EVIDENCE_ROOT / "fase2")
    write_inventory(EVIDENCE_ROOT)
    print(EVIDENCE_ROOT / "SHA256SUMS.txt")


if __name__ == "__main__":
    main()
