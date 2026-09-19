#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "ingest-objective-mirror-safe.py"

spec = importlib.util.spec_from_file_location("uerj_objective_base", BASE_SCRIPT)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

core = base.core
core.PARSER_VERSION = "inbox-uerj@0.3.0"
core.PROFILES["uerj"] = {
    "institution": "UERJ",
    "slug": "universidade-estado-rio-janeiro-1",
    "region": "sudeste",
    "prefix": "uerj",
    "package_deny": (),
    "document_deny": (),
}

QUESTION_LABEL_RE = re.compile(r"^quest(?:ao|ão)\s*0?(\d{1,3})\s*[.)\-–—:]?\s*$", re.I)
NUMBER_ONLY_RE = re.compile(r"^0?(\d{1,3})$")
NUMBER_ROW_RE = re.compile(r"^\s*\d{1,3}(?:\s+\d{1,3}){3,}\s*$")
PAIR_RE = re.compile(r"(?<!\d)0?(\d{1,3})\s+([A-D])(?![A-Z])", re.I)
LANGUAGE_NUMBERS = set(range(12, 19)) | set(range(23, 28))
SECTION_RESET = {
    "matematica", "biologia", "fisica", "quimica", "geografia", "historia",
    "ciencias da natureza", "ciencias humanas", "linguagens", "texto base",
}
ENGLISH_WORDS = {
    "the", "and", "of", "to", "in", "that", "this", "which", "following", "according",
    "paragraph", "sentence", "meaning", "refers", "another", "below", "above", "used",
    "throughout", "with", "from", "for", "does", "not", "main", "purpose", "can", "has",
    "have", "are", "is", "was", "were", "its", "their", "they", "it",
}
NON_ENGLISH_WORDS = {
    "el", "los", "las", "del", "una", "segun", "siguiente", "termino", "subrayado",
    "autora", "sentido", "lectura", "expresa", "repercusiones", "cuenta",
    "le", "les", "des", "une", "suivante", "reponse", "vers", "pronom", "reference",
    "adjectif", "remplacer", "changement", "dans", "formulee",
    "vestibular", "matematica", "assinale", "alternativa", "questao", "seguinte",
}


def _looks_english(candidate) -> bool:
    payload = core.norm(
        " ".join([candidate.statement, *candidate.alternatives.values()])
    )
    tokens = payload.split()
    english = sum(token in ENGLISH_WORDS for token in tokens)
    non_english = sum(token in NON_ENGLISH_WORDS for token in tokens)
    return english >= 3 and english >= non_english + 2


def _language(line: str) -> str | None:
    value = core.norm(line)
    if "ingles" in value:
        return "english"
    if "espanhol" in value:
        return "spanish"
    if "frances" in value:
        return "french"
    return None


