#!/usr/bin/env python3
"""Regional OCR recovery with conservative cross-column continuation support.

The proven v0.2 worker remains the core implementation. This wrapper preserves
its already-benchmarked single-region behavior and adds one optional second pass:
when an unresolved question's primary crop reaches the bottom of a column and
the next reviewed question begins in the physically adjacent reading slot, OCR
may concatenate the bounded continuation before the next official label.

The continuation is never used to derive identity or answer keys, and recovered
content remains semantic-review-gated.
"""

from __future__ import annotations

import argparse
import collections
import copy
import json
import runpy
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

CORE = runpy.run_path(
    str(Path(__file__).with_name("recover-fuvest-region-ocr-core.py")),
    run_name="fuvest_regional_ocr_core",
)
BASE = CORE["BASE"]

WORKER_NAME = CORE["WORKER_NAME"]
WORKER_VERSION = "fuvest-regional-content-ocr@0.3.2"
DEFAULT_YEAR = CORE["DEFAULT_YEAR"]
OCR_MODES = tuple(CORE["OCR_MODES"])
LETTERS = tuple(CORE["LETTERS"])

sha256_bytes = CORE["sha256_bytes"]
layout_profile = CORE["layout_profile"]
label_matches_profile = CORE["label_matches_profile"]
structurally_complete = CORE["structurally_complete"]
should_attempt_region_recovery = CORE["should_attempt_region_recovery"]
validate_bound_envelope = CORE["validate_bound_envelope"]
parse_ocr_candidate = CORE["parse_ocr_candidate"]
candidate_score = CORE["candidate_score"]
select_best_candidate = CORE["select_best_candidate"]
validate_question_labels = CORE["validate_question_labels"]
tesseract_language = CORE["tesseract_language"]
crop_dimensions = CORE["crop_dimensions"]
structural_failure_reason = CORE["structural_failure_reason"]

CONTENT_TOP_PT = 32.0
CONTENT_BOTTOM_TRIGGER_PT = 795.0
CONTENT_BOTTOM_CAP_PT = 805.0
COLUMN_LEFT_MARGIN_PT = 28.0
COLUMN_GUTTER_PT = 5.0
QUESTION_END_PAD_PT = 3.0
MIN_CONTINUATION_HEIGHT_PT = 12.0


def _column_bounds(width: float, column: str) -> tuple[float, float]:
    midpoint = width / 2.0
    if column == "L":
        return COLUMN_LEFT_MARGIN_PT, midpoint - COLUMN_GUTTER_PT
    return midpoint + 4.0, width - COLUMN_LEFT_MARGIN_PT


def _make_continuation_segment(
    page_number: int,
    column: str,
    page_sizes: dict[int, tuple[float, float]],
    end_y: float,
) -> dict[str, Any] | None:
    if page_number not in page_sizes:
        return None
    width, height = page_sizes[page_number]
    x0, x1 = _column_bounds(width, column)
    y0 = CONTENT_TOP_PT
    y1 = min(float(end_y), height - 30.0, CONTENT_BOTTOM_CAP_PT)
    if x1 <= x0 or y1 - y0 < MIN_CONTINUATION_HEIGHT_PT:
        return None
    return {
        "page": int(page_number),
        "column": column,
        "bbox": [round(x0, 3), round(y0, 3), round(x1, 3), round(y1, 3)],
    }


def _add_conservative_continuations(
    regions: list[dict[str, Any]],
    page_sizes: dict[int, tuple[float, float]],
) -> list[dict[str, Any]]:
    enriched = [copy.deepcopy(region) for region in regions]
    for index, region in enumerate(enriched):
        primary = {
            "page": int(region["page"]),
            "column": str(region["column"]),
            "bbox": list(region["bbox"]),
        }
        region["segments"] = [primary]

        if float(region["bbox"][3]) < CONTENT_BOTTOM_TRIGGER_PT:
            continue

        current_page = int(region["page"])
        current_column = str(region["column"])
        next_region = enriched[index + 1] if index + 1 < len(enriched) else None

        continuation: dict[str, Any] | None = None
        if next_region is not None:
            next_page = int(next_region["page"])
            next_column = str(next_region["column"])
            next_start = float(next_region["bbox"][1]) - QUESTION_END_PAD_PT

            if current_column == "L" and next_page == current_page and next_column == "R":
                continuation = _make_continuation_segment(
                    current_page, "R", page_sizes, next_start
                )
            elif (
                current_column == "L"
                and next_page == current_page + 1
                and next_column == "L"
            ):
                # Some reviewed two-column pages finish a question in the left
                # column and reserve the entire right column for its continuation.
                # The next official identity therefore starts on the following
                # page. This is only an optional second OCR pass; primary geometry
                # remains untouched and incomplete output is still rejected.
                _, height = page_sizes[current_page]
                continuation = _make_continuation_segment(
                    current_page,
                    "R",
                    page_sizes,
                    min(height - 30.0, CONTENT_BOTTOM_CAP_PT),
                )
            elif current_column == "R" and next_page == current_page + 1 and next_column == "L":
                continuation = _make_continuation_segment(
                    next_page, "L", page_sizes, next_start
                )
        elif current_column == "L":
            _, height = page_sizes[current_page]
            continuation = _make_continuation_segment(
                current_page,
                "R",
                page_sizes,
                min(height - 30.0, CONTENT_BOTTOM_CAP_PT),
            )

        if continuation is not None:
            region["segments"].append(continuation)

    return enriched


