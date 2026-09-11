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

mirror.core.PARSER_VERSION = "inbox-uece@0.7.0"

_original_is_exam = mirror.is_exam


def source_phase(source):
    value = mirror.core.norm(" ".join((source.title, str(source.path))))
    if re.search(r"\b(?:2(?:\s+a)?|segunda)\s+fase\b", value):
        return 2
    if re.search(r"\b(?:1(?:\s+a)?|primeira)\s+fase\b", value):
        return 1
    return None


def is_exam(document):
    text = mirror.core.norm(document.first_text)
    if mirror.core.phase(document.first_text, 2) and not mirror.core.phase(document.first_text, 1):
        return False

    expected_count = mirror.expected(document)
    strong_first_phase_booklet = bool(
        mirror.core.phase(document.first_text, 1)
        and expected_count
        and document.page_count >= 8
        and any(
            marker in text
            for marker in ("prova de conhecimentos gerais", "conhecimentos gerais", "caderno de prova")
        )
    )
    answer_key_content = (
        "grade definitiva de respostas" in text
        or "grade preliminar de respostas" in text
        or (document.page_count <= 5 and "gabarito" in text and "caderno de prova" not in text)
    )
    if strong_first_phase_booklet and not answer_key_content:
        return True
    return _original_is_exam(document)


def scan(source):
    phase = source_phase(source)
    if phase == 2:
        return [], mirror.source_info(source, reason="non-first-phase-source:second-phase"), None
    return mirror.scan(source)


mirror.core.is_exam = is_exam
mirror.core.scan = scan

if __name__ == "__main__":
    raise SystemExit(mirror.core.main())