def parse_question_pages(pages: list[str], *, mode: str):
    candidates = []
    current = None
    pending_heading = False
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
        candidate._uerj_language = current.get("language")
        if candidate.complete:
            candidates.append(candidate)
        current = None

    def begin(number: int, page_no: int):
        nonlocal current
        finish()
        current = {
            "number": number,
            "statement": [],
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
            normalized = core.norm(line)
            marker = _language(line)
            if marker and len(normalized) <= 40:
                active_language = marker
            elif normalized in SECTION_RESET:
                active_language = None

            if normalized == "questao":
                pending_heading = True
                continue
            if pending_heading:
                number_match = NUMBER_ONLY_RE.fullmatch(line)
                pending_heading = False
                if number_match:
                    number = int(number_match.group(1))
                    if 1 <= number <= 120:
                        begin(number, page_no)
                        continue

            same_line = QUESTION_LABEL_RE.match(line)
            if same_line:
                number = int(same_line.group(1))
                if 1 <= number <= 120:
                    begin(number, page_no)
                    continue

            generic = core.QUESTION_RE.match(line)
            if generic:
                number = int(generic.group(1))
                if 1 <= number <= 120:
                    finish()
                    current = {
                        "number": number,
                        "statement": [generic.group(2)],
                        "alternatives": {},
                        "active": None,
                        "page": page_no,
                        "language": active_language,
                    }
                    continue

            if current is None:
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


def parse_question_document(document):
    grouped = defaultdict(list)
    for layout, mode in ((False, "plain"), (True, "layout")):
        try:
            pages = [core.probe.utf8_safe(page) for page in core.base.pdf_pages(document, layout=layout)]
        except Exception:
            continue
        for candidate in parse_question_pages(pages, mode=mode):
            grouped[candidate.number].append(candidate)

    def rank(candidate):
        return (
            len(candidate.alternatives),
            candidate.mode == "layout",
            len(candidate.statement) + sum(len(value) for value in candidate.alternatives.values()),
        )

    selected = {}
    for number, items in grouped.items():
        if number in LANGUAGE_NUMBERS:
            # The same identities occur once per offered foreign language. A body is only
            # eligible for the canonical English lane when its own extracted text provides
            # deterministic lexical evidence of English; never pair a French/Spanish/Portuguese
            # body merely because it shares the same number.
            english = [item for item in items if _looks_english(item)]
            if not english:
                continue
            items = english
        selected[number] = max(items, key=rank)
    return selected


def _answer_tokens(lines: list[str], start: int, needed: int):
    values = []
    consumed = 0
    pending_anu = False
    for offset in range(start, min(len(lines), start + 5)):
        raw_tokens = re.findall(r"[A-Za-zÀ-ÿ]+", lines[offset])
        accepted_here = 0
        for raw in raw_tokens:
            token = core.norm(raw).upper()
            if pending_anu:
                if token == "LADA":
                    values.append(None)
                    accepted_here += 1
                pending_anu = False
                if token == "LADA":
                    continue
            if token in {"A", "B", "C", "D"}:
                values.append(token)
                accepted_here += 1
            elif token == "ANULADA":
                values.append(None)
                accepted_here += 1
            elif token == "ANU":
                pending_anu = True
        if accepted_here:
            consumed = offset - start + 1
        elif values and not pending_anu:
            break
        if len(values) >= needed:
            break
    return values[:needed], consumed


def parse_key_text(text: str) -> dict:
    lines = [core.compact(line) for line in core.probe.utf8_safe(text).splitlines() if core.compact(line)]
    occurrences = defaultdict(list)

    # Older UERJ answer keys are extracted as explicit number/letter pairs in visual columns.
    for line in lines:
        for number_text, token in PAIR_RE.findall(line):
            number = int(number_text)
            if 1 <= number <= 120:
                occurrences[number].append(token.upper())

    # Newer answer keys extract table number rows separately from their answer rows.
    for index, line in enumerate(lines):
        if not NUMBER_ROW_RE.fullmatch(line):
            continue
        numbers = [int(value) for value in re.findall(r"\d{1,3}", line)]
        values, _ = _answer_tokens(lines, index + 1, len(numbers))
        if len(values) != len(numbers):
            continue
        for number, value in zip(numbers, values):
            if 1 <= number <= 120:
                occurrences[number].append(value)

    answers = {}
    conflicts = []
    for number, values in sorted(occurrences.items()):
        # UERJ prints language alternatives left-to-right as Espanhol, Francês, Inglês.
        # The canonical corpus variant is English, therefore take the last of the three.
        if number in LANGUAGE_NUMBERS and len(values) >= 3:
            answers[number] = values[-1]
        elif len(set(values)) == 1:
            answers[number] = values[-1]
        elif len(values) == 1:
            answers[number] = values[0]
        else:
            conflicts.append(number)

    expected = max(answers, default=0)
    contiguous = 0
    for number in range(1, expected + 1):
        if number in answers:
            contiguous += 1
        else:
            break
    return {
        "answers": answers,
        "expectedMax": expected,
        "contiguous": contiguous,
        "conflicts": conflicts,
        "score": (contiguous, len(answers), expected),
    }


ORIGINAL_ALLOWED = core.document_allowed


def document_allowed(profile_name: str, profile: dict, title: str, document) -> bool:
    if profile_name != "uerj":
        return ORIGINAL_ALLOWED(profile_name, profile, title, document)
    identity = core.norm(f"{title} {document.member} {document.leaf}")
    if any(marker in identity for marker in ("discursiv", "redacao", "padrao de respostas", "padrao resposta")):
        return False
    # 1º and 2º Exames de Qualificação are separate administrations. Keep one canonical
    # administration per vestibular cycle and never cross-pair their exam/key documents.
    if re.search(r"\b(?:2|segundo)\s*(?:o|º)?\s*exame\b", identity) or "2 exame qualificacao" in identity:
        return False
    return True


def edition(meta: dict, path: Path, documents=None):
    title = str(meta.get("title") or path.stem)
    match = core.YEAR_RE.search(title)
    if match:
        return int(match.group(1)), None
    try:
        return int(meta.get("year")), None
    except (TypeError, ValueError):
        return None, None


ORIGINAL_PROCESS = core.process


def process(profile_name: str, paths: list[Path]):
    editions, summary = ORIGINAL_PROCESS(profile_name, paths)
    if profile_name != "uerj":
        return editions, summary
    editions = [
        item for item in editions
        if item["summary"]["expectedQuestions"] > 0
        and item["units"][0].get("examDocument")
        and item["units"][0].get("answerKeyDocument")
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
    })
    return editions, summary


core.parse_question_pages = parse_question_pages
core.parse_question_document = parse_question_document
core.parse_key_text = parse_key_text
core.document_allowed = document_allowed
core.edition = edition
core.process = process


def main() -> int:
    return core.main()


if __name__ == "__main__":
    raise SystemExit(main())
