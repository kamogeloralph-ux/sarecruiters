#!/usr/bin/env python3
"""Generate the downloadable Terms PDF from the canonical Markdown policy.

The HTML page and this PDF intentionally share one source of truth:
terms/terms-and-conditions.md.
"""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "terms" / "terms-and-conditions.md"
OUTPUT = ROOT / "docs" / "SA-Recruiters-Terms-and-Conditions.pdf"

if not SOURCE.is_file():
    raise SystemExit(f"Missing source policy: {SOURCE}")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(["manus-md-to-pdf", str(SOURCE), str(OUTPUT)], check=True)
print(f"Generated {OUTPUT}")
