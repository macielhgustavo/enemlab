#!/usr/bin/env python3
"""Deterministic extractor for UFPR first-phase objective exams.

Reads one official PDF from stdin and emits the ENEMLab external-extraction
protocol. The extractor deliberately fails closed: if question coverage,
alternatives A-E, or the marked correct alternative cannot be recovered, it
returns a SHA-bound failure envelope with targeted fallback requests instead of
inventing content.

The first benchmark uses the English foreign-language variant when a shared
booklet repeats language-specific question numbers.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from typing import Any

PROTOCOL_VERSION = "enemlab-extraction/v1"
FAILURE_PROTOCOL_VERSION = "enemlab-extraction-failure/v1"
PROVIDER_ID = "ufpr"
SOURCE_ID = "ufpr-nc-official"
EXTRACTOR_NAME = "ufpr-objective-pdf"
EXTRACTOR_VERSION = "ufpr-objective-pdf@0.1.0"
LETTERS = ("A", "B", "C", "D", "E")

QUESTION_RE = re.compile(r"^\s*(?P<annulled>\*)?\s*(?P<number>\d{1,3})\s*[-–—]\s*(?P<rest>.*)$")
QUESTION_TOKEN_RE = re.compile(r"(?:^|\s)\*?\s*\d{1,3}\s*[-–—]")
ALTERNATIVE_RE = re.compile(
    r"^\s*(?P<marked>►|▶|➤)?\s*(?:\((?P<paren>[A-Ea-e])\)|(?P<plain>[A-Ea-e])\s*[\)\.\-–—])\s*(?P<text>.*)$"
)
CONTEXT_RANGE_RE = re.compile(
    r"(?:quest(?:ões|oes)|questions?)\s+(?P<start>\d{1,3})\s*(?:a|até|ate|to|-|–|—)\s*(?P<end>\d{1,3})",
    re.IGNORECASE,
)
GLOBAL_ANNUL_RE = re.compile(
    r"quest(?:ão|ao)\s+(?P<number>\d{1,3}).{0,120}?(?:ser[áa]\s+anulad[ao]|foi\s+anulad[ao]|anulad[ao])",
    re.IGNORECASE | re.DOTALL,
)

MEDIA_TERMS = (
    "figura",
    "imagem",
    "gráfico",
    "grafico",
    "mapa",
    "charge",
    "fotografia",
    "foto",
    "diagrama",
    "esquema",
    "ilustração",
    "ilustracao",
    "tabela",
)

LANGUAGE_HEADINGS = {
    "ALEMAO": "german",
    "ESPANHOL": "spanish",
    "FRANCES": "french",
    "INGLES": "english",
    "ITALIANO": "italian",
    "JAPONES": "japanese",
    "POLONES": "polish",
}

SUBJECT_HEADINGS = {
    "MATEMATICA": "Matemática",
    "FISICA": "Física",
    "QUIMICA": "Química",
    "BIOLOGIA": "Biologia",
    "HISTORIA": "História",
    "GEOGRAFIA": "Geografia",
    "FILOSOFIA": "Filosofia",
    "SOCIOLOGIA": "Sociologia",
    "LINGUA PORTUGUESA": "Língua Portuguesa",
    "PORTUGUES": "Língua Portuguesa",
    "LITERATURA BRASILEIRA": "Literatura",
    "LITERATURA": "Literatura",
}


@dataclass
class QuestionOccurrence:
    number: int
    page: int
    language: str | None
    subject: str | None
    annulled: bool
    statement_lines: list[str] = field(default_factory=list)
    alternatives: dict[str, list[str]] = field(default_factory=dict)
    marked: str | None = None
    context: str | None = None

    def append_body_line(self, line: str) -> None:
        if self.alternatives:
            last = next(reversed(self.alternatives))
            self.alternatives[last].append(line)
        else:
            self.statement_lines.append(line)


class ExtractionFailure(Exception):
    def __init__(self, message: str, targets: list[dict[str, Any]]) -> None:
        super().__init__(message)
        self.targets = targets


def normalize_heading(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    value = re.sub(r"[^A-Za-z ]+", " ", value).upper()
    return re.sub(r"\s+", " ", value).strip()


def clean_line(value: str) -> str:
    value = unicodedata.normalize("NFC", value).replace("\u00ad", "")
    value = "".join(
        char
        for char in value
        if char in "\t " or unicodedata.category(char)[0] != "C"
    )
    return re.sub(r"\s+", " ", value).strip()


def clean_join(lines: list[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(line for line in lines if line).strip())


def language_numbers(year: int) -> set[int]:
    if 2016 <= year <= 2018:
        return set(range(73, 81))
    if 2019 <= year <= 2020:
        return set(range(83, 91))
    if 2021 <= year <= 2022:
        return set(range(1, 5))
    if 2023 <= year <= 2026:
        return set(range(83, 91))
    return set()


def page_semantic_findings(pages: list[str]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for page_number, raw in enumerate(pages, start=1):
        controls = sum(
            1
            for char in raw
            if unicodedata.category(char) in {"Cc", "Cf"}
            and char not in {"\n", "\r", "\t", "\u00ad"}
        )
        if controls:
            findings.append(
                {
                    "code": "control-character",
                    "severity": "error",
                    "page": page_number,
                    "message": f"camada de texto contém {controls} caractere(s) de controle",
                }
            )
        if "\ufffd" in raw:
            findings.append(
                {
                    "code": "replacement-character",
                    "severity": "error",
                    "page": page_number,
                    "message": "camada de texto contém U+FFFD",
                }
            )
        private_use = sum(unicodedata.category(char) == "Co" for char in raw)
        if private_use:
            findings.append(
                {
                    "code": "private-use-character",
                    "severity": "error",
                    "page": page_number,
                    "message": f"camada de texto contém {private_use} glifo(s) de uso privado",
                }
            )
    return findings


def detect_global_annulments(pages: list[str]) -> set[int]:
    joined = "\n".join(pages)
    return {int(match.group("number")) for match in GLOBAL_ANNUL_RE.finditer(joined)}


def subject_heading(line: str) -> str | None:
    normalized = normalize_heading(line)
    if len(normalized) > 40:
        return None
    return SUBJECT_HEADINGS.get(normalized)


def language_heading(line: str) -> str | None:
    normalized = normalize_heading(line)
    if len(normalized) > 24:
        return None
    return LANGUAGE_HEADINGS.get(normalized)


def parse_occurrences(pages: list[str], year: int) -> list[QuestionOccurrence]:
    occurrences: list[QuestionOccurrence] = []
    current: QuestionOccurrence | None = None
    current_language: str | None = None
    current_subject: str | None = None
    pending_context: tuple[int, int, list[str]] | None = None
    language_qs = language_numbers(year)

    for page_number, raw_page in enumerate(pages, start=1):
        for raw_line in raw_page.splitlines():
            line = clean_line(raw_line)
            if not line:
                continue

            lang = language_heading(line)
            if lang:
                current_language = lang
                current = None
                continue

            subject = subject_heading(line)
            if subject:
                current_subject = subject
                current = None
                continue

            context_match = CONTEXT_RANGE_RE.search(line)
            if context_match and (
                "texto" in line.lower()
                or "text" in line.lower()
                or "quest" in line.lower()
            ):
                start = int(context_match.group("start"))
                end = int(context_match.group("end"))
                if 1 <= start <= end <= 200:
                    pending_context = (start, end, [line])
                    current = None
                    continue

            question_match = QUESTION_RE.match(line)
            if question_match and len(QUESTION_TOKEN_RE.findall(line)) == 1:
                number = int(question_match.group("number"))
                if number < 1 or number > 200:
                    continue
                rest = clean_line(question_match.group("rest") or "")
                language = current_language if number in language_qs else None
                occurrence = QuestionOccurrence(
                    number=number,
                    page=page_number,
                    language=language,
                    subject=current_subject,
                    annulled=bool(question_match.group("annulled")),
                )
                if rest:
                    occurrence.statement_lines.append(rest)
                if pending_context and pending_context[0] <= number <= pending_context[1]:
                    occurrence.context = clean_join(pending_context[2])
                if pending_context and number > pending_context[1]:
                    pending_context = None
                occurrences.append(occurrence)
                current = occurrence
                continue

            alt_match = ALTERNATIVE_RE.match(line)
            if current and alt_match:
                letter = (alt_match.group("paren") or alt_match.group("plain") or "").upper()
                text = clean_line(alt_match.group("text") or "")
                if letter in current.alternatives:
                    current.append_body_line(line)
                    continue
                current.alternatives[letter] = [text] if text else []
                if alt_match.group("marked"):
                    if current.marked and current.marked != letter:
                        current.marked = "AMBIGUOUS"
                    else:
                        current.marked = letter
                continue

            if pending_context and current is None:
                pending_context[2].append(line)
                continue

            if current:
                current.append_body_line(line)

    return occurrences


def occurrence_score(value: QuestionOccurrence) -> tuple[int, int, int]:
    return (
        len(value.alternatives),
        1 if value.marked in LETTERS else 0,
        len(clean_join(value.statement_lines)),
    )


def select_questions(
    occurrences: list[QuestionOccurrence],
    expected_count: int,
    variant: str,
) -> list[QuestionOccurrence]:
    grouped: dict[int, list[QuestionOccurrence]] = {}
    for occurrence in occurrences:
        if 1 <= occurrence.number <= expected_count:
            grouped.setdefault(occurrence.number, []).append(occurrence)

    selected: list[QuestionOccurrence] = []
    targets: list[dict[str, Any]] = []

    for number in range(1, expected_count + 1):
        candidates = grouped.get(number, [])
        if not candidates:
            targets.append(
                {
                    "questionNumber": number,
                    "reason": "incomplete-structure",
                    "message": "marcador da questão não foi localizado",
                }
            )
            continue

        if len(candidates) == 1:
            selected.append(candidates[0])
            continue

        language_candidates = [item for item in candidates if item.language == variant]
        if len(language_candidates) == 1:
            selected.append(language_candidates[0])
            continue
        if len(language_candidates) > 1:
            language_candidates.sort(key=occurrence_score, reverse=True)
            best = language_candidates[0]
            if len(language_candidates) > 1 and occurrence_score(language_candidates[1]) == occurrence_score(best):
                targets.append(
                    {
                        "questionNumber": number,
                        "page": best.page,
                        "reason": "incomplete-structure",
                        "message": f"mais de um bloco {variant} plausível para a questão",
                    }
                )
                continue
            selected.append(best)
            continue

        targets.append(
            {
                "questionNumber": number,
                "page": candidates[0].page,
                "reason": "incomplete-structure",
                "message": f"questão duplicada sem ocorrência inequívoca da variante {variant}",
            }
        )

    if targets:
        raise ExtractionFailure("cobertura de questões incompleta ou ambígua", targets)
    return selected


def build_extraction(
    pages: list[str],
    *,
    year: int,
    expected_count: int,
    variant: str,
    source_url: str,
) -> dict[str, Any]:
    occurrences = parse_occurrences(pages, year)
    selected = select_questions(occurrences, expected_count, variant)
    global_annulled = detect_global_annulments(pages)

    questions: list[dict[str, Any]] = []
    answer_key: dict[int, str] = {}
    annulled: set[int] = set(global_annulled)
    missing_media: set[int] = set()
    structure_targets: list[dict[str, Any]] = []
    subject_counts: dict[str, int] = {}

    for occurrence in selected:
        is_annulled = occurrence.annulled or occurrence.number in global_annulled
        if is_annulled:
            annulled.add(occurrence.number)

        alternatives: list[dict[str, str]] = []
        complete_alternatives = set(occurrence.alternatives) == set(LETTERS)
        if complete_alternatives:
            alternatives = [
                {
                    "id": letter,
                    "text": clean_join(occurrence.alternatives[letter]),
                }
                for letter in LETTERS
            ]

        if not complete_alternatives:
            structure_targets.append(
                {
                    "questionNumber": occurrence.number,
                    "page": occurrence.page,
                    "reason": "incomplete-structure",
                    "message": "não foi possível separar exatamente as alternativas A-E",
                }
            )
        elif not is_annulled and occurrence.marked not in LETTERS:
            structure_targets.append(
                {
                    "questionNumber": occurrence.number,
                    "page": occurrence.page,
                    "reason": "incomplete-structure",
                    "message": "alternativa correta marcada não foi recuperada de forma inequívoca",
                }
            )

        statement = clean_join(occurrence.statement_lines)
        combined = " ".join(
            [statement, occurrence.context or ""]
            + [item["text"] for item in alternatives]
        ).lower()
        if any(term in combined for term in MEDIA_TERMS):
            missing_media.add(occurrence.number)

        question: dict[str, Any] = {
            "number": occurrence.number,
            "page": occurrence.page,
            "sourceDocumentUrl": source_url,
            "confidence": 1.0 if complete_alternatives and (is_annulled or occurrence.marked in LETTERS) else 0.0,
        }
        if occurrence.subject:
            question["subject"] = occurrence.subject
            subject_counts[occurrence.subject] = subject_counts.get(occurrence.subject, 0) + 1
        if statement:
            question["statement"] = statement
        if occurrence.context:
            question["context"] = occurrence.context
        if alternatives:
            question["alternatives"] = alternatives
        questions.append(question)

        if not is_annulled and occurrence.marked in LETTERS:
            answer_key[occurrence.number] = occurrence.marked

    if structure_targets:
        raise ExtractionFailure("estrutura A-E/gabarito marcada incompleta", structure_targets)

    warnings = [
        f"Variante canônica de língua estrangeira: {variant}.",
        "Mídia visual ainda não é extraída; referências visuais são encaminhadas para revisão.",
    ]
    return {
        "questions": questions,
        "answerKey": answer_key,
        "annulled": sorted(number for number in annulled if 1 <= number <= expected_count),
        "subjects": subject_counts,
        "questionsMissingMedia": sorted(missing_media),
        "semanticFidelityIssues": page_semantic_findings(pages),
        "warnings": warnings,
    }


def envelope(args: argparse.Namespace, extraction: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "identity": {
            "providerId": PROVIDER_ID,
            "sourceId": SOURCE_ID,
            "editionId": args.edition_id,
            "year": args.year,
            "phase": args.phase,
            "variant": args.variant,
        },
        "extractor": {"name": EXTRACTOR_NAME, "version": EXTRACTOR_VERSION},
        "documents": [{"url": args.source_url, "sha256": args.sha256.lower()}],
        "extraction": extraction,
    }


def failure_envelope(
    args: argparse.Namespace,
    message: str,
    targets: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "protocolVersion": FAILURE_PROTOCOL_VERSION,
        "identity": {
            "providerId": PROVIDER_ID,
            "sourceId": SOURCE_ID,
            "editionId": args.edition_id,
            "year": args.year,
            "phase": args.phase,
            "variant": args.variant,
        },
        "extractor": {"name": EXTRACTOR_NAME, "version": EXTRACTOR_VERSION},
        "documents": [{"url": args.source_url, "sha256": args.sha256.lower()}],
        "error": {"message": message},
        "fallbackRequest": {"targets": targets},
    }


def extract_pdf_pages(pdf_bytes: bytes) -> list[str]:
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return [page.extract_text() or "" for page in reader.pages]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--edition-id", required=True)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--phase", required=True)
    parser.add_argument("--variant", required=True)
    parser.add_argument("--expected-count", required=True, type=int)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--sha256", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.expected_count < 1:
        raise SystemExit("--expected-count must be positive")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", args.sha256):
        raise SystemExit("--sha256 must be a SHA-256 hex digest")

    pdf_bytes = sys.stdin.buffer.read()
    actual_sha = hashlib.sha256(pdf_bytes).hexdigest()
    if actual_sha != args.sha256.lower():
        raise SystemExit(
            f"stdin SHA mismatch: expected {args.sha256.lower()}, got {actual_sha}"
        )

    try:
        pages = extract_pdf_pages(pdf_bytes)
        extraction = build_extraction(
            pages,
            year=args.year,
            expected_count=args.expected_count,
            variant=args.variant,
            source_url=args.source_url,
        )
        payload = envelope(args, extraction)
    except ExtractionFailure as error:
        payload = failure_envelope(args, str(error), error.targets)
    except Exception as error:
        print(f"UFPR extractor failed: {error}", file=sys.stderr)
        return 1

    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
