#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "ingest-objective-mirror-safe.py"

spec = importlib.util.spec_from_file_location("uel_objective_base", BASE_SCRIPT)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

core = base.core
core.PARSER_VERSION = "inbox-uel@0.2.0"
core.PROFILES["uel"] = {
    "institution": "UEL",
    "slug": "universidade-estadual-londrina",
    "region": "sul",
    "prefix": "uel",
    "package_deny": (
        "2 fase",
        "2a fase",
        "segunda fase",
        "segunda-fase",
        "2-fase",
    ),
    "document_deny": (
        "2 fase",
        "2a fase",
        "segunda fase",
        "segunda-fase",
        "2-fase",
        "respostas esperadas",
    ),
}

_original_document_allowed = core.document_allowed
_original_process = core.process

def _variant_number(value: str) -> int | None:
    match = re.search(r"\btipo\s*[-_ ]?([123])\b", core.norm(value))
    return int(match.group(1)) if match else None

def document_allowed(profile_name: str, profile: dict, title: str, document) -> bool:
    if not _original_document_allowed(profile_name, profile, title, document):
        return False
    identity = f"{getattr(document, 'member', '')} {getattr(document, 'leaf', '')}"
    normalized = core.norm(identity)

    # UEL publishes language/variant-specific day-1 booklets and keys. Keep a
    # deterministic canonical lane: English, and type 1 whenever the member
    # explicitly carries a type. Untyped English keys remain eligible.
    if "espanhol" in normalized or "lingua espanhola" in normalized:
        return False
    variant = _variant_number(identity)
    if variant is not None and variant != 1:
        return False
    return True

def process(profile_name: str, paths: list[Path]):
    editions, summary = _original_process(profile_name, paths)
    discarded = [
        {
            "editionId": item["editionId"],
            "source": item["source"],
            "reason": "no-native-objective-pair",
        }
        for item in editions
        if item["summary"]["expectedQuestions"] == 0
        and item["summary"]["extractedQuestions"] == 0
    ]
    editions = [
        item for item in editions
        if item["summary"]["expectedQuestions"] > 0
        or item["summary"]["extractedQuestions"] > 0
    ]
    summary.update({
        "editions": len(editions),
        "expectedQuestions": sum(item["summary"]["expectedQuestions"] for item in editions),
        "extractedQuestions": sum(item["summary"]["extractedQuestions"] for item in editions),
        "completeUnits": sum(item["summary"]["completeUnits"] for item in editions),
        "missingIdentities": sum(item["summary"]["missingIdentities"] for item in editions),
        "visualDependencies": sum(item["summary"]["visualDependencies"] for item in editions),
        "cycles": [
            {
                "editionId": item["editionId"],
                "year": item["year"],
                "term": item.get("term"),
                "modality": item["modality"],
                **item["summary"],
                "unitCoverage": [
                    f"{unit['extractedQuestions']}/{unit['expectedQuestions']}"
                    for unit in item["units"]
                ],
            }
            for item in editions
        ],
        "discardedEditions": discarded,
    })
    return editions, summary

core.document_allowed = document_allowed
core.process = process

def main() -> int:
    return core.main()

if __name__ == "__main__":
    raise SystemExit(main())
