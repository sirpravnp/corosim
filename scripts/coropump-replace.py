#!/usr/bin/env python3
"""Ordered identifier and key renames for CoroPump C1 (tracked files only)."""
from __future__ import annotations
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_PREFIX = ("docs/superpowers/",)
SKIP_EXACT = {
    "src/sim/aliases.ts",
    "tests/aliases.test.ts",
    "scripts/rename-coropump.sh",
    "scripts/coropump-replace.py",
}

REPLACEMENTS: list[tuple[str, str]] = [
    ("IMPELLA POSITION WRONG", "COROPUMP POSITION WRONG"),
    ("rv-infarct-impella", "rv-infarct-coropump"),
    ("impella-deep", "coropump-deep"),
    ("impella-aortic", "coropump-aortic"),
    ("shock-impella", "shock-coropump"),
    ("IMPELLA_RP", "COROPUMP_RP"),
    ("ImpellaRp", "CoroPumpRp"),
    ("impellaRp", "coroPumpRp"),
    ("IMPELLA_SUCTION", "COROPUMP_SUCTION"),
    ("IMPELLA_CONSOLE", "COROPUMP_CONSOLE"),
    ("IMPELLA_POSITION", "COROPUMP_POSITION"),
    ("IMPELLA", "COROPUMP"),
    ("ImpellaModelName", "CoroPumpModelName"),
    ("ImpellaPosition", "CoroPumpPosition"),
    ("ImpellaReadout", "CoroPumpReadout"),
    ("ImpellaConsole", "CoroPumpConsole"),
    ("SwitchableImpella", "SwitchableCoroPump"),
    ("DEFAULT_IMPELLA", "DEFAULT_COROPUMP"),
    ("Impella", "CoroPump"),
    ("impella", "coroPump"),
]

# User-visible prose after identifiers
PROSE: list[tuple[str, str]] = [
    ("Impella CP", "CoroPump CP"),
    ("right-sided Impella", "right-sided CoroPump"),
    ("an Impella", "a CoroPump"),
    ("the Impella", "the CoroPump"),
    ("Impella", "CoroPump"),
    ("impella", "coroPump"),
]


def tracked_files() -> list[str]:
    out = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True)
    return [l.strip() for l in out.splitlines() if l.strip()]


def should_skip(path: str) -> bool:
    if path in SKIP_EXACT:
        return True
    return any(path.startswith(p) for p in SKIP_PREFIX)


def main() -> None:
    for rel in tracked_files():
        if should_skip(rel):
            continue
        p = ROOT / rel
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        orig = text
        for a, b in REPLACEMENTS:
            text = text.replace(a, b)
        for a, b in PROSE:
            text = text.replace(a, b)
        if text != orig:
            p.write_text(text, encoding="utf-8")
            print("updated", rel)


if __name__ == "__main__":
    main()