def build_question_regions(
    labels: list[dict[str, Any]],
    page_sizes: dict[int, tuple[float, float]],
    expected_count: int,
) -> list[dict[str, Any]]:
    primary = CORE["build_question_regions"](labels, page_sizes, expected_count)
    return _add_conservative_continuations(primary, page_sizes)


def discover_question_regions(
    pdf_bytes: bytes, expected_count: int, year: int = DEFAULT_YEAR
) -> list[dict[str, Any]]:
    primary = CORE["discover_question_regions"](pdf_bytes, expected_count, year)

    try:
        import pymupdf
    except ImportError as error:  # pragma: no cover
        raise RuntimeError("PyMuPDF is required for regional OCR geometry") from error

    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_sizes = {
            page_index + 1: (
                float(document.load_page(page_index).rect.width),
                float(document.load_page(page_index).rect.height),
            )
            for page_index in range(document.page_count)
        }
    finally:
        document.close()
    return _add_conservative_continuations(primary, page_sizes)


def _run_tesseract(
    executable: str,
    image_path: Path,
    language: str,
    mode: int,
) -> str:
    output = subprocess.run(
        [executable, str(image_path), "stdout", "-l", language, "--psm", str(mode)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    ).stdout
    return "\n".join(line.rstrip() for line in output.splitlines() if line.strip())


def _render_segment(
    document: Any,
    segment: dict[str, Any],
    destination: Path,
    *,
    scale: float = 3.0,
) -> None:
    import pymupdf

    page = document.load_page(int(segment["page"]) - 1)
    x0, y0, x1, y1 = [float(value) for value in segment["bbox"]]
    pixmap = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale),
        clip=pymupdf.Rect(x0, y0, x1, y1),
        alpha=False,
    )
    destination.write_bytes(pixmap.tobytes("png"))


def _continuation_pass(
    pdf_bytes: bytes,
    regions: list[dict[str, Any]],
    target_numbers: list[int],
) -> tuple[dict[int, dict[str, Any]], dict[int, dict[str, Any]], dict[str, int], int]:
    language, unavailable_reason = tesseract_language()
    if unavailable_reason:
        return {}, {}, {}, 0

    try:
        import pymupdf
    except ImportError:
        return {}, {}, {}, 0

    executable = shutil.which("tesseract")
    if executable is None or language is None:
        return {}, {}, {}, 0

    by_number = {int(region["number"]): region for region in regions}
    recovered: dict[int, dict[str, Any]] = {}
    reports: dict[int, dict[str, Any]] = {}
    attempts_by_mode: collections.Counter[int] = collections.Counter()
    calls = 0
    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")

    try:
        with tempfile.TemporaryDirectory(prefix="enemlab-fuvest-region-cont-") as directory:
            temporary = Path(directory)

            for number in target_numbers:
                region = by_number.get(number)
                segments = region.get("segments", []) if region else []
                if not region or len(segments) < 2:
                    continue

                image_paths: list[Path] = []
                for segment_index, segment in enumerate(segments):
                    path = temporary / f"q{number:03d}-s{segment_index:02d}.png"
                    _render_segment(document, segment, path)
                    image_paths.append(path)

                best: dict[str, Any] | None = None
                best_mode: int | None = None
                for mode in OCR_MODES:
                    attempts_by_mode[mode] += 1
                    parts: list[str] = []
                    for image_path in image_paths:
                        calls += 1
                        text = _run_tesseract(executable, image_path, language, mode)
                        if text:
                            parts.append(text)
                    combined = "\n".join(parts)
                    candidate = parse_ocr_candidate(combined, number)
                    if best is None or candidate_score(candidate) > candidate_score(best):
                        best = candidate
                        best_mode = mode
                    if candidate["complete"]:
                        best = candidate
                        best_mode = mode
                        break

                if best is None:
                    continue

                reports[number] = {
                    "continuationAttempted": True,
                    "continuationRecovered": bool(best["complete"]),
                    "continuationMode": best_mode,
                    "segmentCount": len(segments),
                    "segments": copy.deepcopy(segments),
                    "continuationMarkerCount": int(best.get("markers", 0)),
                    "continuationDetectedLetters": list(best.get("detectedLetters", [])),
                    "continuationAlphaCharacters": int(best.get("alphaCharacters", 0)),
                    "continuationTextSha256": best["ocrTextSha256"],
                    "continuationBestScore": list(candidate_score(best)),
                    "continuationStructuralFailureReason": structural_failure_reason(best),
                    "continuationCropDimensions": crop_dimensions(segments, 3.0),
                }
                if best["complete"]:
                    best["ocrMode"] = best_mode
                    best["page"] = int(region["page"])
                    recovered[number] = best
    finally:
        document.close()

    return (
        recovered,
        reports,
        {str(mode): count for mode, count in sorted(attempts_by_mode.items())},
        calls,
    )


