#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "ingest-objective-mirror-safe.py"

spec = importlib.util.spec_from_file_location("objective_mirror_wave2_base", BASE_SCRIPT)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

base.core.PARSER_VERSION = "inbox-objective-mirror@0.3.0"
base.core.PROFILES.update({
    "unemat": {
        "institution": "UNEMAT",
        "slug": "universidade-estado-mato-grosso",
        "region": "centro-oeste",
        "prefix": "unemat",
        "package_deny": ("vestibular especial", "seletivo simplificado especial"),
        "document_deny": (),
    },
    "unioeste": {
        "institution": "UNIOESTE",
        "slug": "universidade-estadual-oeste-parana",
        "region": "sul",
        "prefix": "unioeste",
        "package_deny": ("ead",),
        # Canonical regular corpus: English morning booklet + common afternoon booklet.
        # Seriado is a separate admission modality and Spanish is an alternate language form.
        "document_deny": ("seriado", "espanhol"),
    },
    "uel": {
        "institution": "UEL",
        "slug": "universidade-estadual-londrina",
        "region": "sul",
        "prefix": "uel",
        # Keep only the objective first-day/first-phase regular corpus.
        "package_deny": ("2 fase", "2a fase", "segunda fase"),
        # When multiple equivalent forms exist, keep the canonical English type/form 1.
        "document_deny": (
            "2 fase", "2a fase", "segunda fase", "espanhol", "frances",
            "tipo 2", "tipo 3", "prova 02", "prova 03", "gabarito 02", "gabarito 03",
        ),
    },
})
base.PROFILES = base.core.PROFILES

# Some vestibulares split one objective unit across complementary booklets. The base
# ingestor intentionally chooses a single exam document; wave 2 instead composes all
# allowed, non-overlapping candidates from the same archive only. Candidate collisions
# retain the strongest parse, so variants are never cross-paired between packages.
_original_choose_exam = base.core.choose_exam
_original_descriptor = base.core.descriptor


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


base.core.choose_exam = choose_complementary_exam
base.core.descriptor = aggregate_descriptor


def main() -> int:
    return base.core.main()


if __name__ == "__main__":
    raise SystemExit(main())
