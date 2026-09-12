#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CORE_SCRIPT = SCRIPT_DIR / "ingest-uneb-safe.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


core = load_module("ingest_uneb_safe_core_v2", CORE_SCRIPT)
core.PARSER_VERSION = "inbox-uneb@0.2.0"

# Corrected UNEB booklets encode annulments inline as “(Questão anulada)”
# instead of a letter. Convert only that explicit marker to an internal X
# sentinel; emitted corpus questions keep correctAlternative=null + annulled=true.
ANNULLED_RE = re.compile(r"\(\s*QUEST[ÃA]O\s+ANULADA\s*\)", re.I)
core.CORRECT_RE = re.compile(
    r"^\s*\(?\s*(?:CORRETA|RESPOSTA\s+CORRETA)\s*:\s*([A-EX])\s*\)?\s*$",
    re.I,
)
_original_parse_inline_text = core.parse_inline_text


def parse_inline_text(pages: list[str]):
    normalized = [ANNULLED_RE.sub("(Correta: X)", page) for page in pages]
    return _original_parse_inline_text(normalized)


core.parse_inline_text = parse_inline_text


def build_unit(year: int, day_no: int, bucket: dict) -> dict:
    combined = core.choose_combined(bucket.get("combined", []))
    key = core.choose_key(bucket.get("keys", []))
    qmap = combined["questions"] if combined else {}
    expected = combined["expected"] if combined else 0
    if expected <= 0 and key:
        identities = sorted(key["identities"])
        if identities:
            maximum = max(identities)
            expected = maximum if maximum <= 100 and len(identities) / maximum >= 0.70 else len(identities)
    if expected <= 0:
        expected = max(qmap, default=0)

    questions = []
    missing = []
    incompatible = []
    missing_answers = []
    visual_dependencies = 0
    for number in range(1, expected + 1):
        candidate = qmap.get(number)
        if candidate is None or not candidate.complete:
            missing.append(number)
            continue
        if candidate.correct is None:
            missing_answers.append(number)
            continue
        annulled = candidate.correct == "X"
        if not annulled and candidate.correct not in candidate.alternatives:
            incompatible.append(number)
            continue
        visual = bool(core.VISUAL_RE.search(candidate.statement + " " + " ".join(candidate.alternatives.values())))
        visual_dependencies += int(visual)
        questions.append({
            "number": number,
            "subject": "Conhecimentos gerais",
            "statement": candidate.statement,
            "alternatives": [
                {"id": letter, "text": candidate.alternatives[letter]}
                for letter in ("A", "B", "C", "D", "E")
            ],
            "correctAlternative": None if annulled else candidate.correct,
            "annulled": annulled,
            "page": candidate.page,
            "flags": ["likely-visual-dependency"] if visual else [],
        })

    issues = []
    if combined is None:
        issues.append("exam-document-not-found")
    if combined is None and key is not None:
        issues.append(f"answer-key-only:{key['status']}")
    if missing:
        issues.append("missing-questions:" + ",".join(map(str, missing)))
    if missing_answers:
        issues.append("missing-inline-answers:" + ",".join(map(str, missing_answers)))
    if incompatible:
        issues.append("answer-not-in-alternatives:" + ",".join(map(str, incompatible)))

    alternate_variants = []
    if combined:
        for item in bucket.get("combined", []):
            if item is combined:
                continue
            alternate_variants.append({
                "reason": "alternate-language-booklet",
                "language": item["language"],
                "document": core.descriptor(item["document"], item),
            })

    extracted = len(questions)
    return {
        "id": f"day-{day_no}",
        "label": f"{day_no}º dia",
        "year": year,
        "expectedQuestions": expected,
        "extractedQuestions": extracted,
        "missingIdentities": max(0, expected - extracted),
        "structurallyComplete": expected > 0 and extracted == expected,
        "answerKeyStatus": "embedded-corrected" if combined else (key["status"] if key else "missing"),
        "canonicalLanguage": combined["language"] if combined else None,
        "visualDependencies": visual_dependencies,
        "examDocument": core.descriptor(combined["document"], combined) if combined else None,
        "answerKeyDocument": core.descriptor(combined["document"], combined) if combined else (core.descriptor(key["document"], key) if key else None),
        "alternateVariants": alternate_variants,
        "issues": issues,
        "questions": questions,
    }


core.build_unit = build_unit


if __name__ == "__main__":
    raise SystemExit(core.main())