def ocr_question_regions(
    pdf_bytes: bytes,
    regions: list[dict[str, Any]],
    target_numbers: list[int],
) -> tuple[dict[int, dict[str, Any]], dict[str, Any]]:
    recovered, report = CORE["ocr_question_regions"](pdf_bytes, regions, target_numbers)
    report = copy.deepcopy(report)
    report["workerVersion"] = WORKER_VERSION

    unresolved = [
        int(number)
        for number in report.get("unresolvedQuestions", [])
        if int(number) not in recovered
    ]
    by_number = {int(region["number"]): region for region in regions}
    continuation_targets = [
        number
        for number in unresolved
        if len(by_number.get(number, {}).get("segments", [])) > 1
    ]

    if not continuation_targets:
        return recovered, report

    (
        continuation_recovered,
        continuation_reports,
        continuation_attempts,
        continuation_calls,
    ) = _continuation_pass(pdf_bytes, regions, continuation_targets)

    recovered.update(continuation_recovered)
    unresolved = [number for number in target_numbers if number not in recovered]

    base_attempts = collections.Counter(
        {int(mode): int(count) for mode, count in report.get("attemptsByMode", {}).items()}
    )
    base_attempts.update(
        {int(mode): int(count) for mode, count in continuation_attempts.items()}
    )

    region_reports = copy.deepcopy(report.get("regions", []))
    by_report = {int(item.get("questionNumber", 0)): item for item in region_reports}
    for number, extension in continuation_reports.items():
        if number in by_report:
            current = by_report[number]
            current.update(extension)
            if tuple(extension.get("continuationBestScore", ())) > tuple(
                current.get("bestScore", ())
            ):
                current.update(
                    {
                        "selectedMode": extension.get("continuationMode"),
                        "structurallyComplete": bool(
                            extension.get("continuationRecovered")
                        ),
                        "ocrTextSha256": extension.get("continuationTextSha256"),
                        "markerCount": int(
                            extension.get("continuationMarkerCount", 0)
                        ),
                        "detectedLetters": list(
                            extension.get("continuationDetectedLetters", [])
                        ),
                        "alphaCharacters": int(
                            extension.get("continuationAlphaCharacters", 0)
                        ),
                        "segmentCount": int(extension.get("segmentCount", 1)),
                        "continuationUsed": True,
                        "cropDimensions": copy.deepcopy(
                            extension.get("continuationCropDimensions")
                        ),
                        "bestScore": list(
                            extension.get("continuationBestScore", [])
                        ),
                        "structuralFailureReason": extension.get(
                            "continuationStructuralFailureReason"
                        ),
                    }
                )
        else:
            region_reports.append({"questionNumber": number, **copy.deepcopy(extension)})

    report["attempted"] = True
    report["applied"] = bool(recovered)
    report["appliedQuestions"] = sorted(recovered)
    report["unresolvedQuestions"] = unresolved
    report["attemptsByMode"] = {
        str(mode): count for mode, count in sorted(base_attempts.items())
    }
    report["regions"] = region_reports
    report["continuationTargetedQuestions"] = continuation_targets
    report["continuationAppliedQuestions"] = sorted(continuation_recovered)
    report["continuationUnresolvedQuestions"] = [
        number for number in continuation_targets if number not in continuation_recovered
    ]
    report["tesseractCalls"] = int(report.get("tesseractCalls", 0)) + continuation_calls
    return recovered, report


def apply_recovered_questions(
    envelope: dict[str, Any],
    entry: dict[str, Any],
    recovered: dict[int, dict[str, Any]],
    report: dict[str, Any],
) -> dict[str, Any]:
    value = CORE["apply_recovered_questions"](envelope, entry, recovered, report)
    if value is envelope or not recovered:
        return value
    value["extractor"] = {"name": WORKER_NAME, "version": WORKER_VERSION}
    if isinstance(value.get("recovery"), dict):
        value["recovery"]["workerVersion"] = WORKER_VERSION
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

    recovered, report = ocr_question_regions(pdf_bytes=exam_bytes, regions=regions, target_numbers=targets)
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
