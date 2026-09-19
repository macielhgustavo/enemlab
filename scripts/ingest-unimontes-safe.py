#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "ingest-objective-mirror-safe.py"

spec = importlib.util.spec_from_file_location("unimontes_objective_base", BASE_SCRIPT)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

core = base.core
core.PARSER_VERSION = "inbox-unimontes@0.2.0"
core.PROFILES["unimontes"] = {
    "institution": "UNIMONTES",
    "slug": "universidade-estadual-montes-claros",
    "region": "sudeste",
    "prefix": "unimontes",
    "package_deny": ("paes", "seriado"),
    "document_deny": ("paes", "seriado"),
}

_original_document_allowed = core.document_allowed
_original_parse_key_text = core.parse_key_text

def _identity(document, title: str = "") -> str:
    return core.norm(f"{title} {getattr(document, 'member', '')} {getattr(document, 'leaf', '')}")

def document_allowed(profile_name: str, profile: dict, title: str, document) -> bool:
    if not _original_document_allowed(profile_name, profile, title, document):
        return False
    identity = _identity(document, title)
    if "paes" in identity or "seriado" in identity or "grupo 2" in identity:
        return False

    role = core.probe.classify_role(document.leaf, document.first_text)
    if role == "exam":
        # Canonical regular lane: Group 1, biological sciences booklet.
        return "grupo 1" in identity and ("biologic" in identity or "biolog" in identity)
    if role == "answer-key":
        return "grupo 1" in identity
    return True

def _caderno_101(text: str) -> str | None:
    match = re.search(
        r"CADERNO\s+101\b(.*?)(?=CADERNO\s+\d+\b|\Z)",
        core.probe.utf8_safe(text),
        re.I | re.S,
    )
    return match.group(1) if match else None

def _table_answers(block: str) -> dict[int, str]:
    answers: dict[int, str] = {}
    lines = [core.compact(line) for line in block.splitlines() if core.compact(line)]
    for index, line in enumerate(lines):
        if not re.search(r"N[ºO°]?\s*QUEST", line, re.I):
            continue
        answer_index = index + 1
        while answer_index < len(lines) and not re.search(r"\bRESPOSTAS\b", lines[answer_index], re.I):
            answer_index += 1
        if answer_index >= len(lines):
            continue

        number_groups = re.split(r"N[ºO°]?\s*QUEST(?:ÕES|OES)", line, flags=re.I)[1:]
        answer_groups = re.split(r"\bRESPOSTAS\b", lines[answer_index], flags=re.I)[1:]
        for numbers_text, answers_text in zip(number_groups, answer_groups):
            numbers = [int(raw) for raw in re.findall(r"\b\d{1,2}\b", numbers_text)]
            values = [raw.upper() for raw in re.findall(r"\b([A-E])\b", answers_text, re.I)]
            for number, value in zip(numbers, values):
                if 1 <= number <= 45:
                    # The foreign-language row is Spanish first and English second.
                    # Overwriting later duplicate identities therefore selects English.
                    answers[number] = value
    return answers

def parse_key_text(text: str) -> dict:
    block = _caderno_101(text)
    if block is None:
        return _original_parse_key_text(text)

    # 2024 publishes Caderno 101 as dense number/letter pairs.
    direct = {
        int(number): value.upper()
        for number, value in re.findall(
            r"(?<!\d)([1-9]|[1-3]\d|4[0-5])\s+([A-E])\b",
            block,
            re.I,
        )
    }
    answers = direct if len(direct) >= 40 else _table_answers(block)
    if len(answers) < 40:
        return _original_parse_key_text(text)

    answers = {number: answers[number] for number in sorted(answers) if 1 <= number <= 45}
    contiguous = 0
    for number in range(1, 46):
        if number in answers:
            contiguous += 1
        else:
            break
    return {
        "answers": answers,
        "expectedMax": 45,
        "contiguous": contiguous,
        "conflicts": [],
        "score": (contiguous, len(answers), 45),
    }

def candidate_rank(candidate):
    language = getattr(candidate, "_unimontes_language", None)
    language_rank = 2 if language == "english" else 1 if language is None else 0
    return (language_rank, *candidate.score)

def parse_question_pages(pages: list[str], *, mode: str):
    candidates = []
    current = None
    active_language = None

    def finish():
        nonlocal current
        if not current:
            return
        alternatives = {
            key: core.compact(" ".join(parts))
            for key, parts in current["alternatives"].items()
            if core.compact(" ".join(parts))
        }
        candidate = core.Candidate(
            number=current["number"],
            statement=core.compact(" ".join(current["statement"])),
            alternatives=alternatives,
            page=current["page"],
            mode=mode,
        )
        candidate._unimontes_language = current.get("language")
        if candidate.complete:
            candidates.append(candidate)
        current = None

    def begin(number: int, page_no: int, statement: str = ""):
        nonlocal current
        finish()
        current = {
            "number": number,
            "statement": [statement] if statement else [],
            "alternatives": {},
            "active": None,
            "page": page_no,
            "language": active_language,
        }

    for page_no, page in enumerate(pages, 1):
        for raw in page.splitlines():
            line = core.compact(raw)
            if not line:
                continue

            language = core.language_context(line)
            if language:
                active_language = language

            standalone = base.QUESTION_ONLY_RE.match(line)
            if standalone:
                number = int(standalone.group(1))
                if 1 <= number <= 150:
                    begin(number, page_no)
                    continue

            match = core.QUESTION_RE.match(line)
            if match:
                number = int(match.group(1))
                if 1 <= number <= 150:
                    begin(number, page_no, match.group(2))
                    continue

            if current is None:
                continue

            inline = base.split_inline_alternatives(line)
            if inline:
                prefix, alternatives = inline
                if prefix:
                    if current["active"]:
                        current["alternatives"].setdefault(current["active"], []).append(prefix)
                    else:
                        current["statement"].append(prefix)
                for letter, value in alternatives.items():
                    current["alternatives"].setdefault(letter, []).append(value)
                    current["active"] = letter
                continue

            alternative = core.ALT_RE.match(line)
            if alternative:
                letter = (alternative.group(1) or alternative.group(2) or alternative.group(3)).upper()
                value = alternative.group(4)
                current["alternatives"].setdefault(letter, []).append(value)
                current["active"] = letter
            elif current["active"]:
                current["alternatives"].setdefault(current["active"], []).append(line)
            else:
                current["statement"].append(line)
    finish()
    return candidates

def parse_question_document(document):
    grouped = defaultdict(list)
    declared_counts = []
    for layout, mode in ((False, "plain"), (True, "layout")):
        try:
            pages = [core.probe.utf8_safe(page) for page in core.base.pdf_pages(document, layout=layout)]
        except Exception:
            continue
        for page in pages[:3]:
            for match in base.DECLARED_COUNT_RE.finditer(page):
                value = int(match.group(1))
                if 10 <= value <= 150:
                    declared_counts.append(value)
        for candidate in parse_question_pages(pages, mode=mode):
            grouped[candidate.number].append(candidate)
    result = {number: max(items, key=candidate_rank) for number, items in grouped.items()}
    document._objective_declared_count = max(declared_counts, default=0)
    return result

core.document_allowed = document_allowed
core.parse_key_text = parse_key_text
base.parse_question_pages = parse_question_pages
base.parse_question_document = parse_question_document
core.parse_question_pages = parse_question_pages
core.parse_question_document = parse_question_document

def main() -> int:
    return core.main()

if __name__ == "__main__":
    raise SystemExit(main())
