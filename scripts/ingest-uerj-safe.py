#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "ingest-objective-mirror-safe.py"

spec = importlib.util.spec_from_file_location("uerj_objective_base", BASE_SCRIPT)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

core = base.core
core.PARSER_VERSION = "inbox-uerj@0.1.0"
core.PROFILES["uerj"] = {
    "institution": "UERJ",
    "slug": "universidade-estado-rio-janeiro-1",
    "region": "sudeste",
    "prefix": "uerj",
    "package_deny": ("discursiv",),
    "document_deny": ("discursiv",),
}

def main() -> int:
    return core.main()

if __name__ == "__main__":
    raise SystemExit(main())
