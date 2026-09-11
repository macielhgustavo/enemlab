#!/usr/bin/env python3
"""Extrator determinístico de questões da 1ª fase da FUVEST.

Este script é um laboratório de extração, não um publicador. Ele lê o caderno
oficial, recupera limites de questão e alternativas A-E da camada de texto e
emite o protocolo ``enemlab-extraction/v1``. A saída continua sujeita ao
Ingestion Engine, à revisão humana e às regras de direitos do ENEMLab.

Importante: cobertura estrutural não equivale a fidelidade semântica. Um PDF
pode preservar números de questão e alternativas enquanto perde símbolos,
fórmulas ou relações visuais. O extrator registra sinais de corrupção antes da
limpeza de texto para que caracteres inválidos não desapareçam silenciosamente.

Quando a extração determinística falha por estrutura, ``--failure-output`` pode
registrar um ``enemlab-extraction-failure/v1``. Esse envelope continua com exit
code não zero, é ligado aos mesmos documentos por SHA-256 e lista somente as
páginas candidatas a OCR/IA. Assim, falha nunca é confundida com sucesso.

Exemplos:

    python scripts/extract-fuvest-questions.py --year 2025
    python scripts/extract-fuvest-questions.py --year 2010 --output /tmp/fuvest-2010.json
    python scripts/extract-fuvest-questions.py --year 2018 --failure-output /tmp/fuvest-2018.failure.json

A extração é fail-closed para identidade e cobertura: se o caderno não tiver
exatamente a sequência esperada de questões, o comando falha. Uma questão cujo
texto foi localizado mas cujas cinco alternativas não puderam ser separadas é
mantida para revisão, sem fingir estrutura completa.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "src/lib/providers/fuvest/answer-keys.generated.json"
PROTOCOL_VERSION = "enemlab-extraction/v1"
FAILURE_PROTOCOL_VERSION = "enemlab-extraction-failure/v1"
EXTRACTOR_NAME = "fuvest-question-text"
EXTRACTOR_VERSION = "fuvest-question-text@0.4.0"
PROVIDER_ID = "fuvest"
SOURCE_ID = "fuvest-archive"
PHASE = "first"
LETTERS = ("A", "B", "C", "D", "E")

QUESTION_RE = re.compile(
    r"^\s*(?:(?:QUEST(?:ÃO|AO))\s*)?"
    r"(?:\{(?P<brace>\d{1,3})\}|\[(?P<bracket>\d{1,3})\]|(?P<plain>\d{1,3}))"
    r"(?:\s+(?P<rest>.*))?$",
    re.IGNORECASE,
)
ALTERNATIVE_RE = re.compile(
    r"^\s*(?:\(([A-Ea-e])\)|([A-Ea-e])[\)\.])\s*(.*)$"
)
QUESTION_SEPARATOR_RE = re.compile(r"^#{3,}$")
NOTE_AND_ADOPT_RE = re.compile(r"^\s*note\s+e\s+adote\s*:?\s*$", re.IGNORECASE)

MEDIA_TERMS = (
    "figura",
    "imagem",
    "gráfico",
    "grafico",
    "mapa",
    "charge",
    "gravura",
    "fotografia",
    "foto",
    "diagrama",
    "esquema",
    "ilustração",
    "ilustracao",
)


@dataclass(frozen=True)
class PageLine:
    page: int
    text: str


@dataclass(frozen=True)
class ParsedQuestion:
    number: int
    page: int
    statement: str
    alternatives: list[dict[str, str]] | None
    context: str | None
    needs_media_review: bool
    warnings: list[str]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "enemlab-ingest/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def extract_pdf_pages(pdf_bytes: bytes) -> list[str]:
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return [page.extract_text() or "" for page in reader.pages]


def raw_page_semantic_findings(pages: list[str]) -> dict[int, list[dict[str, str]]]:
    """Detecta corrupção inequívoca antes que `clean_line` remova evidência."""
    findings: dict[int, list[dict[str, str]]] = {}
    for page_number, page_text in enumerate(pages, start=1):
        page_findings: list[dict[str, str]] = []
        disallowed_controls = [
            char
            for char in page_text
            if unicodedata.category(char) in {"Cc", "Cf"}
            and char not in {"\n", "\r", "\t", "\u00ad"}
        ]
        if disallowed_controls:
            page_findings.append(
                {
                    "code": "control-character",
                    "message": (
                        f"camada de texto da página contém {len(disallowed_controls)} "
                        "caractere(s) de controle removidos antes da estruturação"
                    ),
                }
            )
        if "\ufffd" in page_text:
            page_findings.append(
                {
                    "code": "replacement-character",
                    "message": "camada de texto da página contém U+FFFD (glifo perdido)",
                }
            )
        private_use = sum(unicodedata.category(char) == "Co" for char in page_text)
        if private_use:
            page_findings.append(
                {
                    "code": "private-use-character",
                    "message": (
                        f"camada de texto da página contém {private_use} glifo(s) de uso privado"
                    ),
                }
            )
        if page_findings:
            findings[page_number] = page_findings
    return findings


def clean_line(value: str) -> str:
    # NFC preserva semântica tipográfica relevante (², ³ etc.). NFKC não pode
    # ser usado aqui: ele converte, por exemplo, m/s² em m/s2.
    value = unicodedata.normalize("NFC", value).replace("\u00ad", "")
    value = "".join(
        char
        for char in value
        if char in "\t " or unicodedata.category(char)[0] != "C"
    )
    return re.sub(r"[ \t]+", " ", value).strip()


def clean_page_lines(page_text: str, canonical_variant: str | None = None) -> list[str]:
    lines = [clean_line(line) for line in page_text.splitlines()]
    lines = [line for line in lines if line and not re.fullmatch(r"_+", line)]

    if not lines or not canonical_variant:
        return lines

    variant = canonical_variant.upper()
    last = lines[-1]
    if last.upper() == variant:
        lines.pop()
    elif re.search(rf"\s+{re.escape(variant)}$", last, re.IGNORECASE):
        lines[-1] = re.sub(
            rf"\s+{re.escape(variant)}$", "", last, flags=re.IGNORECASE
        ).rstrip()
    return lines


def page_lines(pages: list[str], canonical_variant: str | None = None) -> list[PageLine]:
    result: list[PageLine] = []
    for page_number, page_text in enumerate(pages, start=1):
        result.extend(
            PageLine(page=page_number, text=line)
            for line in clean_page_lines(page_text, canonical_variant)
        )
    return result


def question_start(line: str, expected: int) -> str | None:
    match = QUESTION_RE.match(line)
    if not match:
        return None

    raw_number = match.group("brace") or match.group("bracket") or match.group("plain")
    if raw_number is None:
        return None

    has_question_prefix = line.upper().lstrip().startswith(("QUESTÃO", "QUESTAO"))
    has_explicit_delimiter = match.group("brace") is not None or match.group("bracket") is not None
    if len(raw_number) < 2 and not has_question_prefix and not has_explicit_delimiter:
        return None
    if int(raw_number) != expected:
        return None
    return (match.group("rest") or "").strip()


def join_wrapped(lines: list[str]) -> str:
    cleaned = [line.strip() for line in lines if line.strip()]
    if not cleaned:
        return ""
    return re.sub(r"\s+", " ", " ".join(cleaned)).strip()


def split_final_choice_tail(lines: list[str]) -> tuple[list[str], list[str]]:
    for index, line in enumerate(lines):
        if QUESTION_SEPARATOR_RE.fullmatch(line):
            return lines[:index], []
        if NOTE_AND_ADOPT_RE.fullmatch(line):
            return lines[:index], lines[index:]
    return lines, []


def parse_alternatives(
    lines: list[str],
) -> tuple[str, list[dict[str, str]] | None, str | None]:
    starts: list[tuple[int, str, str]] = []
    expected_index = 0

    for index, line in enumerate(lines):
        match = ALTERNATIVE_RE.match(line)
        if not match:
            continue
        letter = (match.group(1) or match.group(2)).upper()
        if expected_index >= len(LETTERS) or letter != LETTERS[expected_index]:
            continue
        starts.append((index, letter, match.group(3).strip()))
        expected_index += 1
        if expected_index == len(LETTERS):
            break

    if len(starts) != len(LETTERS):
        return join_wrapped(lines), None, None

    statement = join_wrapped(lines[: starts[0][0]])
    alternatives: list[dict[str, str]] = []
    context_lines: list[str] = []
    for position, (start_index, letter, first_text) in enumerate(starts):
        end_index = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        tail = lines[start_index + 1 : end_index]
        if position == len(starts) - 1:
            tail, context_lines = split_final_choice_tail(tail)
        text = join_wrapped(([first_text] if first_text else []) + tail)
        if not text:
            return statement, None, join_wrapped(context_lines) or None
        alternatives.append({"id": letter, "text": text})

    return statement, alternatives, join_wrapped(context_lines) or None


def count_complete_choice_groups(lines: list[PageLine]) -> int:
    expected_index = 0
    groups = 0
    for item in lines:
        match = ALTERNATIVE_RE.match(item.text)
        if not match:
            continue
        letter = (match.group(1) or match.group(2)).upper()
        expected_letter = LETTERS[expected_index]
        if letter == expected_letter:
            expected_index += 1
            if expected_index == len(LETTERS):
                groups += 1
                expected_index = 0
            continue
        expected_index = 1 if letter == "A" else 0
    return groups


def alternative_marker_count(lines: list[str]) -> int:
    return sum(1 for line in lines if ALTERNATIVE_RE.match(line))


def recovery_page_targets(
    pages: list[str],
    canonical_variant: str | None,
    error_message: str,
) -> list[dict[str, Any]]:
    """Seleciona páginas com evidência objetiva de conteúdo de questão.

    Uma falha de boundaries não autoriza OCR da prova inteira. O fallback recebe
    somente páginas que contêm ao menos dois marcadores de alternativa; isso
    evita capa/instruções e ainda cobre páginas com questões partidas entre
    colunas ou páginas. Achados semânticos nessas páginas recebem um segundo
    motivo, permitindo ao worker priorizar símbolos/fórmulas além dos boundaries.
    """
    raw_findings = raw_page_semantic_findings(pages)
    targets: list[dict[str, Any]] = []

    for page_number, page_text in enumerate(pages, start=1):
        cleaned = clean_page_lines(page_text, canonical_variant)
        markers = alternative_marker_count(cleaned)
        if markers < 2:
            continue

        targets.append(
            {
                "page": page_number,
                "reason": "incomplete-structure",
                "message": (
                    f"página contém {markers} marcador(es) de alternativa, mas a extração "
                    f"determinística não recuperou a cobertura completa: {error_message}"
                ),
            }
        )

        findings = raw_findings.get(page_number, [])
        if findings:
            targets.append(
                {
                    "page": page_number,
                    "reason": "semantic-fidelity",
                    "message": "; ".join(finding["message"] for finding in findings),
                }
            )

    return targets


def media_reference(text: str) -> bool:
    lowered = unicodedata.normalize("NFKD", text.lower())
    lowered = "".join(char for char in lowered if unicodedata.category(char) != "Mn")
    return any(re.search(rf"\b{re.escape(term)}\b", lowered) for term in MEDIA_TERMS)


def parse_question_block(number: int, start_page: int, lines: list[str]) -> ParsedQuestion:
    statement, alternatives, context = parse_alternatives(lines)
    warnings: list[str] = []

    if not statement:
        warnings.append("enunciado vazio após extração da camada de texto")
    if alternatives is None:
        warnings.append("não foi possível separar exatamente as alternativas A-E")

    combined = join_wrapped(lines)
    needs_media = media_reference(combined)
    if needs_media:
        warnings.append("texto referencia mídia; associação visual precisa de revisão")

    return ParsedQuestion(
        number=number,
        page=start_page,
        statement=statement,
        alternatives=alternatives,
        context=context,
        needs_media_review=needs_media,
        warnings=warnings,
    )


def parse_questions(
    pages: list[str],
    expected_count: int,
    canonical_variant: str | None = None,
) -> list[ParsedQuestion]:
    if expected_count < 1:
        raise ValueError("expected_count must be positive")

    lines = page_lines(pages, canonical_variant)
    questions: list[ParsedQuestion] = []
    current_number: int | None = None
    current_page = 0
    current_lines: list[str] = []
    expected = 1

    for item in lines:
        rest = question_start(item.text, expected)
        if rest is not None:
            if current_number is not None:
                questions.append(
                    parse_question_block(current_number, current_page, current_lines)
                )
            current_number = expected
            current_page = item.page
            current_lines = [rest] if rest else []
            expected += 1
            continue

        if current_number is not None:
            current_lines.append(item.text)

    if current_number is not None:
        questions.append(parse_question_block(current_number, current_page, current_lines))

    if len(questions) != expected_count:
        found = [question.number for question in questions]
        choice_groups = count_complete_choice_groups(lines)
        diagnostic = ""
        if choice_groups >= max(1, int(expected_count * 0.8)):
            diagnostic = (
                f"; detectadas {choice_groups} sequências completas A-E, mas os marcadores "
                "numéricos não foram recuperados com confiança; requer OCR seletivo de boundaries"
            )
        raise ValueError(
            f"cobertura de questões incompleta: esperadas {expected_count}, "
            f"encontradas {len(questions)}; próxima esperada {len(questions) + 1}; "
            f"últimas encontradas {found[-5:]}{diagnostic}"
        )

    if [question.number for question in questions] != list(range(1, expected_count + 1)):
        raise ValueError("numeração extraída não é contígua")
    return questions


def semantic_issues_for_questions(
    pages: list[str], questions: list[ParsedQuestion]
) -> list[dict[str, Any]]:
    page_findings = raw_page_semantic_findings(pages)
    if not page_findings or not questions:
        return []

    issues: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for index, question in enumerate(questions):
        next_page = (
            questions[index + 1].page if index + 1 < len(questions) else len(pages)
        )
        end_page = max(question.page, next_page)
        for page_number in range(question.page, end_page + 1):
            for finding in page_findings.get(page_number, []):
                key = (finding["code"], question.number, page_number)
                if key in seen:
                    continue
                seen.add(key)
                issues.append(
                    {
                        "code": finding["code"],
                        "severity": "error",
                        "questionNumber": question.number,
                        "page": page_number,
                        "message": finding["message"],
                    }
                )
    return issues


def load_manifest(path: Path = MANIFEST) -> dict[str, dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_manifest_entry(entry: dict[str, Any], year: int) -> None:
    if entry.get("year") != year or entry.get("edition") != str(year):
        raise ValueError(f"FUVEST {year}: identidade do manifesto inconsistente")
    if entry.get("contentMode") != "reference-only":
        raise ValueError(f"FUVEST {year}: modo inesperado no manifesto")
    if entry.get("rightsStatus") != "official-reference":
        raise ValueError(f"FUVEST {year}: rightsStatus inesperado")
    if entry.get("validationLevel") != "reviewed":
        raise ValueError(f"FUVEST {year}: edição ainda não revisada")
    if not entry.get("examUrl"):
        raise ValueError(f"FUVEST {year}: caderno canônico não disponível para extração")
    if not entry.get("answerKeyUrl"):
        raise ValueError(f"FUVEST {year}: gabarito oficial ausente")
    if entry.get("expectedQuestions") != entry.get("total"):
        raise ValueError(f"FUVEST {year}: total esperado inconsistente")


def verify_answer_key_hash(entry: dict[str, Any], answer_key_bytes: bytes) -> str:
    expected_key_sha = str(entry["retrieval"]["sha256"]).lower()
    actual_key_sha = sha256_bytes(answer_key_bytes)
    if expected_key_sha != actual_key_sha:
        raise ValueError(
            "gabarito mudou desde a revisão registrada; rode a ingestão de gabarito antes"
        )
    return actual_key_sha


def envelope_identity(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "providerId": PROVIDER_ID,
        "sourceId": SOURCE_ID,
        "editionId": entry["edition"],
        "year": entry["year"],
        "phase": PHASE,
    }


def envelope_documents(
    entry: dict[str, Any], exam_bytes: bytes, answer_key_bytes: bytes
) -> list[dict[str, str]]:
    actual_key_sha = verify_answer_key_hash(entry, answer_key_bytes)
    return [
        {"url": entry["examUrl"], "sha256": sha256_bytes(exam_bytes)},
        {"url": entry["answerKeyUrl"], "sha256": actual_key_sha},
    ]


def extraction_payload(
    entry: dict[str, Any],
    pages: list[str],
) -> dict[str, Any]:
    questions = parse_questions(
        pages,
        int(entry["total"]),
        str(entry.get("canonicalVariant") or ""),
    )

    warnings: list[str] = []
    missing_media: list[int] = []
    serialized_questions: list[dict[str, Any]] = []

    for question in questions:
        item: dict[str, Any] = {
            "number": question.number,
            "subject": "Conhecimentos gerais",
            "page": question.page,
            "sourceDocumentUrl": entry["examUrl"],
        }
        if question.statement:
            item["statement"] = question.statement
        if question.context:
            item["context"] = question.context
        if question.alternatives is not None:
            item["alternatives"] = question.alternatives
        serialized_questions.append(item)

        if question.needs_media_review:
            missing_media.append(question.number)
        warnings.extend(
            f"questão {question.number}: {warning}" for warning in question.warnings
        )

    return {
        "questions": serialized_questions,
        "answerKey": {str(key): value for key, value in entry["answers"].items()},
        "annulled": list(entry.get("annulled", [])),
        "subjects": {"Conhecimentos gerais": int(entry["total"])},
        "questionsMissingMedia": missing_media,
        "semanticFidelityIssues": semantic_issues_for_questions(pages, questions),
        "warnings": warnings,
    }


def build_envelope(
    entry: dict[str, Any],
    exam_bytes: bytes,
    answer_key_bytes: bytes,
    pages: list[str],
) -> dict[str, Any]:
    documents = envelope_documents(entry, exam_bytes, answer_key_bytes)
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "identity": envelope_identity(entry),
        "extractor": {"name": EXTRACTOR_NAME, "version": EXTRACTOR_VERSION},
        "documents": documents,
        "extraction": extraction_payload(entry, pages),
    }


def build_failure_envelope(
    entry: dict[str, Any],
    exam_bytes: bytes,
    answer_key_bytes: bytes,
    pages: list[str],
    error: Exception,
) -> dict[str, Any]:
    documents = envelope_documents(entry, exam_bytes, answer_key_bytes)
    message = str(error)
    targets = recovery_page_targets(
        pages,
        str(entry.get("canonicalVariant") or ""),
        message,
    )
    if not targets:
        raise ValueError("falha de extração não produziu páginas seguras para fallback seletivo")

    return {
        "protocolVersion": FAILURE_PROTOCOL_VERSION,
        "identity": envelope_identity(entry),
        "extractor": {"name": EXTRACTOR_NAME, "version": EXTRACTOR_VERSION},
        "documents": documents,
        "error": {"message": message},
        "fallbackRequest": {"targets": targets},
    }


def load_year_documents(
    year: int, manifest: dict[str, dict[str, Any]]
) -> tuple[dict[str, Any], bytes, bytes, list[str]]:
    entry = manifest.get(str(year))
    if not entry:
        raise ValueError(f"FUVEST {year}: edição não existe no manifesto revisado")
    validate_manifest_entry(entry, year)

    exam_bytes = fetch(entry["examUrl"])
    answer_key_bytes = fetch(entry["answerKeyUrl"])
    verify_answer_key_hash(entry, answer_key_bytes)
    pages = extract_pdf_pages(exam_bytes)
    return entry, exam_bytes, answer_key_bytes, pages


def run_year(year: int, manifest: dict[str, dict[str, Any]]) -> dict[str, Any]:
    entry, exam_bytes, answer_key_bytes, pages = load_year_documents(year, manifest)
    return build_envelope(entry, exam_bytes, answer_key_bytes, pages)


def metrics(envelope: dict[str, Any]) -> dict[str, int]:
    extraction = envelope["extraction"]
    questions = extraction["questions"]
    complete = sum(
        1
        for question in questions
        if question.get("statement")
        and len(question.get("alternatives", [])) == len(LETTERS)
    )
    missing_media = len(extraction.get("questionsMissingMedia", []))
    semantic_unsafe = {
        issue.get("questionNumber")
        for issue in extraction.get("semanticFidelityIssues", [])
        if issue.get("severity") == "error" and issue.get("questionNumber")
    }
    return {
        "questions": len(questions),
        "structurallyComplete": complete,
        "missingMedia": missing_media,
        "semanticUnsafe": len(semantic_unsafe),
        "needsTextReview": len(questions) - complete,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--failure-output",
        type=Path,
        help=(
            "grava um envelope SHA-bound com páginas para fallback quando a estrutura "
            "determinística falhar; o comando continua retornando exit code 1"
        ),
    )
    parser.add_argument(
        "--metrics",
        action="store_true",
        help="imprime métricas no stderr sem alterar o JSON do protocolo",
    )
    args = parser.parse_args()

    manifest = load_manifest()
    try:
        entry, exam_bytes, answer_key_bytes, pages = load_year_documents(args.year, manifest)
    except Exception as error:  # noqa: BLE001
        print(f"FUVEST {args.year}: EXTRAÇÃO BLOQUEADA — {error}", file=sys.stderr)
        return 1

    try:
        envelope = build_envelope(entry, exam_bytes, answer_key_bytes, pages)
    except Exception as error:  # noqa: BLE001
        if args.failure_output:
            try:
                failure = build_failure_envelope(
                    entry,
                    exam_bytes,
                    answer_key_bytes,
                    pages,
                    error,
                )
                write_json(args.failure_output, failure)
                print(
                    f"FUVEST {args.year}: fallback seletivo registrado em {args.failure_output}",
                    file=sys.stderr,
                )
            except Exception as failure_error:  # noqa: BLE001
                print(
                    f"FUVEST {args.year}: não foi possível registrar fallback — {failure_error}",
                    file=sys.stderr,
                )
        print(f"FUVEST {args.year}: EXTRAÇÃO BLOQUEADA — {error}", file=sys.stderr)
        return 1

    payload = json.dumps(envelope, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)

    if args.metrics:
        print(json.dumps(metrics(envelope), ensure_ascii=False), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
