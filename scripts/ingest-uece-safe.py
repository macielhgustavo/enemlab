#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

MIRROR_SCRIPT = Path(__file__).resolve().with_name("ingest-uece-mirror.py")
spec = importlib.util.spec_from_file_location("ingest_uece_mirror_guarded", MIRROR_SCRIPT)
assert spec and spec.loader
mirror = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mirror
spec.loader.exec_module(mirror)

mirror.core.PARSER_VERSION = "inbox-uece@0.6.0"


def source_phase(source):
    value = mirror.core.norm(" ".join((source.title, str(source.path))))
    if re.search(r"\b(?:2(?:\s+a)?|segunda)\s+fase\b", value):
        return 2
    if re.search(r"\b(?:1(?:\s+a)?|primeira)\s+fase\b", value):
        return 1
    return None


def scan(source):
    phase = source_phase(source)
    if phase == 2:
        return [], mirror.source_info(source, reason="non-first-phase-source:second-phase"), None
    return mirror.scan(source)


mirror.core.scan = scan

if __name__ == "__main__":
    raise SystemExit(mirror.core.main())
