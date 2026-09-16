#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "ingest-objective-mirror-safe.py"

spec = importlib.util.spec_from_file_location("unicamp_objective_base", BASE_SCRIPT)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

core = base.core
core.PARSER_VERSION = "inbox-unicamp@0.3.0"
core.PROFILES["unicamp"] = {
    "institution": "UNICAMP",
    "slug": "universidade-estadual-campinas",
    "region": "sudeste",
    "prefix": "unicamp",
    "package_deny": ("indigena", "vagas remanescentes"),
    "document_deny": (
        "2 fase",
        "2a fase",
        "segunda fase",
        "segunda-fase",
        "2-fase",
        "fase 2",
        "fase2",
        "respostas esperadas",
    ),
}

_original_document_allowed = core.document_allowed
_original_parse_key_text = core.parse_key_text
_original_process = core.process


def document_allowed(profile_name: str, profile: dict, title: str, document) -> bool:
    if not _original_document_allowed(profile_name, profile, title, document):
        return False
    # UNICAMP archives commonly encode the phase in directory names instead of the
    # PDF leaf. Inspect the full member path so 2nd-phase material never outranks the
    # objective 1st-phase booklet.
    member = core.norm(getattr(document, "member", ""))
    if any(marker in member for marker in (
        "segunda fase", "2 fase", "2a fase", "fase 2", "fase2", "respostas esperadas",
    )):
        return False
    return True


def edition(meta: dict, path: Path, documents=None):
    # The regular UNICAMP vestibular is annual. Strings such as "2026-2-fase" name
    # phase 2, not semester 2, so internal filenames cannot change the edition term.
    title = str(meta.get("title") or path.stem)
    match = core.YEAR_RE.search(title)
    if match:
        return int(match.group(1)), 1
    try:
        return int(meta.get("year")), 1
    except (TypeError, ValueError):
        return None, None


def parse_key_text(text: str) -> dict:
    # Keep the same canonical grammar as the repository's reviewed COMVEST ingester:
    # the first table belongs to the paired canonical booklet; later sections headed
    # "GABARITO DA PROVA" are other variants and must not be merged into it.
    upper = core.probe.utf8_safe(text).upper()
    body = upper.split("GABARITO DA PROVA", 1)[0]
    pairs = re.findall(r"\b0?([1-9][0-9]?|100)\s+([A-E]|\*)", body)
    answers = {}
    conflicts = set()
    for raw_number, token in pairs:
        number = int(raw_number)
        if not 1 <= number <= 72:
            continue
        value = None if token == "*" else token
        if number in answers and answers[number] != value:
            conflicts.add(number)
        else:
            answers[number] = value
    for number in conflicts:
        answers.pop(number, None)
    contiguous = 0
    for number in range(1, 73):
        if number in answers:
            contiguous += 1
        else:
            break
    if len(answers) >= 60 and not conflicts:
        return {
            "answers": answers,
            "expectedMax": 72,
            "contiguous": contiguous,
            "conflicts": [],
            "score": (contiguous, len(answers), 72),
        }
    return _original_parse_key_text(text)


def process(profile_name: str, paths: list[Path]):
    editions, summary = _original_process(profile_name, paths)
    discarded = [
        {
            "editionId": item["editionId"],
            "source": item["source"],
            "reason": "no-first-phase-objective-signal",
        }
        for item in editions
        if item["summary"]["expectedQuestions"] == 0
        and item["summary"]["extractedQuestions"] == 0
    ]
    editions = [
        item
        for item in editions
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
core.edition = edition
core.parse_key_text = parse_key_text
core.process = process


def main() -> int:
    return core.main()


if __name__ == "__main__":
    raise SystemExit(main())
