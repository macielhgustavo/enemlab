#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

CORE_SCRIPT = Path(__file__).resolve().with_name("ingest-urca-safe.py")
spec = importlib.util.spec_from_file_location("ingest_urca_safe_core", CORE_SCRIPT)
assert spec and spec.loader
core = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = core
spec.loader.exec_module(core)

core.PARSER_VERSION = "inbox-urca@0.2.0"
# URCA booklets use headings such as "QUESTÃO 01" followed by lowercase a.–e.
# Keep the older numeric form as well so the rule is format-family based, not year based.
core.Q_RE = re.compile(
    r"^\s*(?:(?:QUEST[ÃA]O)\s*)?0?(\d{1,3})\s*[.:)-]?\s*(.*)$",
    re.I,
)

if __name__ == "__main__":
    raise SystemExit(core.main())
