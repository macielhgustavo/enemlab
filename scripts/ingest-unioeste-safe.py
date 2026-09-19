#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "ingest-objective-mirror-safe.py"

spec = importlib.util.spec_from_file_location("unioeste_objective_base", BASE_SCRIPT)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

core = base.core
core.PARSER_VERSION = "inbox-unioeste@0.1.0"
core.PROFILES["unioeste"] = {
    "institution": "UNIOESTE",
    "slug": "universidade-estadual-oeste-parana",
    "region": "sul",
    "prefix": "unioeste",
    "package_deny": ("ead",),
    "document_deny": ("seriado", "espanhol"),
}

_original_document_allowed = core.document_allowed
_original_choose_exam = core.choose_exam
_original_descriptor = core.descriptor

def document_allowed(profile_name: str, profile: dict, title: str, document) -> bool:
    if not _original_document_allowed(profile_name, profile, title, document):
        return False
    # Admission modality/language can be encoded in an archive directory rather than
    # the PDF leaf. Inspect the full member path as well so the regular corpus never
    # absorbs seriado or the alternate Spanish booklet.
    identity = core.norm(f"{getattr(document, 'member', '')} {getattr(document, 'leaf', '')}")
    return "seriado" not in identity and "espanhol" not in identity

def choose_complementary_exam(items: list[dict]) -> dict | None:
    anchor = _original_choose_exam(items)
    if anchor is None or len(items) <= 1:
        return anchor
    merged = {}
    for item in items:
        for number, candidate in item["questions"].items():
            previous = merged.get(number)
            if previous is None or candidate.score > previous.score:
                merged[number] = candidate
    result = dict(anchor)
    result["questions"] = merged
    result["sourceDocuments"] = list(items)
    return result

def aggregate_descriptor(document, record: dict) -> dict:
    payload = _original_descriptor(document, record)
    sources = record.get("sourceDocuments") or []
    if len(sources) > 1:
        payload["members"] = [
            _original_descriptor(item["document"], item)
            for item in sources
        ]
        payload["aggregate"] = True
    return payload

core.document_allowed = document_allowed
core.choose_exam = choose_complementary_exam
core.descriptor = aggregate_descriptor

def main() -> int:
    return core.main()

if __name__ == "__main__":
    raise SystemExit(main())
