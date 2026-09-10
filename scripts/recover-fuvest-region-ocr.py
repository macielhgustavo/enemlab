#!/usr/bin/env python3
"""Recupera conteúdo textual por OCR local em regiões de questão da FUVEST.

Este worker existe para PDFs cuja identidade das questões continua legível, mas a
camada textual do corpo está semanticamente corrompida ou estruturalmente
incompleta. Os layouts suportados são explicitamente versionados e só entram no
fallback quando os rótulos oficiais fecham exatamente a sequência 1..N.

Regras de segurança do pipeline:

- a identidade da questão vem da geometria do PDF, nunca do OCR;
- a sequência geométrica deve fechar exatamente 1..N antes de qualquer troca;
- somente questões já estruturalmente incompletas são alvo;
- somente um OCR que recupere enunciado + alternativas A-E completas substitui
  o texto corrompido; resultado parcial permanece bloqueado;
- questões que atravessam coluna/página podem usar segmentos geométricos
  consecutivos, mas esses segmentos são delimitados pelos rótulos oficiais;
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
WORKER_VERSION = "fuvest-regional-content-ocr@0.3.0"
DEFAULT_YEAR = 2021
OCR_MODES = (6, 4, 3, 11)
LETTERS = ("A", "B", "C", "D", "E")
CONTENT_TOP_PT = 32.0
CONTENT_BOTTOM_CAP_PT = 805.0
COLUMN_LEFT_MARGIN_PT = 28.0
COLUMN_GUTTER_PT = 5.0
QUESTION_END_PAD_PT = 3.0
MIN_SEGMENT_HEIGHT_PT = 12.0

LAYOUT_PROFILES: dict[int, dict[str, Any]] = {
    2016: {
        "labelFontTokens": ("Calibri-Bold",),
        "labelPattern": r"\d{1,2}",
        "labelXBands": ((48.0, 68.0), (308.0, 330.0)),
    },
    2017: {
        "labelFontTokens": ("Calibri-Bold",),
        "labelPattern": r"\d{1,2}",
        "labelXBands": ((48.0, 68.0), (308.0, 330.0)),
    },
    2021: {
        "labelFontTokens": ("SegoeUIBlack",),
        "labelPattern": r"\d{2}",
        "labelXBands": None,
    },
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def layout_profile(year: int) -> dict[str, Any] | None:
    return LAYOUT_PROFILES.get(int(year))


def label_matches_profile(
    text: str,
    fonts: set[str],
    x0: float,
    profile: dict[str, Any],
) -> bool:
    if not re.fullmatch(str(profile["labelPattern"]), text):
        return False
    tokens = tuple(str(token) for token in profile["labelFontTokens"])
    if not any(any(token in font for token in tokens) for font in fonts):
        return False
    bands = profile.get("labelXBands")
    if bands is not None and not any(
        float(start) <= x0 <= float(end) for start, end in bands
    ):
        return False
    return True


def structurally_complete(question: dict[str, Any]) -> bool:
    alternatives = question.get("alternatives")
    return bool(question.get("statement")) and isinstance(alternatives, list) and [
        alternative.get("id") for alternative in alternatives
    ] == list(LETTERS) and all(alternative.get("text") for alternative in alternatives)


def should_attempt_region_recovery(
    envelope: dict[str, Any], entry: dict[str, Any]
) -> bool:
    year = int(entry.get("year", 0))
    if layout_profile(year) is None:
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
    lines = [
        line.strip()
        for line in text.replace("\r", "\n").splitlines()
        if line.strip()
    ]
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
    if len(
        {(int(item["page"]), int(item["number"])) for item in ordered}
    ) != expected_count:
        raise ValueError("duplicate question label geometry")
    return ordered


def column_for_x(x0: float, width: float) -> str:
    return "L" if x0 < width / 2.0 else "R"


def slot_index(page: int, column: str) -> int:
    return (int(page) - 1) * 2 + (0 if column == "L" else 1)


def slot_from_index(index: int) -> tuple[int, str]:
    return index // 2 + 1, "L" if index % 2 == 0 else "R"


def segment_bbox(
    page_number: int,
    column: str,
    page_sizes: dict[int, tuple[float, float]],
    y0: float,
    y1: float,
) -> dict[str, Any] | None:
    if page_number not in page_sizes:
        raise ValueError("question continuation references an unknown PDF page")
    width, height = page_sizes[page_number]
    midpoint = width / 2.0
    x0 = COLUMN_LEFT_MARGIN_PT if column == "L" else midpoint + 4.0
    x1 = midpoint - COLUMN_GUTTER_PT if column == "L" else width - COLUMN_LEFT_MARGIN_PT
    top = max(CONTENT_TOP_PT, float(y0))
    bottom = min(height - 30.0, CONTENT_BOTTOM_CAP_PT, float(y1))
    if x1 <= x0 or bottom - top < MIN_SEGMENT_HEIGHT_PT:
        return None
    return {
        "page": int(page_number),
        "column": column,
        "bbox": [round(x0, 3), round(top, 3), round(x1, 3), round(bottom, 3)],
    }


def build_question_regions(
    labels: list[dict[str, Any]],
    page_sizes: dict[int, tuple[float, float]],
    expected_count: int,
) -> list[dict[str, Any]]:
    ordered = validate_question_labels(labels, expected_count)
    prepared: list[dict[str, Any]] = []

    for source in ordered:
        item = dict(source)
        page_number = int(item["page"])
        if page_number not in page_sizes:
            raise ValueError("question label references an unknown PDF page")
        width, _ = page_sizes[page_number]
        item["column"] = column_for_x(float(item["x0"]), width)
        item["slot"] = slot_index(page_number, item["column"])
        prepared.append(item)

    for index, item in enumerate(prepared):
        if index == 0:
            continue
        previous = prepared[index - 1]
        if int(item["slot"]) < int(previous["slot"]):
            raise ValueError("question labels do not follow page/column reading order")
        if (
            int(item["slot"]) == int(previous["slot"])
            and float(item["y0"]) <= float(previous["y0"])
        ):
            raise ValueError("question labels do not follow vertical reading order")

    regions: list[dict[str, Any]] = []
    for index, item in enumerate(prepared):
        page_number = int(item["page"])
        column = str(item["column"])
        current_slot = int(item["slot"])
        next_item = prepared[index + 1] if index + 1 < len(prepared) else None
        next_slot = int(next_item["slot"]) if next_item is not None else None
        _, page_height = page_sizes[page_number]

        if next_item is not None and next_slot == current_slot:
            primary_y1 = float(next_item["y0"]) - QUESTION_END_PAD_PT
        else:
            primary_y1 = min(page_height - 30.0, CONTENT_BOTTOM_CAP_PT)

        primary = segment_bbox(
            page_number,
            column,
            page_sizes,
            max(CONTENT_TOP_PT, float(item["y0"]) - 4.0),
            primary_y1,
        )
        if primary is None:
            raise ValueError("invalid regional OCR crop geometry")

        segments = [primary]

        if next_item is not None and next_slot is not None and next_slot > current_slot:
            for continuation_slot in range(current_slot + 1, next_slot + 1):
                continuation_page, continuation_column = slot_from_index(continuation_slot)
                if continuation_slot == next_slot:
                    continuation_y1 = float(next_item["y0"]) - QUESTION_END_PAD_PT
                else:
                    _, continuation_height = page_sizes.get(
                        continuation_page, (0.0, 0.0)
                    )
                    continuation_y1 = min(
                        continuation_height - 30.0, CONTENT_BOTTOM_CAP_PT
                    )
                continuation = segment_bbox(
                    continuation_page,
                    continuation_column,
                    page_sizes,
                    CONTENT_TOP_PT,
                    continuation_y1,
                )
                if continuation is not None:
                    segments.append(continuation)
        elif next_item is None and column == "L":
            continuation = segment_bbox(
                page_number,
                "R",
                page_sizes,
                CONTENT_TOP_PT,
                min(page_height - 30.0, CONTENT_BOTTOM_CAP_PT),
            )
            if continuation is not None:
                segments.append(continuation)

        regions.append(
            {
                "number": int(item["number"]),
                "page": page_number,
                "column": column,
                "bbox": list(primary["bbox"]),
                "segments": segments,
            }
        )

    return regions


def discover_question_regions(
    pdf_bytes: bytes, expected_count: int, year: int = DEFAULT_YEAR
) -> list[dict[str, Any]]:
    profile = layout_profile(year)
    if profile is None:
        raise ValueError(f"regional OCR layout unsupported for FUVEST {year}")

    try:
        import pymupdf
    except ImportError as error:  # pragma: no cover
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
                if not bbox:
                    continue
                fonts = {str(span.get("font", "")) for span in spans}
                x0, y0, x1, y1 = map(float, bbox)
                if not label_matches_profile(text, fonts, x0, profile):
                    continue
                number = int(text)
                if number < 1 or number > expected_count:
                    continue
                labels.append(
                    {
                        "number": number,
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


def render_region_segments(
    document: Any,
    region: dict[str, Any],
    temporary: Path,
    number: int,
    *,
    scale: float = 3.0,
) -> list[Path]:
    import pymupdf

    raw_segments = region.get("segments")
    segments = raw_segments if isinstance(raw_segments, list) and raw_segments else [
        {"page": region["page"], "column": region["column"], "bbox": region["bbox"]}
    ]
    paths: list[Path] = []
    for segment_index, segment in enumerate(segments):
        page = document.load_page(int(segment["page"]) - 1)
        x0, y0, x1, y1 = [float(value) for value in segment["bbox"]]
        pixmap = page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),
            clip=pymupdf.Rect(x0, y0, x1, y1),
            alpha=False,
        )
        path = temporary / f"q{number:03d}-s{segment_index:02d}.png"
        path.write_bytes(pixmap.tobytes("png"))
        paths.append(path)
    return paths


def run_tesseract(
    executable: str,
    image_path: Path,
    language: str,
    mode: int,
) -> str:
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
    return "\n".join(line.rstrip() for line in text.splitlines() if line.strip())


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
    tesseract_calls = 0
    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    executable = shutil.which("tesseract")
    assert executable is not None and language is not None

    with tempfile.TemporaryDirectory(prefix="enemlab-fuvest-region-") as directory:
        temporary = Path(directory)
        for number in target_numbers:
            region = by_number[number]
            image_paths = render_region_segments(document, region, temporary, number)

            attempts: list[tuple[int, str]] = []
            attempt_variants: list[dict[str, Any]] = []
            selected_mode: int | None = None
            selected: dict[str, Any] | None = None
            selected_used_continuation = False
            for mode in OCR_MODES:
                attempts_by_mode[mode] += 1

                tesseract_calls += 1
                primary_text = run_tesseract(
                    executable, image_paths[0], language, mode
                )
                attempts.append((mode, primary_text))
                primary_candidate = parse_ocr_candidate(primary_text, number)
                attempt_variants.append(
                    {
                        "mode": mode,
                        "usedContinuation": False,
                        "candidate": primary_candidate,
                    }
                )
                if primary_candidate["complete"]:
                    selected_mode = mode
                    selected = primary_candidate
                    break

                if len(image_paths) > 1:
                    parts = [primary_text] if primary_text else []
                    for image_path in image_paths[1:]:
                        tesseract_calls += 1
                        part = run_tesseract(
                            executable, image_path, language, mode
                        )
                        if part:
                            parts.append(part)
                    combined_text = "\n".join(parts)
                    attempts.append((mode, combined_text))
                    combined_candidate = parse_ocr_candidate(
                        combined_text, number
                    )
                    attempt_variants.append(
                        {
                            "mode": mode,
                            "usedContinuation": True,
                            "candidate": combined_candidate,
                        }
                    )
                    if combined_candidate["complete"]:
                        selected_mode = mode
                        selected = combined_candidate
                        selected_used_continuation = True
                        break

            if selected is None:
                best = max(
                    attempt_variants,
                    key=lambda item: candidate_score(item["candidate"]),
                )
                selected_mode = int(best["mode"])
                selected = best["candidate"]
                selected_used_continuation = bool(best["usedContinuation"])
            selected["ocrMode"] = selected_mode
            segments = region.get("segments") or [
                {"page": region["page"], "column": region["column"], "bbox": region["bbox"]}
            ]
            region_reports.append(
                {
                    "questionNumber": number,
                    "page": int(region["page"]),
                    "column": region["column"],
                    "bbox": list(region["bbox"]),
                    "segments": copy.deepcopy(segments),
                    "segmentCount": len(segments),
                    "selectedMode": selected_mode,
                    "usedContinuation": selected_used_continuation,
                    "structurallyComplete": bool(selected["complete"]),
                    "markerCount": int(selected.get("markers", 0)),
                    "alphaCharacters": int(selected.get("alphaCharacters", 0)),
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
        "attemptsByMode": {
            str(mode): count for mode, count in sorted(attempts_by_mode.items())
        },
        "regions": region_reports,
        "language": language,
        "renderScale": 3,
        "tesseractCalls": tesseract_calls,
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

    missing_media = {
        int(number) for number in extraction.get("questionsMissingMedia", [])
    }
    missing_media.update(
        number for number, candidate in recovered.items() if candidate.get("needsMedia")
    )
    extraction["questionsMissingMedia"] = sorted(missing_media)

    warnings = [
        warning
        for warning in extraction.get("warnings", [])
        if not any(
            warning.startswith(f"questão {number}:") for number in applied_numbers
        )
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

    year = int(entry["year"])
    try:
        regions = discover_question_regions(exam_bytes, int(entry["total"]), year)
    except (RuntimeError, ValueError) as error:
        return envelope, {**base_report, "rejectedReason": str(error)}

    recovered, report = ocr_question_regions(exam_bytes, regions, targets)
    report["layoutYear"] = year
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
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--metrics", action="store_true")
    args = parser.parse_args()

    manifest = BASE["load_manifest"]()
    try:
        entry, exam_bytes, key_bytes, pages = BASE["load_year_documents"](
            args.year, manifest
        )
        envelope = BASE["build_envelope"](entry, exam_bytes, key_bytes, pages)
        recovered, report = recover_envelope(
            envelope, entry, exam_bytes, key_bytes
        )
    except Exception as error:  # noqa: BLE001
        print(
            f"FUVEST {args.year}: REGIONAL OCR BLOQUEADO — {error}",
            file=sys.stderr,
        )
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
