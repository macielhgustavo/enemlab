#!/usr/bin/env python3
"""Compatibility entrypoint for the current FUVEST regional OCR worker."""

from __future__ import annotations

import runpy
from pathlib import Path

_MODULE = runpy.run_path(
    str(Path(__file__).with_name("recover-fuvest-region-ocr-v4.py")),
    run_name="fuvest_regional_ocr_v4_entry",
)

for _name, _value in _MODULE.items():
    if not _name.startswith("__"):
        globals()[_name] = _value

if __name__ == "__main__":
    raise SystemExit(_MODULE["main"]())
