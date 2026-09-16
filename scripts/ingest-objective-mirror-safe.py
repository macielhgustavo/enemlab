#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CORE_SCRIPT = SCRIPT_DIR / "ingest-objective-mirror-core.py"


def load_core():
    spec = importlib.util.spec_from_file_location("objective_mirror_core", CORE_SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


core = load_core()
core.PARSER_VERSION = "inbox-objective-mirror@0.2.0"
PROFILES = core.PROFILES
modality = core.modality
document_allowed = core.document_allowed
edition = core.edition

QUESTION_ONLY_RE = re.compile(r"^\s*QUEST(?:ÃO|AO)\s*0?(\d{1,3})\s*[.)\-–—:]?\s*$", re.I)
INLINE_ALT_RE = re.compile(r"(?:^|\s)(?:\(([A-Ea-e])\)|([A-Ea-e])\s*[.)\-–—:])\s*")
DECLARED_COUNT_RE = re.compile(r"\b(?:cont[eé]m|compost[oa]\s+de)\s+(\d{2,3})\s+(?:\([^)]*\)\s+)?quest(?:ões|oes)\s+objetivas?\b", re.I)


def split_inline_alternatives(line: str):
    matches = list(INLINE_ALT_RE.finditer(line))
    if len(matches) < 4:
        return None
    letters = [(m.group(1) or m.group(2)).upper() for m in matches]
    if letters[:4] != ["A", "B", "C", "D"]:
        return None
    prefix = core.compact(line[: matches[0].start()])
    alternatives = {}
    for index, match in enumerate(matches):
        letter = (match.group(1) or match.group(2)).upper()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
        text = core.compact(line[start:end])
        if text:
            alternatives[letter] = text
    return prefix, alternatives


def parse_question_pages(pages: list[str], *, mode: str):
    candidates = []
    current = None

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
        }

    for page_no, page in enumerate(pages, 1):
        for raw in page.splitlines():
            line = core.compact(raw)
            if not line:
                continue

            standalone = QUESTION_ONLY_RE.match(line)
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

            inline = split_inline_alternatives(line)
            if inline:
                prefix, alternatives = inline
                if prefix:
                    if current["active"]:
                        current["alternatives"].setdefault(current["active"], []).append(prefix)
                    else:
                        current["statement"].append(prefix)
                for letter, text in alternatives.items():
                    current["alternatives"].setdefault(letter, []).append(text)
                    current["active"] = letter
                continue

            alternative = core.ALT_RE.match(line)
            if alternative:
                letter = (alternative.group(1) or alternative.group(2) or alternative.group(3)).upper()
                text = alternative.group(4)
                current["alternatives"].setdefault(letter, []).append(text)
                current["active"] = letter
            elif current["active"]:
                current["alternatives"].setdefault(current["active"], []).append(line)
            else:
                current["statement"].append(line)
    finish()
    return candidates


ORIGINAL_PARSE_KEY_TEXT = core.parse_key_text


def parse_key_text(text: str) -> dict:
    payload = ORIGINAL_PARSE_KEY_TEXT(text)
    contiguous = payload.get("contiguous", 0)
    maximum = payload.get("expectedMax", 0)
    # Dense runs from question 1 are authoritative. Stray years/page/table numbers after
    # the run must not inflate a 52/54/60-question exam into a fake 64/127-question exam.
    if contiguous >= 20:
        expected = contiguous
        payload["answers"] = {n: v for n, v in payload["answers"].items() if n <= expected}
        payload["conflicts"] = [n for n in payload.get("conflicts", []) if n <= expected]
        payload["expectedMax"] = expected
        payload["score"] = (contiguous, len(payload["answers"]), expected)
    elif maximum > 80 and contiguous == 0:
        payload["expectedMax"] = 0
        payload["score"] = (0, len(payload.get("answers", {})), 0)
    return payload


def parse_question_document(document):
    grouped = defaultdict(list)
    declared_counts = []
    for layout, mode in ((False, "plain"), (True, "layout")):
        try:
            pages = [core.probe.utf8_safe(page) for page in core.base.pdf_pages(document, layout=layout)]
        except Exception:
            continue
        for page in pages[:3]:
            for match in DECLARED_COUNT_RE.finditer(page):
                value = int(match.group(1))
                if 10 <= value <= 150:
                    declared_counts.append(value)
        for candidate in parse_question_pages(pages, mode=mode):
            grouped[candidate.number].append(candidate)
    result = {number: max(items, key=lambda item: item.score) for number, items in grouped.items()}
    document._objective_declared_count = max(declared_counts, default=0)
    return result


core.parse_key_text = parse_key_text
core.parse_question_pages = parse_question_pages
core.parse_question_document = parse_question_document


def main() -> int:
    return core.main()


if __name__ == "__main__":
    raise SystemExit(main())
