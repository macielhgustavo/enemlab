#!/usr/bin/env python3
"""Recupera conteúdo textual por OCR local em regiões de questão da FUVEST.

Este worker existe para PDFs cuja identidade das questões continua legível, mas a
camada textual do corpo está semanticamente corrompida. O primeiro layout
suportado é a FUVEST 2021: os rótulos 01..90 aparecem em fonte/posições estáveis,
enquanto o corpo usa fontes que a extração textual expõe como controles.

Regras de segurança do pipeline:

- a identidade da questão vem da geometria do PDF, nunca do OCR;
- a sequência geométrica deve fechar exatamente 1..N antes de qualquer troca;
- somente questões já estruturalmente incompletas são alvo;
- somente um OCR que recupere enunciado + alternativas A-E completas substitui
  o texto corrompido; resultado parcial permanece bloqueado;
- o gabarito canônico nunca é derivado nem alterado;
- documentos permanecem ligados aos mesmos SHA-256;
- toda questão tocada por OCR recebe erro de fidelidade semântica e exige revisão;
- mídia previamente pendente nunca é considerada resolvida por OCR de texto.

Tesseract é fallback local. A ausência do binário/língua portuguesa faz o worker
recusar a recuperação sem quebrar a extração primária.
"""

from __future__ import annotations

import argparse
import collections
import copy
import hashlib
import json
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

BASE = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))

WORKER_NAME = "fuvest-regional-content-ocr"
WORKER_VERSION = "fuvest-regional-content-ocr@0.1.0"
TARGET_YEAR = 2021
QUESTION_LABEL_FONT_TOKEN = "SegoeUIBlack"
OCR_MODES = (6, 4, 3, 11)
LETTERS = ("A", "B", "C", "D", "E")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def structurally_complete(question: dict[str, Any]) -> bool:
    alternatives = question.get("alternatives")
    return bool(question.get("statement")) and isinstance(alternatives, list) and [
        alternative.get("id") for alternative in alternatives
    ] == list(LETTERS) and all(alternative.get("text") for alternative in alternatives)


def should_attempt_region_recovery(
    envelope: dict[str, Any], entry: dict[str, Any]
) -> bool:
    if int(entry.get("year", 0)) != TARGET_YEAR:
        return False
    questions = envelope.get("extraction", {}).get("questions", [])
    if len(questions) != int(entry.get("total", 0)):
        return False
    return any(not structurally_complete(question) for question in questions)


def validate_bound_envelope(
    envelope: dict[str, Any],
    entry: dict[str, Any],
    exam_bytes: bytes,
    answer_key_bytes: bytes,
) -> list[int]:
    if envelope.get("protocolVersion") != "enemlab-extraction/v1":
        raise ValueError("regional OCR requires enemlab-extraction/v1")

    identity = envelope.get("identity", {})
    expected_identity = BASE["envelope_identity"](entry)
    for key, expected in expected_identity.items():
        if identity.get(key) != expected:
            raise ValueError("regional OCR envelope identity does not match manifest")

    BASE["verify_answer_key_hash"](entry, answer_key_bytes)
    expected_documents = {
        str(entry["examUrl"]): BASE["sha256_bytes"](exam_bytes),
        str(entry["answerKeyUrl"]): BASE["sha256_bytes"](answer_key_bytes),
    }
    actual_documents = {
        str(document.get("url")): str(document.get("sha256", "")).lower()
        for document in envelope.get("documents", [])
        if isinstance(document, dict)
    }
    if actual_documents != expected_documents:
        raise ValueError("regional OCR document SHA binding mismatch")

    extraction = envelope.get("extraction", {})
    canonical_key = {str(key): value for key, value in entry.get("answers", {}).items()}
    if extraction.get("answerKey") != canonical_key:
        raise ValueError("regional OCR refuses a non-canonical answer key")

    questions = extraction.get("questions", [])
    expected_count = int(entry["total"])
    if len(questions) != expected_count:
        raise ValueError("regional OCR requires complete question identity coverage")
    numbers = [int(question.get("number", 0)) for question in questions]
    if numbers != list(range(1, expected_count + 1)):
        raise ValueError("regional OCR requires exact question sequence 1..N")

    return [
        int(question["number"])
        for question in questions
        if not structurally_complete(question)
    ]


