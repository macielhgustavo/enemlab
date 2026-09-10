#!/usr/bin/env python3
"""
Ingestão de vestibulares em modo referência para as waves v8.8+.

Este script usa rede de propósito: baixa páginas/PDFs oficiais, extrai apenas
gabaritos objetivos A-E e grava manifests pequenos em `src/lib/providers/*`.
Os enunciados permanecem nas fontes oficiais.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import logging
import re
import ssl
import sys
import unicodedata
import urllib.parse
import urllib.request
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Callable

RAIZ = Path(__file__).resolve().parents[1]
FETCHED_AT = "2026-09-09"
HTTP_HEADERS = {"User-Agent": "enemlab-source-ingestion/1.1"}
LETTERS = {"A", "B", "C", "D", "E"}


class IngestionError(ValueError):
    pass


@dataclass(frozen=True)
class PdfDocument:
    url: str
    bytes: bytes
    text: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.bytes).hexdigest()

    @property
    def size(self) -> int:
        return len(self.bytes)


def fetch_bytes(url: str) -> bytes:
    request_url = urllib.parse.quote(url, safe=":/?&=%")
    req = urllib.request.Request(request_url, headers=HTTP_HEADERS)
    context = ssl.create_default_context()
    with urllib.request.urlopen(req, context=context, timeout=60) as response:
        data = response.read()
    if not data.lstrip().startswith(b"%PDF"):
        raise IngestionError(f"{url} não parece PDF")
    return data


def fetch_text(url: str) -> str:
    request_url = urllib.parse.quote(url, safe=":/?&=%")
    req = urllib.request.Request(request_url, headers=HTTP_HEADERS)
    context = ssl.create_default_context()
    with urllib.request.urlopen(req, context=context, timeout=60) as response:
        return response.read().decode("utf-8", "replace")


def fetch_pdf(url: str) -> PdfDocument:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise IngestionError("pypdf ausente. Rode: pip install pypdf") from exc

    data = fetch_bytes(url)
    reader = PdfReader(BytesIO(data.lstrip()))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    if not text.strip():
        raise IngestionError(f"{url} não tem camada de texto legível")
    return PdfDocument(url=url, bytes=data, text=text)


def normalize_answer(token: str) -> str | None:
    token = token.strip().upper()
    if token in {"*", "X", "ANULADA", "ANULADO"} or token.startswith("ANULADA"):
        return None
    if token not in LETTERS:
        raise IngestionError(f"alternativa inválida: {token}")
    return token


def validate_answers(
    answers: dict[str, str],
    annulled: list[int],
    total: int,
) -> None:
    problems: list[str] = []
    annulled_set = set(annulled)
    expected = set(range(1, total + 1))
    answered = {int(key) for key in answers}

    if answered | annulled_set != expected:
        missing = sorted(expected - answered - annulled_set)
        extra = sorted((answered | annulled_set) - expected)
        if missing:
            problems.append(f"faltantes: {missing}")
        if extra:
            problems.append(f"fora do intervalo: {extra}")
    if answered & annulled_set:
        problems.append(f"anuladas com resposta: {sorted(answered & annulled_set)}")
    for key, value in answers.items():
        if value not in LETTERS:
            problems.append(f"q{key}={value}")
    if len(annulled) != len(annulled_set):
        problems.append("anulada duplicada")
    if problems:
        raise IngestionError("; ".join(problems))


def parse_unicamp_answer_key(text: str, total: int = 72) -> tuple[dict[str, str], list[int]]:
    body = text.split("GABARITO DA PROVA", 1)[0]
    pairs = re.findall(r"\b0?([1-9][0-9]?|100)\s+([A-E]|\*)", body.upper())
    return pairs_to_answers(pairs, total)


def parse_uel_answer_key(text: str, total: int = 60) -> tuple[dict[str, str], list[int]]:
    if "GABARITO OFICIAL DEFINITIVO" not in text.upper():
        raise IngestionError("gabarito UEL não é definitivo")
    body = text.split("* Pontos atribuídos", 1)[0]
    pairs = []
    for line in body.splitlines():
        match = re.match(r"^\s*([1-9][0-9]?|60)\s+([A-E*])\s*$", line.upper())
        if match:
            pairs.append(match.groups())
    return pairs_to_answers(pairs, total)


def parse_pucsp_answer_key(text: str, total: int = 50) -> tuple[dict[str, str], list[int]]:
    if "VESTIBULAR PUC-SP" not in text.upper():
        raise IngestionError("documento não é gabarito PUC-SP")
    pairs = []
    for line in text.splitlines():
        match = re.match(r"^\s*([1-9][0-9]?|50)\s+(ANULADA(?:\s*\(\*\))?|[A-E])\s*$", line.upper())
        if match:
            pairs.append(match.groups())
    return pairs_to_answers(pairs, total)


def parse_pucrio_text_answer_key(
    text: str,
    total: int,
) -> tuple[dict[str, str], list[int]]:
    normalized = ascii_upper(text)
    if "VESTIBULAR" not in normalized or "RESPOSTA" not in normalized:
        raise IngestionError("documento não é gabarito comentado PUC-Rio")
    if "PRELIMINAR" in normalized or "PROVISORIO" in normalized:
        raise IngestionError("gabarito PUC-Rio não é final")

    pairs = re.findall(
        r"(?m)^\s*([1-9]|[1-4][0-9])\)\s*"
        r"(?:GABARITO\s+ALTERADO\s*)?RESPOSTA\s*:?\s*\(\s*([A-E])\s*\)",
        normalized,
    )
    annulled = [
        int(number)
        for number in re.findall(
            r"(?m)^\s*([1-9]|[1-4][0-9])\)\s*"
            r"(?:RESPOSTA\s*:?\s*)?\(?QUESTAO\s+ANULADA\)?",
            normalized,
        )
    ]
    return pairs_to_answers(pairs + [(str(number), "ANULADA") for number in annulled], total)


def ascii_upper(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()


def puc_rio_color_is_yellow(color: object) -> bool:
    if not isinstance(color, tuple):
        return False
    if len(color) == 4:
        cyan, magenta, yellow, black = color
        return yellow >= 0.7 and cyan <= 0.3 and magenta <= 0.3 and black <= 0.3
    if len(color) == 3:
        red, green, blue = color
        return red >= 0.7 and green >= 0.7 and blue <= 0.3
    return False


def extract_pdf_geometry(data: bytes) -> list[dict[str, object]]:
    try:
        import pdfplumber
    except ImportError as exc:
        raise IngestionError("pdfplumber ausente. Rode: pip install pdfplumber") from exc

    logging.getLogger("pdfminer").setLevel(logging.ERROR)
    pages: list[dict[str, object]] = []
    with pdfplumber.open(BytesIO(data)) as document:
        for page in document.pages:
            pages.append(
                {
                    "width": float(page.width),
                    "height": float(page.height),
                    "words": page.extract_words(extra_attrs=["fontname", "size"]),
                    "lines": page.lines,
                    "rects": page.rects,
                }
            )
    return pages


def analyze_pucrio_pages(
    pages: list[dict[str, object]],
) -> tuple[dict[str, str], list[int], set[int]]:
    answers: dict[str, str] = {}
    annulled: set[int] = set()
    question_options: dict[int, set[str]] = {}

    for page_index, page in enumerate(pages, 1):
        width = float(page["width"])
        height = float(page["height"])
        words = list(page["words"])
        lines = list(page["lines"])
        rects = list(page["rects"])
        highlights: list[dict[str, float]] = []

        for line in lines:
            linewidth = float(line.get("linewidth") or 0)
            if linewidth >= 6 and puc_rio_color_is_yellow(line.get("stroking_color")):
                highlights.append(
                    {
                        "x0": float(line["x0"]),
                        "x1": float(line["x1"]),
                        "top": float(line["top"]) - linewidth / 2,
                        "bottom": float(line["bottom"]) + linewidth / 2,
                    }
                )
        for rect in rects:
            if rect.get("fill") and puc_rio_color_is_yellow(rect.get("non_stroking_color")):
                highlights.append(
                    {
                        "x0": float(rect["x0"]),
                        "x1": float(rect["x1"]),
                        "top": float(rect["top"]),
                        "bottom": float(rect["bottom"]),
                    }
                )

        column_count = 2 if any(
            abs(float(line["x1"]) - float(line["x0"])) <= 3
            and abs(float(line["bottom"]) - float(line["top"])) >= height * 0.45
            and width * 0.4 <= float(line["x0"]) <= width * 0.6
            for line in lines
        ) else 1
        page_options: list[dict[str, object]] = []

        for column in range(column_count):
            column_words = [
                word
                for word in words
                if column_count == 1
                or (column == 0 and float(word["x0"]) < width / 2)
                or (column == 1 and float(word["x0"]) >= width / 2)
            ]
            events: list[tuple[float, int, dict[str, object]]] = []
            for word in column_words:
                token = str(word["text"]).strip()
                font = str(word.get("fontname") or "")
                size = float(word.get("size") or 0)
                x0 = float(word["x0"])
                column_start = 28 if column == 0 else width / 2 + 10
                if (
                    token.isdigit()
                    and 1 <= int(token) <= 100
                    and "BOLD" in font.upper()
                    and size >= 10.5
                    and abs(x0 - column_start) <= 35
                ):
                    events.append((float(word["top"]), 0, {"kind": "question", "number": int(token)}))
                match = re.fullmatch(r"(?:\(([A-E])\)|([A-E])\))", token.upper())
                if match:
                    events.append(
                        (
                            float(word["top"]),
                            1,
                            {
                                "kind": "option",
                                "letter": match.group(1) or match.group(2),
                                "word": word,
                            },
                        )
                    )
                if ascii_upper(token).startswith("ANULAD"):
                    events.append((float(word["top"]), 2, {"kind": "annulled"}))

            current_question: int | None = None
            for _, _, event in sorted(events, key=lambda item: (item[0], item[1])):
                if event["kind"] == "question":
                    current_question = int(event["number"])
                elif current_question is not None and event["kind"] == "annulled":
                    annulled.add(current_question)
                elif current_question is not None:
                    letter = str(event["letter"])
                    word = event["word"]
                    question_options.setdefault(current_question, set()).add(letter)
                    page_options.append(
                        {"question": current_question, "letter": letter, "word": word}
                    )

        for region in highlights:
            candidates = []
            for option in page_options:
                word = option["word"]
                if (
                    region["top"] <= float(word["bottom"])
                    and region["bottom"] >= float(word["top"])
                    and region["x0"] <= float(word["x1"])
                    and region["x1"] >= float(word["x0"])
                ):
                    candidates.append(option)
            if not candidates:
                continue
            selected = min(
                candidates,
                key=lambda option: abs(float(option["word"]["top"]) - region["top"]),
            )
            number = str(selected["question"])
            letter = str(selected["letter"])
            if number in answers and answers[number] != letter:
                raise IngestionError(
                    f"página {page_index}: questão {number} tem dois destaques "
                    f"({answers[number]} e {letter})"
                )
            answers[number] = letter

    objective = {number for number, options in question_options.items() if len(options) >= 4}
    return answers, sorted(annulled), objective


def parse_pucrio_highlighted_answer_key(
    pages: list[dict[str, object]],
    total: int,
) -> tuple[dict[str, str], list[int]]:
    answers, annulled, objective = analyze_pucrio_pages(pages)
    validate_answers(answers, annulled, total)
    expected = set(range(1, total + 1))
    if objective != expected:
        raise IngestionError(
            f"numeração objetiva divergente: faltantes={sorted(expected - objective)}, "
            f"extras={sorted(objective - expected)}"
        )
    return answers, annulled


def parse_udesc_answer_key(
    text: str,
) -> tuple[
    tuple[dict[str, str], list[int]],
    tuple[dict[str, str], list[int]],
    tuple[dict[str, str], list[int]],
]:
    normalized = ascii_upper(text)
    if (
        "GABARITO OFICIAL" not in normalized
        or ("MATUTIN" not in normalized and "PROVA MANHA" not in normalized)
        or ("VESPERTIN" not in normalized and "PROVA TARDE" not in normalized)
    ):
        raise IngestionError("documento não é gabarito oficial UDESC")
    header = normalized.split("MATUTIN", 1)[0]
    if re.search(r"GABARITO(?:\s+OFICIAL)?\s+(?:PRELIMINAR|PROVISORIO)", header):
        raise IngestionError("gabarito UDESC não é final")

    pattern = re.compile(
        r"(?<!\d)0?([1-9]|[1-4][0-9]|50)\s*"
        r"(?:(?:A|O)?\s*QUESTAO\s*)?"
        r"(?:[.:-]\s*|\(\s*|\s+)"
        r"(ANULADA|ANULADO|[A-E])\b\s*\)?"
    )
    pairs = [(match.group(1), match.group(2)) for match in pattern.finditer(normalized)]
    first_positions = [index for index, (number, _) in enumerate(pairs) if number == "1"]
    if len(first_positions) != 2:
        raise IngestionError(
            f"gabarito UDESC deveria ter duas sessões; q1 apareceu {len(first_positions)} vezes em {first_positions}"
        )

    morning_pairs = pairs[first_positions[0] : first_positions[1]]
    afternoon_pairs = pairs[first_positions[1] :]
    morning_by_number: dict[int, list[str]] = {}
    for raw_number, answer in morning_pairs:
        morning_by_number.setdefault(int(raw_number), []).append(answer)

    language_numbers = set(range(29, 37))
    for number in range(1, 51):
        expected_occurrences = 2 if number in language_numbers else 1
        actual = len(morning_by_number.get(number, []))
        if actual != expected_occurrences:
            raise IngestionError(
                f"UDESC matutino q{number}: esperadas {expected_occurrences} ocorrências, recebidas {actual}"
            )

    english_pairs = [
        (str(number), answers[0]) for number, answers in sorted(morning_by_number.items())
    ]
    spanish_pairs = [
        (str(number), answers[1] if number in language_numbers else answers[0])
        for number, answers in sorted(morning_by_number.items())
    ]
    return (
        pairs_to_answers(english_pairs, 50),
        pairs_to_answers(spanish_pairs, 50),
        pairs_to_answers(afternoon_pairs, 50),
    )


def parse_acafe_answer_key(
    text: str,
) -> tuple[
    tuple[dict[str, str], list[int]],
    tuple[dict[str, str], list[int]],
]:
    normalized = ascii_upper(text)
    if "ACAFE" not in normalized or "GABARITO OFICIAL" not in normalized:
        raise IngestionError("documento não é gabarito oficial ACAFE")
    header = normalized.split("LINGUA PORTUGUESA", 1)[0]
    if "PRELIMINAR" in header or "PROVISORIO" in header:
        raise IngestionError("gabarito ACAFE não é final")

    pattern = re.compile(
        r"(?<!\d)0?([1-9]|[1-5][0-9]|6[0-3])\s*"
        r"(?:[.:-]\s*|\s+)"
        r"(ANULADA|ANULADO|[A-EX])\b"
    )
    grouped: dict[int, list[str]] = {}
    for match in pattern.finditer(normalized):
        grouped.setdefault(int(match.group(1)), []).append(match.group(2))

    language_numbers = set(range(15, 22))
    for number in range(1, 64):
        expected_occurrences = 2 if number in language_numbers else 1
        actual = len(grouped.get(number, []))
        if actual != expected_occurrences:
            raise IngestionError(
                f"ACAFE q{number}: esperadas {expected_occurrences} ocorrências, recebidas {actual}"
            )

    language_markers = {
        "espanhol": normalized.find("ESPANHOL"),
        "ingles": normalized.find("INGLES"),
    }
    if any(position < 0 for position in language_markers.values()):
        raise IngestionError("ACAFE não identifica Inglês e Espanhol")
    language_order = [
        language
        for language, _ in sorted(language_markers.items(), key=lambda item: item[1])
    ]
    language_index = {language: index for index, language in enumerate(language_order)}

    def pairs_for(language: str) -> list[tuple[str, str]]:
        return [
            (
                str(number),
                answers[language_index[language]] if number in language_numbers else answers[0],
            )
            for number, answers in sorted(grouped.items())
        ]

    return (
        pairs_to_answers(pairs_for("ingles"), 63),
        pairs_to_answers(pairs_for("espanhol"), 63),
    )


def pairs_to_answers(pairs: list[tuple[str, str]], total: int) -> tuple[dict[str, str], list[int]]:
    answers: dict[str, str] = {}
    annulled: list[int] = []
    seen: set[int] = set()

    for raw_number, raw_answer in pairs:
        number = int(raw_number)
        if number in seen:
            raise IngestionError(f"questão duplicada: {number}")
        seen.add(number)
        answer = normalize_answer(raw_answer)
        if answer is None:
            annulled.append(number)
        else:
            answers[str(number)] = answer

    validate_answers(answers, annulled, total)
    return answers, sorted(annulled)


def subject_ranges(*ranges: tuple[str, str, str, int, int]) -> list[dict[str, object]]:
    return [
        {"id": subject_id, "label": label, "area": area, "range": [start, end]}
        for subject_id, label, area, start, end in ranges
    ]


def make_retrieval(doc: PdfDocument, parser_version: str, revision: str) -> dict[str, object]:
    return {
        "originalUrl": doc.url,
        "effectiveSourceUrl": doc.url,
        "sourceType": "pdf-reference",
        "fetchedAt": FETCHED_AT,
        "sha256": doc.sha256,
        "bytes": doc.size,
        "parserVersion": parser_version,
        "revision": revision,
        "final": revision in {"final", "rectified"},
    }


def entry(
    *,
    edition: str,
    year: int,
    label: str,
    phase: str,
    total: int,
    answers: dict[str, str],
    annulled: list[int],
    variants: list[dict[str, object]],
    canonical_variant: str,
    variant_relation: str,
    revision: str,
    archive_page: str,
    subjects: list[dict[str, object]],
    parser_version: str,
    retrieval: dict[str, object],
    validation_evidence: list[str],
) -> dict[str, object]:
    answer_key_url = next(v["answerKeyUrl"] for v in variants if v["id"] == canonical_variant)
    exam_url = next(v["examUrl"] for v in variants if v["id"] == canonical_variant)
    return {
        "edition": edition,
        "year": year,
        "label": label,
        "phase": phase,
        "total": total,
        "canonicalVariant": canonical_variant,
        "variantRelation": variant_relation,
        "revision": revision,
        "answers": answers,
        "annulled": annulled,
        "variants": variants,
        "answerKeyUrl": answer_key_url,
        "examUrl": exam_url,
        "archivePage": archive_page,
        "subjects": subjects,
        "contentMode": "reference-only",
        "rightsStatus": "official-reference",
        "validationLevel": "reviewed",
        "validationEvidence": validation_evidence,
        "retrieval": retrieval,
        "parserVersion": parser_version,
    }


def write_provider(provider_id: str, data: dict[str, object]) -> None:
    destination = RAIZ / "src" / "lib" / "providers" / provider_id / "answer-keys.generated.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{provider_id}: {len(data)} entrada(s) -> {destination.relative_to(RAIZ)}")


def discover_page_contains(page_url: str, expected_urls: list[str]) -> None:
    text = fetch_text(page_url)
    hrefs = re.findall(r"href\s*=\s*[\"']([^\"']+)[\"']", text, re.IGNORECASE)
    discovered = {
        urllib.parse.unquote(urllib.parse.urljoin(page_url, html.unescape(href)))
        for href in hrefs
    }
    missing = [
        url
        for url in expected_urls
        if urllib.parse.unquote(url) not in discovered
    ]
    if missing:
        raise IngestionError(f"página oficial não contém URLs esperadas: {missing[:2]}")


UNICAMP = {
    2026: {
        "archive": "https://www.comvest.unicamp.br/ingresso-2026/vestibular-2026/provas-e-gabaritos-vestibular-2026/",
        "variant_relation": "unknown",
        "canonical": "qx",
        "revision": "final",
        "variants": [
            ("qx", "Provas Q e X", "https://www.comvest.unicamp.br/vest2026/F1/f12026Q_X.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2025/10/Q_X-gabarito.pdf"),
            ("ry", "Provas R e Y", "https://www.comvest.unicamp.br/vest2026/F1/f12026R_Y.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2025/10/R_Y-gabarito.pdf"),
            ("sz", "Provas S e Z", "https://www.comvest.unicamp.br/vest2026/F1/f12026S_Z.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2025/10/S_Z-gabarito.pdf"),
            ("tw", "Provas T e W", "https://www.comvest.unicamp.br/vest2026/F1/f12026T_W.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2025/10/T_W-gabarito.pdf"),
        ],
    },
    2025: {
        "archive": "https://www.comvest.unicamp.br/ingresso-2025/vestibular-2025/",
        "variant_relation": "unknown",
        "canonical": "qz",
        "revision": "final",
        "variants": [
            ("qz", "Provas Q e Z", "https://www.comvest.unicamp.br/vest2025/F1/f12025Q_Z.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2024/10/QZ_gabarito_2025_FINAL_site.pdf"),
            ("rw", "Provas R e W", "https://www.comvest.unicamp.br/vest2025/F1/f12025R_W.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2024/10/RW_gabarito_2025_FINAL_site.pdf"),
            ("sx", "Provas S e X", "https://www.comvest.unicamp.br/vest2025/F1/f12025S_X.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2024/10/SX_gabarito_2025_FINAL_site.pdf"),
            ("ty", "Provas T e Y", "https://www.comvest.unicamp.br/vest2025/F1/f12025T_Y.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2024/10/TY_gabarito_2025_FINAL_site.pdf"),
        ],
    },
    2024: {
        "archive": "https://www.comvest.unicamp.br/ingresso-2024/vestibular-2024-2/area-doa-candidatoa/",
        "variant_relation": "unknown",
        "canonical": "qy",
        "revision": "final",
        "variants": [
            ("qy", "Provas Q e Y", "https://www.comvest.unicamp.br/vest2024/F1/f12024Q_Y.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2023/10/Q_Y.pdf"),
            ("rz", "Provas R e Z", "https://www.comvest.unicamp.br/vest2024/F1/f12024R_Z.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2023/10/R_Z.pdf"),
            ("sw", "Provas S e W", "https://www.comvest.unicamp.br/vest2024/F1/f12024S_W.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2023/10/S_W.pdf"),
            ("tx", "Provas T e X", "https://www.comvest.unicamp.br/vest2024/F1/f12024T_X.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2023/10/T_X.pdf"),
        ],
    },
}


UEL_2026_URLS = {
    "archive": "https://www.cops.uel.br/v2/ProvasGabaritos/DivulgacaoProvasGabaritos1DiaVestibularDefinitivo/Selecao/370/Atividade/20969",
    "exam": "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZjg1ZTQzM2QwMGNjOWUyMzFmZjEzMjZlYzc1ZGI0YjE4NTIwZDdhYjBjY2MxYjU2YTljYzcyYjgxOGI4ZGE1MTI=",
    "answer": "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZmQxZmEzNWU2YjZmYzkwOWE4NjBkM2YyMWJhOTJjZDVhM2RkZjRhNDNmMGQzN2RjYjFmMGZmYzY0YmExZGI4NGJkMGU1MTAxOTYwZThhNjBmN2I1MzE4NzI2ZDIxZDk4YQ==",
    "variant_answers": [
        ("tipo-1", "Tipo 1 - Inglês", "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZmQxZmEzNWU2YjZmYzkwOWE4NjBkM2YyMWJhOTJjZDVhM2RkZjRhNDNmMGQzN2RjYjFmMGZmYzY0YmExZGI4NGJkMGU1MTAxOTYwZThhNjBmN2I1MzE4NzI2ZDIxZDk4YQ=="),
        ("tipo-2", "Tipo 2 - Inglês", "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZjYyMjI4YzI3MDg0YjFiOGIxZjMzZGM5OTI0YzkyNzFkM2RkZjRhNDNmMGQzN2RjYjFmMGZmYzY0YmExZGI4NGJkMGU1MTAxOTYwZThhNjBmN2I1MzE4NzI2ZDIxZDk4YQ=="),
        ("tipo-3", "Tipo 3 - Inglês", "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZjZmMzcxMjYxN2JhNThhMjM4OTQ0MzBiZTYxZjJhYWMzM2RkZjRhNDNmMGQzN2RjYjFmMGZmYzY0YmExZGI4NGJkMGU1MTAxOTYwZThhNjBmN2I1MzE4NzI2ZDIxZDk4YQ=="),
    ],
}


PUCSP = {
    2026: {
        "edition": "2026-verao",
        "label": "Vestibular PUC-SP Verão 2026",
        "archive": "https://nucvest.com.br/pucsp/vestibular/2026/verao/index.html",
        "exam": "https://nucvest.com.br/downloads/pucsp/vestibular/2026/verao/gabarito-e-prova/PUC-SP-Verao-2026-A4-v2-direito-autoral-digital.pdf",
        "answer": "https://nucvest.com.br/downloads/pucsp/vestibular/2026/verao/gabarito-e-prova/PUC-Verao-2026-Gabarito.pdf",
        "revision": "final",
    },
    2025: {
        "edition": "2025-verao",
        "label": "Vestibular PUC-SP Verão 2025",
        "archive": "https://nucvest.com.br/pucsp/vestibular/2025/verao/index.html",
        "exam": "https://nucvest.com.br/downloads/pucsp/vestibular/2025/verao/gabarito-e-prova/PUC-SP-verao-2025-A4-DIREITO-AUTORAL.pdf",
        "answer": "https://nucvest.com.br/downloads/pucsp/vestibular/2025/verao/gabarito-e-prova/PUC-Verao-2025-Gabarito-Republicado.pdf",
        "revision": "rectified",
    },
    2024: {
        "edition": "2024-verao",
        "label": "Vestibular PUC-SP Verão 2024",
        "archive": "https://nucvest.com.br/pucsp/vestibular/2025/index.html",
        "exam": "https://nucvest.com.br/downloads/pucsp/vestibular/2024/verao/PUC-SP-Verao-2024-A4-v1.pdf",
        "answer": "https://nucvest.com.br/downloads/pucsp/vestibular/2024/verao/PUC-SP-Verao-2024-Gabarito.pdf",
        "revision": "final",
    },
}


PUC_RIO = {
    2026: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2026/",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2026/download/Vestibular2026_Download-Completo.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2026/download/PROVAS-2o-dia/Prova-2o-dia-Tarde-G1-3-4/2o-DIA-TARDE-GRUPO-1.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2026/download/GABARITOS-2o-dia/Gabarito 2o dia tarde G1-3-4/2o-DIA- TARDE-GRUPO-1- gabarito.pdf",
        "total": 45,
        "parser": "highlight",
        "revision": "final",
    },
    2025: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2025/index.html",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2025/download/Vestibular2025_Download-Completo.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2025/download/03 - PROVAS 2o DIA/2o DIA - TARDE - GRUPO 1.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2025/download/04 - GABARITOS 2o DIA/GABARITO - 2o DIA - TARDE - GRUPO 1.pdf",
        "total": 45,
        "parser": "highlight",
        "revision": "final",
    },
    2024: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2023-2/",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2023-2/download/Vestibular2024-Provas-e-Gabaritos-v2.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2023-2/download/2oDIA-TARDE-GRUPO-1.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2023-2/download/GABARITO-2024-2oDIA-TARDE-GRUPO-1.pdf",
        "total": 45,
        "parser": "highlight",
        "revision": "final",
    },
    2020: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2020/",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2020/download/Vestibular2020_provasegabaritos_completo.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2020/download/PUC2020-2o DIA_TARDE_GRUPO1.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2020/download/gabarito_2020_G1_20OUT2019.pdf",
        "total": 45,
        "parser": "text",
        "revision": "rectified",
    },
    2019: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2019/",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2019/download/Vestibular2019_20181014_TodasProvasGabaritos.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2019/download/provas/Vestibular2019Tarde_20181014_Dia02_provaGRUPO1.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2019/download/gabaritos/Vestibular2019Tarde_20181014_Dia02_gabarito_Grupo1.pdf",
        "total": 45,
        "parser": "text",
        "revision": "final",
    },
    2018: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2018/",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2018/download/VEST2018PUCRio_PROVAS_GABARITOS_V7.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2018/download/provas/Vest2018_prova_G1_20171015.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2018/download/gabaritos/Vest2018_gabarito_G1_20171015_v2.pdf",
        "total": 45,
        "parser": "text",
        "revision": "rectified",
    },
    2017: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2017/",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2017/download/VEST2017PUCRio_PROVAS_GABARITOS_v4.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2017/download/provas/Vest2017_prova_G1_20161010.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2017/download/gabaritos/Vest2017_gabarito_G1_20161010.pdf",
        "total": 20,
        "parser": "text",
        "revision": "final",
    },
    2016: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2016/",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2016/download/VEST2016PUCRio_PROVAS_GABARITOS_V4.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2016/download/provas/Vest2016_prova_G1_20151012.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2016/download/gabaritos/Vest2016_gabarito_G1_20151012_v3.pdf",
        "total": 20,
        "parser": "text",
        "revision": "rectified",
    },
    2015: {
        "archive": "https://www.puc-rio.br/vestibular/repositorio/provas/2015/",
        "bundle": "https://www.puc-rio.br/vestibular/repositorio/provas/2015/download/VEST2015PUCRio_PROVAS_GABARITOS_V3.zip",
        "exam": "https://www.puc-rio.br/vestibular/repositorio/provas/2015/download/provas/VEST2015PUCRio_GRUPO_1_13102014_completo.pdf",
        "answer": "https://www.puc-rio.br/vestibular/repositorio/provas/2015/download/gabaritos/VEST2015PUCRioGabarito G1_20141013_completoD.pdf",
        "total": 20,
        "parser": "text",
        "revision": "final",
    },
}


UDESC_ARCHIVE = "https://www.udesc.br/vestibular/provasanteriores"
UDESC = [
    (
        "2015.1",
        2015,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2015_1___Gabarito_1713462676661_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2015_1___Prova_Matutino_17134626766615_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2015_1___Prova_Vespertino_17134626766622_17802.pdf",
    ),
    (
        "2015.2",
        2015,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2015_2___Gabarito_17134626186501_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2015_2___Prova_Matutina_17134626186509_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2015_2___Prova_Vespertina_17134626186524_17802.pdf",
    ),
    (
        "2016.1",
        2016,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2016_1___Gabarito_17134625467754_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2016_1___Prova_Matutina_17134625467761_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2016_1___Prova_Vespertina_17134625467776_17802.pdf",
    ),
    (
        "2016.2",
        2016,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2016_2_Gabarito_17134624709009_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2016_2_Prova_Matutina_17134624709013_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2016_2_Prova_Vespertina_17134624709027_17802.pdf",
    ),
    (
        "2017.1",
        2017,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2017_1___Gabarito_17134624077682_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2017_1_Prova_Matutina_17134624077686_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2017_1_Prova_Vespertina_17134624077702_17802.pdf",
    ),
    (
        "2017.2",
        2017,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2017_2___Gabarito_17134623321131_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2017_2___Prova_Matutina_17134623321135_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2017_2___Prova_Vespertina_17134623321151_17802.pdf",
    ),
    (
        "2018.1",
        2018,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/GABARITO_OFICAL_2018_1_doc_17134620755224_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2018_1___Prova_matutina_17134620755178_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2018_1___Prova_vespertina_17134620755199_17802.pdf",
    ),
    (
        "2018.2",
        2018,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2018_2_Gabarito_17134619632189_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2018_2_Prova_Matutino_17134619632193_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2018_2_Prova_Vespertino_17134619632214_17802.pdf",
    ),
    (
        "2019.1",
        2019,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2019_1___Gabarito_17134619012312_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2019_1___Prova_Matutino_17134619012318_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2019_1___Prova_Vespertino_17134619012333_17802.pdf",
    ),
    (
        "2019.2",
        2019,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2019_2___Gabarito_171346182945_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2019_2___Prova_Matutino_17134618294506_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2019_2___Prova_Vespertino_17134618294521_17802.pdf",
    ),
    (
        "2020.1",
        2020,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2020_1___Gabarito_17134616792464_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2020_1___Prova_matutino_17134616792436_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2020_1___Prova_Vespertino_1713461679245_17802.pdf",
    ),
    (
        "2023.2",
        2023,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2023_2___Gabarito_17134616047737_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2023_2___Prova_Matutino_17134616047708_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2023_2___Prova_Vespertino_17134616047721_17802.pdf",
    ),
    (
        "2024.1",
        2024,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2024_1___Gabarito_17133860755821_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2024_1___Prova_Matutino_17133860755826_17802.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17802/2024_1___Prova_Vespertino_17133860756063_17802.pdf",
    ),
    (
        "2024.2",
        2024,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17918/Gabarito_Oficial_1724951496786_17918.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17918/3___Caderno_de_Prova_2024_2___Per_odo_Matutino_pb_17249513205108_17918.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17918/4___Caderno_de_Prova_2024_2___Per_odo_Vespertino_pb_17249514263672_17918.pdf",
    ),
    (
        "2025.1",
        2025,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17918/Gabarito_Oficial_17406860695787_17918.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17918/Prova_Matutino_2025_17406859895959_17918.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/17918/Caderno_de_Prova_2025_1___Vespertino_17406860472788_17918.pdf",
    ),
    (
        "2025.2",
        2025,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/20080/Gabarito_Oficial_17509754248942_20080.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/20080/Prova_Matutino_2025_2___site_17500321187953_20080.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/20080/Prova_Vespertino_2025_2___site_17500321870438_20080.pdf",
    ),
    (
        "2026.1",
        2026,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/21194/Gabarito_Oficial_176547447291_21194.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/21194/Prova_Matutino_2026_01_1764546991821_21194.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/21194/Prova_Vespertino_2026_01_17645470086405_21194.pdf",
    ),
    (
        "2026.2",
        2026,
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/22463/Gabarito_Oficial_2026_2_1782327803971_22463.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/22463/Prova_Matutino_2026_2_17814818713136_22463.pdf",
        "https://www.udesc.br/arquivos/udesc/id_cpmenu/22463/Prova_Vespertino_2026_2_1781481892914_22463.pdf",
    ),
]

ACAFE = [
    (
        "2026.2",
        2026,
        "https://acafe.org.br/concurso/vestibular/2026/2/site/",
        "https://storage.acafe.org.br/concurso/vestibular/2026/2/02%20-%20prova/03%20-%20gabarito%20oficial.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2026/2/02%20-%20prova/01%20-%20Prova%20comentada.pdf",
    ),
    (
        "2026.1",
        2026,
        "https://acafe.org.br/concurso/vestibular/2026/1/site/",
        "https://storage.acafe.org.br/concurso/vestibular/2026/1/02%20-%20prova/03%20-%20Gabarito%20Verao%202026%20-%20Oficial.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2026/1/02%20-%20prova/01%20-%20Prova%20objetiva%20oficial%20-%20comentada-.pdf",
    ),
    (
        "2025.2",
        2025,
        "https://storage.acafe.org.br/concurso/vestibular/documentos.php?a=2025&s=2",
        "https://storage.acafe.org.br/concurso/vestibular/2025/2/02%20-%20prova/03%20-%20Gabarito%20Inverno%202025%20-%20Oficial.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2025/2/02%20-%20prova/02%20-%20Prova%20objetiva%20oficial%20comentada.pdf",
    ),
    (
        "2025.1",
        2025,
        "https://storage.acafe.org.br/concurso/vestibular/documentos.php?a=2025&s=1",
        "https://storage.acafe.org.br/concurso/vestibular/2025/1/02%20-%20prova/04%20-%20Gabarito%20Verao%202025%20-%20Oficial.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2025/1/02%20-%20prova/02%20-%20Prova%20objetiva%20Verao%202025%20-%20oficial%20comentada.pdf",
    ),
    (
        "2024.2",
        2024,
        "https://storage.acafe.org.br/concurso/vestibular/documentos.php?a=2024&s=2",
        "https://storage.acafe.org.br/concurso/vestibular/2024/2/02%20-%20Prova/04%20-%20Gabarito%20Oficial.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2024/2/02%20-%20Prova/02%20-%20Prova%20objetiva%20Inverno%202024%20oficial%20comentada.pdf",
    ),
    (
        "2024.1",
        2024,
        "https://storage.acafe.org.br/concurso/vestibular/documentos.php?a=2024&s=1",
        "https://storage.acafe.org.br/concurso/vestibular/2024/1/02%20-%20Prova/03%20-%20Gabarito%20oficial.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2024/1/02%20-%20Prova/05%20-Prova%20objetiva.pdf",
    ),
    (
        "2023.2",
        2023,
        "https://storage.acafe.org.br/concurso/vestibular/documentos.php?a=2023&s=2",
        "https://storage.acafe.org.br/concurso/vestibular/2023/2/02%20-%20Prova/02%20-%20Gabarito%20Inverno%202023%20-%20Oficial.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2023/2/02%20-%20Prova/01%20-%20Prova%20objetiva%20Inverno%202023%20-%20comentada.pdf",
    ),
    (
        "2023.1",
        2023,
        "https://storage.acafe.org.br/concurso/vestibular/documentos.php?a=2023&s=1",
        "https://storage.acafe.org.br/concurso/vestibular/2023/1/02%20-%20Prova/05%20-%20Gabarito%20oficial%20Ver%C3%A3o%202023.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2023/1/02%20-%20Prova/04%20-%20Prova%20objetiva%20Ver%C3%A3o%202023.pdf",
    ),
    (
        "2022.2",
        2022,
        "https://storage.acafe.org.br/concurso/vestibular/documentos.php?a=2022&s=2",
        "https://storage.acafe.org.br/concurso/vestibular/2022/2/05%20-%20Prova/1%20-%20Gabarito%20oficial.pdf",
        "https://storage.acafe.org.br/concurso/vestibular/2022/2/05%20-%20Prova/5%20-%20Prova%20comentada-1.pdf",
    ),
]


def ingest_unicamp() -> dict[str, object]:
    parser_version = "unicamp-answer-key@1.0.0"
    catalog: dict[str, object] = {}
    for year, config in sorted(UNICAMP.items(), reverse=True):
        variants = [
            {"id": variant_id, "label": label, "examUrl": exam_url, "answerKeyUrl": answer_url}
            for variant_id, label, exam_url, answer_url in config["variants"]
        ]
        discover_page_contains(config["archive"], [item["examUrl"] for item in variants] + [item["answerKeyUrl"] for item in variants])
        canonical = next(v for v in variants if v["id"] == config["canonical"])
        doc = fetch_pdf(canonical["answerKeyUrl"])
        answers, annulled = parse_unicamp_answer_key(doc.text)
        catalog[str(year)] = entry(
            edition=str(year),
            year=year,
            label=f"Vestibular Unicamp {year} - 1ª fase",
            phase="first",
            total=72,
            answers=answers,
            annulled=annulled,
            variants=variants,
            canonical_variant=config["canonical"],
            variant_relation=config["variant_relation"],
            revision=config["revision"],
            archive_page=config["archive"],
            subjects=subject_ranges(("conhecimentos-gerais", "Conhecimentos gerais", "conhecimentos-gerais", 1, 72)),
            parser_version=parser_version,
            retrieval=make_retrieval(doc, parser_version, config["revision"]),
            validation_evidence=[
                "Página oficial da COMVEST lista prova e gabarito da 1ª fase.",
                "Gabarito canônico cobre exatamente 72 questões.",
                "Variantes são registradas como unknown; só a canônica vira executável.",
            ],
        )
    return catalog


def ingest_uel() -> dict[str, object]:
    parser_version = "uel-answer-key@1.0.0"
    discover_page_contains(
        UEL_2026_URLS["archive"],
        [UEL_2026_URLS["exam"], UEL_2026_URLS["answer"], *(url for _, _, url in UEL_2026_URLS["variant_answers"])],
    )
    doc = fetch_pdf(UEL_2026_URLS["answer"])
    answers, annulled = parse_uel_answer_key(doc.text)
    variants = [
        {"id": variant_id, "label": label, "examUrl": UEL_2026_URLS["exam"] if variant_id == "tipo-1" else None, "answerKeyUrl": answer_url}
        for variant_id, label, answer_url in UEL_2026_URLS["variant_answers"]
    ]
    return {
        "2026": entry(
            edition="2026",
            year=2026,
            label="Vestibular UEL 2026 - 1º dia - Inglês",
            phase="first",
            total=60,
            answers=answers,
            annulled=annulled,
            variants=variants,
            canonical_variant="tipo-1",
            variant_relation="unknown",
            revision="final",
            archive_page=UEL_2026_URLS["archive"],
            subjects=subject_ranges(("conhecimentos-gerais", "Conhecimentos gerais", "conhecimentos-gerais", 1, 60)),
            parser_version=parser_version,
            retrieval=make_retrieval(doc, parser_version, "final"),
            validation_evidence=[
                "Endpoint oficial COPS/UEL identifica gabaritos definitivos do 1º dia.",
                "Gabarito canônico em inglês cobre exatamente 60 questões.",
                "Tipos 1-3 são registrados como unknown; só o Tipo 1 vira executável.",
            ],
        )
    }


def ingest_pucsp() -> dict[str, object]:
    parser_version = "puc-sp-answer-key@1.0.0"
    catalog: dict[str, object] = {}
    for year, config in sorted(PUCSP.items(), reverse=True):
        discover_page_contains(config["archive"], [config["exam"], config["answer"]])
        doc = fetch_pdf(config["answer"])
        answers, annulled = parse_pucsp_answer_key(doc.text)
        catalog[str(year)] = entry(
            edition=config["edition"],
            year=year,
            label=config["label"],
            phase="single",
            total=50,
            answers=answers,
            annulled=annulled,
            variants=[
                {
                    "id": "unica",
                    "label": "Prova única",
                    "examUrl": config["exam"],
                    "answerKeyUrl": config["answer"],
                }
            ],
            canonical_variant="unica",
            variant_relation="unknown",
            revision=config["revision"],
            archive_page=config["archive"],
            subjects=subject_ranges(
                ("matematica", "Matemática e suas tecnologias", "matematica", 1, 5),
                ("ciencias-natureza", "Ciências da Natureza", "ciencias-natureza", 6, 20),
                ("ciencias-humanas", "Ciências Humanas", "ciencias-humanas", 21, 35),
                ("linguagens", "Linguagens e Códigos", "linguagens", 36, 50),
            ),
            parser_version=parser_version,
            retrieval=make_retrieval(doc, parser_version, config["revision"]),
            validation_evidence=[
                "Página oficial NucVest lista caderno e gabarito da edição.",
                "Gabarito cobre exatamente 50 questões objetivas.",
                "PUC-SP é provider próprio, separado de outras PUCs.",
            ],
        )
    return catalog


def ingest_pucrio() -> dict[str, object]:
    parser_version = "puc-rio-answer-key@1.0.0"
    catalog: dict[str, object] = {}
    for year, config in sorted(PUC_RIO.items(), reverse=True):
        discover_page_contains(
            config["archive"],
            [config["exam"], config["answer"]],
        )
        answer_doc = fetch_pdf(config["answer"])
        exam_doc = fetch_pdf(config["exam"])
        total = int(config["total"])
        normalized_answer_text = ascii_upper(answer_doc.text)
        if "PRELIMINAR" in normalized_answer_text or "PROVISORIO" in normalized_answer_text:
            raise IngestionError(f"PUC-Rio {year}: gabarito não é final")

        if config["parser"] == "highlight":
            answers, annulled = parse_pucrio_highlighted_answer_key(
                extract_pdf_geometry(answer_doc.bytes),
                total,
            )
        else:
            answers, annulled = parse_pucrio_text_answer_key(answer_doc.text, total)

        _, _, exam_numbers = analyze_pucrio_pages(extract_pdf_geometry(exam_doc.bytes))
        expected_numbers = set(range(1, total + 1))
        text_numbers = {
            int(number)
            for number in re.findall(
                r"(?m)^\s*([1-9]|[1-4][0-9])(?:\s|\))",
                ascii_upper(exam_doc.text),
            )
            if int(number) <= total
        }
        confirmed_numbers = exam_numbers | text_numbers
        if not expected_numbers.issubset(confirmed_numbers):
            raise IngestionError(
                f"PUC-Rio {year}: caderno objetivo divergente; "
                f"faltantes={sorted(expected_numbers - confirmed_numbers)}"
            )

        revision = str(config["revision"])
        catalog[str(year)] = entry(
            edition=str(year),
            year=year,
            label=f"Vestibular PUC-Rio {year} - 2º dia - Grupo 1",
            phase="day2",
            total=total,
            answers=answers,
            annulled=annulled,
            variants=[
                {
                    "id": "grupo-1",
                    "label": "Grupo 1",
                    "examUrl": config["exam"],
                    "answerKeyUrl": config["answer"],
                }
            ],
            canonical_variant="grupo-1",
            variant_relation="unknown",
            revision=revision,
            archive_page=config["archive"],
            subjects=subject_ranges(
                ("conhecimentos-gerais", "Conhecimentos gerais", "conhecimentos-gerais", 1, total)
            ),
            parser_version=parser_version,
            retrieval=make_retrieval(answer_doc, parser_version, revision),
            validation_evidence=[
                "Página oficial PUC-Rio associa caderno limpo, gabarito e pacote completo da edição.",
                f"Caderno e gabarito cobrem exatamente {total} questões objetivas do 2º dia, Grupo 1.",
                "Matérias não foram inferidas: a edição usa categoria ampla e preserva a taxonomia original no rótulo.",
                "Outros grupos, 1º dia e edições ambíguas permanecem fora do provider executável.",
            ],
        )
    return catalog


def udesc_subjects(edition: str, session: str) -> list[dict[str, object]]:
    if session == "morning":
        return subject_ranges(
            ("matematica", "Matemática", "matematica", 1, 14),
            ("biologia", "Biologia", "ciencias-natureza", 15, 28),
            ("ingles", "Língua Inglesa", "linguagens", 29, 36),
            ("portugues", "Língua Portuguesa e Literatura", "linguagens", 37, 50),
        )
    if edition.startswith("2026."):
        return subject_ranges(
            ("fisica", "Física", "ciencias-natureza", 1, 14),
            ("quimica", "Química", "ciencias-natureza", 15, 28),
            ("historia", "História", "ciencias-humanas", 29, 37),
            ("filosofia", "Filosofia", "ciencias-humanas", 38, 39),
            ("geografia", "Geografia", "ciencias-humanas", 40, 48),
            ("sociologia", "Sociologia", "ciencias-humanas", 49, 50),
        )
    return subject_ranges(
        ("fisica", "Física", "ciencias-natureza", 1, 14),
        ("quimica", "Química", "ciencias-natureza", 15, 28),
        ("historia", "História", "ciencias-humanas", 29, 39),
        ("geografia", "Geografia", "ciencias-humanas", 40, 50),
    )


def ingest_udesc() -> dict[str, object]:
    parser_version = "udesc-answer-key@1.0.0"
    catalog: dict[str, object] = {}
    for edition, year, answer_url, morning_url, afternoon_url in reversed(UDESC):
        discover_page_contains(UDESC_ARCHIVE, [answer_url, morning_url, afternoon_url])
        doc = fetch_pdf(answer_url)
        try:
            morning_english, morning_spanish, afternoon = parse_udesc_answer_key(doc.text)
        except IngestionError as exc:
            raise IngestionError(f"UDESC {edition}: {exc}") from exc

        for session, label, phase, exam_url, parsed in [
            ("morning", "Matutino", "morning", morning_url, morning_english),
            ("afternoon", "Vespertino", "afternoon", afternoon_url, afternoon),
        ]:
            answers, annulled = parsed
            variants = [
                {
                    "id": "ingles" if session == "morning" else "unica",
                    "label": "Inglês" if session == "morning" else "Prova única",
                    "examUrl": exam_url,
                    "answerKeyUrl": answer_url,
                }
            ]
            if session == "morning":
                variants.append(
                    {
                        "id": "espanhol",
                        "label": "Espanhol",
                        "examUrl": exam_url,
                        "answerKeyUrl": answer_url,
                    }
                )

            record = entry(
                edition=edition,
                year=year,
                label=f"Vestibular UDESC {edition} - período {label.lower()}",
                phase=phase,
                total=50,
                answers=answers,
                annulled=annulled,
                variants=variants,
                canonical_variant="ingles" if session == "morning" else "unica",
                variant_relation="distinct" if session == "morning" else "unknown",
                revision="final",
                archive_page=UDESC_ARCHIVE,
                subjects=udesc_subjects(edition, session),
                parser_version=parser_version,
                retrieval=make_retrieval(doc, parser_version, "final"),
                validation_evidence=[
                    "Arquivo oficial UDESC associa a edição ao caderno e ao gabarito oficial.",
                    f"Período {label.lower()} cobre exatamente 50 questões objetivas.",
                    "Inglês é a língua canônica do período matutino; Espanhol foi validado mas não é executável nesta wave.",
                ],
            )
            if session == "morning":
                spanish_answers, spanish_annulled = morning_spanish
                record["variantAnswerKeys"] = {
                    "espanhol": {
                        "answers": spanish_answers,
                        "annulled": spanish_annulled,
                    }
                }
            catalog[f"{edition}-{session}"] = record
    return catalog


def acafe_subjects() -> list[dict[str, object]]:
    return subject_ranges(
        ("portugues", "Língua Portuguesa", "linguagens", 1, 10),
        ("literatura", "Literatura", "linguagens", 11, 14),
        ("ingles", "Língua Inglesa", "linguagens", 15, 21),
        ("matematica", "Matemática", "matematica", 22, 28),
        ("fisica", "Física", "ciencias-natureza", 29, 35),
        ("quimica", "Química", "ciencias-natureza", 36, 42),
        ("biologia", "Biologia", "ciencias-natureza", 43, 49),
        ("historia", "História", "ciencias-humanas", 50, 56),
        ("geografia", "Geografia", "ciencias-humanas", 57, 63),
    )


def ingest_acafe() -> dict[str, object]:
    parser_version = "acafe-answer-key@1.0.0"
    catalog: dict[str, object] = {}
    for edition, year, archive_page, answer_url, exam_url in ACAFE:
        discover_page_contains(archive_page, [answer_url, exam_url])
        doc = fetch_pdf(answer_url)
        try:
            english, spanish = parse_acafe_answer_key(doc.text)
        except IngestionError as exc:
            raise IngestionError(f"ACAFE {edition}: {exc}") from exc

        english_answers, english_annulled = english
        spanish_answers, spanish_annulled = spanish
        record = entry(
            edition=edition,
            year=year,
            label=f"Vestibular de Medicina ACAFE {edition}",
            phase="single",
            total=63,
            answers=english_answers,
            annulled=english_annulled,
            variants=[
                {
                    "id": "ingles",
                    "label": "Inglês",
                    "examUrl": exam_url,
                    "answerKeyUrl": answer_url,
                },
                {
                    "id": "espanhol",
                    "label": "Espanhol",
                    "examUrl": exam_url,
                    "answerKeyUrl": answer_url,
                },
            ],
            canonical_variant="ingles",
            variant_relation="distinct",
            revision="final",
            archive_page=archive_page,
            subjects=acafe_subjects(),
            parser_version=parser_version,
            retrieval=make_retrieval(doc, parser_version, "final"),
            validation_evidence=[
                "Página oficial ACAFE associa a edição à prova e ao gabarito oficial.",
                "Gabarito final cobre exatamente 63 questões objetivas.",
                "Inglês e Espanhol são variantes distintas; Inglês é a canônica executável.",
            ],
        )
        record["variantAnswerKeys"] = {
            "espanhol": {
                "answers": spanish_answers,
                "annulled": spanish_annulled,
            }
        }
        catalog[edition] = record
    return catalog


IMPORTERS: dict[str, Callable[[], dict[str, object]]] = {
    "unicamp": ingest_unicamp,
    "uel": ingest_uel,
    "puc-sp": ingest_pucsp,
    "puc-rio": ingest_pucrio,
    "udesc": ingest_udesc,
    "acafe": ingest_acafe,
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Ingere gabaritos oficiais em modo referência.")
    parser.add_argument("provider", nargs="?", default="all", choices=["all", *IMPORTERS.keys()])
    args = parser.parse_args(argv)

    targets = IMPORTERS.keys() if args.provider == "all" else [args.provider]
    for provider_id in targets:
        write_provider(provider_id, IMPORTERS[provider_id]())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