def parse_ocr_candidate(text: str, question_number: int) -> dict[str, Any]:
    lines = [line.strip() for line in text.replace("\r", "\n").splitlines() if line.strip()]
    if lines and re.fullmatch(r"0?\d{1,2}", lines[0]):
        lines = lines[1:]

    statement, alternatives, context = BASE["parse_alternatives"](lines)
    complete = bool(statement.strip()) and alternatives is not None and [
        alternative.get("id") for alternative in alternatives
    ] == list(LETTERS) and all(alternative.get("text") for alternative in alternatives)
    return {
        "number": question_number,
        "statement": statement,
        "alternatives": alternatives,
        "context": context,
        "complete": complete,
        "markers": BASE["alternative_marker_count"](lines),
        "alphaCharacters": sum(character.isalpha() for character in text),
        "needsMedia": BASE["media_reference"]("\n".join(lines)),
        "ocrTextSha256": sha256_bytes(text.encode("utf-8")),
    }


def candidate_score(candidate: dict[str, Any]) -> tuple[int, int, int]:
    return (
        1 if candidate.get("complete") else 0,
        min(int(candidate.get("markers", 0)), len(LETTERS)),
        int(candidate.get("alphaCharacters", 0)),
    )


def select_best_candidate(
    attempts: list[tuple[int, str]], question_number: int
) -> tuple[int, dict[str, Any]]:
    if not attempts:
        raise ValueError("regional OCR received no candidate attempts")
    parsed = [
        (mode, parse_ocr_candidate(text, question_number)) for mode, text in attempts
    ]
    return max(parsed, key=lambda item: candidate_score(item[1]))


def validate_question_labels(
    labels: list[dict[str, Any]], expected_count: int
) -> list[dict[str, Any]]:
    ordered = sorted(labels, key=lambda item: int(item["number"]))
    numbers = [int(item["number"]) for item in ordered]
    if numbers != list(range(1, expected_count + 1)):
        raise ValueError("question label geometry did not close exactly at 1..N")
    if len({(int(item["page"]), int(item["number"])) for item in ordered}) != expected_count:
        raise ValueError("duplicate question label geometry")
    return ordered


def build_question_regions(
    labels: list[dict[str, Any]],
    page_sizes: dict[int, tuple[float, float]],
    expected_count: int,
) -> list[dict[str, Any]]:
    ordered = validate_question_labels(labels, expected_count)
    grouped: dict[tuple[int, str], list[dict[str, Any]]] = collections.defaultdict(list)

    for source in ordered:
        item = dict(source)
        page_number = int(item["page"])
        if page_number not in page_sizes:
            raise ValueError("question label references an unknown PDF page")
        width, _ = page_sizes[page_number]
        midpoint = width / 2.0
        item["column"] = "L" if float(item["x0"]) < midpoint else "R"
        grouped[(page_number, item["column"])].append(item)

    for values in grouped.values():
        values.sort(key=lambda item: float(item["y0"]))

    regions: list[dict[str, Any]] = []
    for item in ordered:
        page_number = int(item["page"])
        width, height = page_sizes[page_number]
        midpoint = width / 2.0
        column = "L" if float(item["x0"]) < midpoint else "R"
        peers = grouped[(page_number, column)]
        position = next(
            index for index, peer in enumerate(peers) if int(peer["number"]) == int(item["number"])
        )
        next_y = (
            float(peers[position + 1]["y0"])
            if position + 1 < len(peers)
            else min(height - 30.0, 805.0)
        )
        x0 = 28.0 if column == "L" else midpoint + 4.0
        x1 = midpoint - 5.0 if column == "L" else width - 28.0
        y0 = max(32.0, float(item["y0"]) - 4.0)
        y1 = min(height - 30.0, max(y0 + 24.0, next_y - 3.0))
        if x1 <= x0 or y1 <= y0:
            raise ValueError("invalid regional OCR crop geometry")
        regions.append(
            {
                "number": int(item["number"]),
                "page": page_number,
                "column": column,
                "bbox": [round(x0, 3), round(y0, 3), round(x1, 3), round(y1, 3)],
            }
        )
    return regions


def discover_question_regions(
    pdf_bytes: bytes, expected_count: int
) -> list[dict[str, Any]]:
    try:
        import pymupdf
    except ImportError as error:  # pragma: no cover - depends on runtime package
        raise RuntimeError("PyMuPDF is required for regional OCR geometry") from error

    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    labels: list[dict[str, Any]] = []
    page_sizes: dict[int, tuple[float, float]] = {}
    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        page_number = page_index + 1
        page_sizes[page_number] = (float(page.rect.width), float(page.rect.height))
        raw = page.get_text("dict")
        for block in raw.get("blocks", []):
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                text = "".join(str(span.get("text", "")) for span in spans).strip()
                bbox = line.get("bbox")
                if not bbox or not re.fullmatch(r"\d{2}", text):
                    continue
                fonts = {str(span.get("font", "")) for span in spans}
                if not any(QUESTION_LABEL_FONT_TOKEN in font for font in fonts):
                    continue
                x0, y0, x1, y1 = map(float, bbox)
                labels.append(
                    {
                        "number": int(text),
                        "page": page_number,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                    }
                )
    document.close()
    return build_question_regions(labels, page_sizes, expected_count)


def tesseract_language() -> tuple[str | None, str | None]:
    executable = shutil.which("tesseract")
    if not executable:
        return None, "tesseract-not-installed"
    try:
        output = subprocess.run(
            [executable, "--list-langs"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None, "tesseract-language-probe-failed"
    languages = {line.strip() for line in output.splitlines()[1:] if line.strip()}
    if "por" not in languages:
        return None, "tesseract-portuguese-language-missing"
    return ("por+eng" if "eng" in languages else "por"), None


def ocr_question_regions(
    pdf_bytes: bytes,
    regions: list[dict[str, Any]],
    target_numbers: list[int],
) -> tuple[dict[int, dict[str, Any]], dict[str, Any]]:
    language, unavailable_reason = tesseract_language()
    base_report: dict[str, Any] = {
        "workerVersion": WORKER_VERSION,
        "attempted": False,
        "applied": False,
        "targetedQuestions": list(target_numbers),
        "appliedQuestions": [],
        "unresolvedQuestions": list(target_numbers),
        "attemptsByMode": {},
        "regions": [],
    }
    if unavailable_reason:
        base_report["rejectedReason"] = unavailable_reason
        return {}, base_report

    try:
        import pymupdf
    except ImportError:
        base_report["rejectedReason"] = "pymupdf-not-installed"
        return {}, base_report

    by_number = {int(region["number"]): region for region in regions}
    if any(number not in by_number for number in target_numbers):
        raise ValueError("regional OCR target has no proven geometry")

    recovered: dict[int, dict[str, Any]] = {}
    attempts_by_mode: collections.Counter[int] = collections.Counter()
    region_reports: list[dict[str, Any]] = []
    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    executable = shutil.which("tesseract")
    assert executable is not None and language is not None

    with tempfile.TemporaryDirectory(prefix="enemlab-fuvest-region-") as directory:
        temporary = Path(directory)
        for number in target_numbers:
            region = by_number[number]
            page = document.load_page(int(region["page"]) - 1)
            x0, y0, x1, y1 = [float(value) for value in region["bbox"]]
            pixmap = page.get_pixmap(
                matrix=pymupdf.Matrix(3, 3),
                clip=pymupdf.Rect(x0, y0, x1, y1),
                alpha=False,
            )
            image_path = temporary / f"q{number:03d}.png"
            image_path.write_bytes(pixmap.tobytes("png"))

            attempts: list[tuple[int, str]] = []
            selected_mode: int | None = None
            selected: dict[str, Any] | None = None
            for mode in OCR_MODES:
                attempts_by_mode[mode] += 1
                text = subprocess.run(
                    [
                        executable,
                        str(image_path),
                        "stdout",
                        "-l",
                        language,
                        "--psm",
                        str(mode),
                    ],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    text=True,
                ).stdout
                text = "\n".join(line.rstrip() for line in text.splitlines() if line.strip())
                attempts.append((mode, text))
                candidate = parse_ocr_candidate(text, number)
                if candidate["complete"]:
                    selected_mode = mode
                    selected = candidate
                    break

            if selected is None:
                selected_mode, selected = select_best_candidate(attempts, number)
            selected["ocrMode"] = selected_mode
            region_reports.append(
                {
                    "questionNumber": number,
                    "page": int(region["page"]),
                    "column": region["column"],
                    "bbox": list(region["bbox"]),
                    "selectedMode": selected_mode,
                    "structurallyComplete": bool(selected["complete"]),
                    "ocrTextSha256": selected["ocrTextSha256"],
                }
            )
            if selected["complete"]:
                selected["page"] = int(region["page"])
                recovered[number] = selected

    document.close()
    unresolved = [number for number in target_numbers if number not in recovered]
    return recovered, {
        **base_report,
        "attempted": True,
        "applied": bool(recovered),
        "appliedQuestions": sorted(recovered),
        "unresolvedQuestions": unresolved,
        "attemptsByMode": {str(mode): count for mode, count in sorted(attempts_by_mode.items())},
        "regions": region_reports,
        "language": language,
        "renderScale": 3,
    }


def apply_recovered_questions(
    envelope: dict[str, Any],
    entry: dict[str, Any],
    recovered: dict[int, dict[str, Any]],
    report: dict[str, Any],
) -> dict[str, Any]:
    if not recovered:
        return envelope

    value = copy.deepcopy(envelope)
    extraction = value["extraction"]
    original_key = copy.deepcopy(extraction["answerKey"])
    applied_numbers = set(recovered)

    for question in extraction["questions"]:
        number = int(question["number"])
        candidate = recovered.get(number)
        if not candidate:
            continue
        question["statement"] = candidate["statement"]
        question["alternatives"] = candidate["alternatives"]
        if candidate.get("context"):
            question["context"] = candidate["context"]
        else:
            question.pop("context", None)
        question["page"] = int(candidate["page"])
        question["sourceDocumentUrl"] = entry["examUrl"]

    issues = [
        issue
        for issue in extraction.get("semanticFidelityIssues", [])
        if int(issue.get("questionNumber") or 0) not in applied_numbers
    ]
    for number in sorted(applied_numbers):
        candidate = recovered[number]
        issues.append(
            {
                "code": "extractor-reported",
                "severity": "error",
                "questionNumber": number,
                "page": int(candidate["page"]),
                "message": (
                    "texto reconstruído por OCR regional local após corrupção da camada PDF; "
                    "revisão semântica obrigatória antes de qualquer uso nativo"
                ),
            }
        )
    extraction["semanticFidelityIssues"] = issues

    missing_media = {int(number) for number in extraction.get("questionsMissingMedia", [])}
    missing_media.update(
        number for number, candidate in recovered.items() if candidate.get("needsMedia")
    )
    extraction["questionsMissingMedia"] = sorted(missing_media)

    warnings = [
        warning
        for warning in extraction.get("warnings", [])
        if not any(warning.startswith(f"questão {number}:") for number in applied_numbers)
    ]
    warnings.extend(
        f"questão {number}: texto reconstruído por OCR regional; revisão semântica obrigatória"
        for number in sorted(applied_numbers)
    )
    extraction["warnings"] = warnings

    if extraction["answerKey"] != original_key:
        raise AssertionError("regional OCR changed the canonical answer key")

    value["extractor"] = {"name": WORKER_NAME, "version": WORKER_VERSION}
    value["recovery"] = {
        "method": "regional-content-ocr",
        "workerVersion": WORKER_VERSION,
        "targetedQuestions": list(report.get("targetedQuestions", [])),
        "appliedQuestions": sorted(applied_numbers),
        "unresolvedQuestions": list(report.get("unresolvedQuestions", [])),
        "semanticVerificationRequired": True,
        "answerKeyPreserved": True,
    }
    value["regionalContentRecovery"] = report
    return value


def recover_envelope(
    envelope: dict[str, Any],
    entry: dict[str, Any],
    exam_bytes: bytes,
    answer_key_bytes: bytes,
) -> tuple[dict[str, Any], dict[str, Any]]:
    targets = validate_bound_envelope(envelope, entry, exam_bytes, answer_key_bytes)
    base_report = {
        "workerVersion": WORKER_VERSION,
        "attempted": False,
        "applied": False,
        "targetedQuestions": targets,
        "appliedQuestions": [],
        "unresolvedQuestions": targets,
        "attemptsByMode": {},
        "regions": [],
    }
    if not should_attempt_region_recovery(envelope, entry) or not targets:
        return envelope, base_report

    try:
        regions = discover_question_regions(exam_bytes, int(entry["total"]))
    except (RuntimeError, ValueError) as error:
        return envelope, {**base_report, "rejectedReason": str(error)}

    recovered, report = ocr_question_regions(exam_bytes, regions, targets)
    if not recovered:
        return envelope, report

    candidate = apply_recovered_questions(envelope, entry, recovered, report)
    before = BASE["metrics"](envelope)["structurallyComplete"]
    after = BASE["metrics"](candidate)["structurallyComplete"]
    if after <= before:
        return envelope, {
            **report,
            "applied": False,
            "appliedQuestions": [],
            "unresolvedQuestions": targets,
            "rejectedReason": "no-structural-improvement",
        }
    return candidate, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=TARGET_YEAR)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--metrics", action="store_true")
    args = parser.parse_args()

    manifest = BASE["load_manifest"]()
    try:
        entry, exam_bytes, key_bytes, pages = BASE["load_year_documents"](args.year, manifest)
        envelope = BASE["build_envelope"](entry, exam_bytes, key_bytes, pages)
        recovered, report = recover_envelope(envelope, entry, exam_bytes, key_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"FUVEST {args.year}: REGIONAL OCR BLOQUEADO — {error}", file=sys.stderr)
        return 1

    payload = json.dumps(recovered, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)
    if args.metrics:
        print(
            json.dumps(
                {**BASE["metrics"](recovered), "regionalRecovery": report},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
