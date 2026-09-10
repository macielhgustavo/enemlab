#!/usr/bin/env python3
"""Strict post-OCR structural rescue for FUVEST regional recovery.

This module wraps the already benchmarked regional worker. It adds one narrow
repair stage for OCR mistakes confined to alternative labels. It never changes
question identity or the canonical answer key, and every recovered question
remains semantic-review-gated.

A label repair is accepted only when exactly five separate option-start lines
are present, at least four of their recognized letters already agree positionally
with A-E, the statement is non-empty, and every option has non-empty content.
This deliberately rejects graphical/grid options whose OCR reading order is
A/D/B/E/C or where multiple option labels share a line.
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
import sys
import tempfile
from pathlib import Path
from typing import Any

V3 = runpy.run_path(
    str(Path(__file__).with_name("recover-fuvest-region-ocr.py")),
    run_name="fuvest_regional_ocr_v3_base",
)

# Re-export the stable public surface first; overrides below replace only the
# recovery orchestration that needs the new label-repair stage.
for _name, _value in V3.items():
    if not _name.startswith("__"):
        globals()[_name] = _value

BASE = V3["BASE"]
WORKER_NAME = V3["WORKER_NAME"]
WORKER_VERSION = "fuvest-regional-content-ocr@0.4.0"
OCR_MODES = tuple(V3["OCR_MODES"])
LETTERS = tuple(V3["LETTERS"])

_TOLERANT_PAREN = re.compile(r"^\s*\(([A-Ea-e])(?P<tail>.*)$")
_TOLERANT_BARE = re.compile(r"^\s*([A-Ea-e])(?:[\)\.\]\}Jj])\s*(?P<tail>.*)$")
_DELIMITER_NOISE = (")", "]", "}", "J", "j", "|", "I")


def _clean_first_text(raw: str) -> str:
    value = raw.lstrip()
    if value.startswith(_DELIMITER_NOISE):
        value = value[1:].lstrip()
    return value


def _tolerant_option_start(line: str) -> tuple[str, str] | None:
    standard = BASE["ALTERNATIVE_RE"].match(line)
    if standard:
        letter = (standard.group(1) or standard.group(2)).upper()
        return letter, standard.group(3).strip()

    match = _TOLERANT_PAREN.match(line)
    if match:
        return match.group(1).upper(), _clean_first_text(match.group("tail"))

    match = _TOLERANT_BARE.match(line)
    if match:
        return match.group(1).upper(), _clean_first_text(match.group("tail"))
    return None


def parse_ocr_candidate_with_label_repair(text: str, question_number: int) -> dict[str, Any]:
    original = V3["parse_ocr_candidate"](text, question_number)
    if original.get("complete"):
        return original

    lines = [line.strip() for line in text.replace("\r", "\n").splitlines() if line.strip()]
    if lines and re.fullmatch(r"0?\d{1,2}", lines[0]):
        lines = lines[1:]

    starts: list[tuple[int, str, str]] = []
    for index, line in enumerate(lines):
        candidate = _tolerant_option_start(line)
        if candidate is not None:
            starts.append((index, candidate[0], candidate[1]))

    # Exact-five is the main protection against image/grid layouts and prose
    # that happens to begin with parenthesized letters.
    if len(starts) != len(LETTERS):
        return original

    observed = [letter for _, letter, _ in starts]
    positional_matches = sum(
        observed[index] == LETTERS[index] for index in range(len(LETTERS))
    )
    if positional_matches < 4:
        return original

    statement = BASE["join_wrapped"](lines[: starts[0][0]])
    if not statement or sum(character.isalpha() for character in statement) < 8:
        return original

    alternatives: list[dict[str, str]] = []
    context_lines: list[str] = []
    for position, (start_index, _observed_letter, first_text) in enumerate(starts):
        end_index = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        tail = lines[start_index + 1 : end_index]
        if position == len(starts) - 1:
            tail, context_lines = BASE["split_final_choice_tail"](tail)
        option_text = BASE["join_wrapped"](([first_text] if first_text else []) + tail)
        if not option_text:
            return original
        alternatives.append({"id": LETTERS[position], "text": option_text})

    return {
        "number": question_number,
        "statement": statement,
        "alternatives": alternatives,
        "context": BASE["join_wrapped"](context_lines) or None,
        "complete": True,
        "markers": len(LETTERS),
        "alphaCharacters": sum(character.isalpha() for character in text),
        "needsMedia": BASE["media_reference"]("\n".join(lines)),
        "ocrTextSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "labelRepair": True,
        "labelRepairObserved": observed,
        "labelRepairPositionalMatches": positional_matches,
    }


def _label_repair_pass(
    pdf_bytes: bytes,
    regions: list[dict[str, Any]],
    target_numbers: list[int],
) -> tuple[dict[int, dict[str, Any]], dict[int, dict[str, Any]], dict[str, int], int]:
    language, unavailable_reason = V3["tesseract_language"]()
    if unavailable_reason:
        return {}, {}, {}, 0
    executable = shutil.which("tesseract")
    if executable is None or language is None:
        return {}, {}, {}, 0

    try:
        import pymupdf
    except ImportError:
        return {}, {}, {}, 0

    by_number = {int(region["number"]): region for region in regions}
    recovered: dict[int, dict[str, Any]] = {}
    reports: dict[int, dict[str, Any]] = {}
    attempts = collections.Counter()
    calls = 0
    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        with tempfile.TemporaryDirectory(prefix="enemlab-fuvest-label-repair-") as directory:
            root = Path(directory)
            for number in target_numbers:
                region = by_number.get(number)
                if not region:
                    continue
                primary = (region.get("segments") or [
                    {"page": region["page"], "column": region["column"], "bbox": region["bbox"]}
                ])[0]
                image = root / f"q{number:03d}.png"
                V3["_render_segment"](document, primary, image)

                best: dict[str, Any] | None = None
                best_mode: int | None = None
                for mode in OCR_MODES:
                    attempts[mode] += 1
                    calls += 1
                    text = V3["_run_tesseract"](executable, image, language, mode)
                    candidate = parse_ocr_candidate_with_label_repair(text, number)
                    if best is None or V3["candidate_score"](candidate) > V3["candidate_score"](best):
                        best = candidate
                        best_mode = mode
                    if candidate.get("complete") and candidate.get("labelRepair"):
                        best = candidate
                        best_mode = mode
                        break

                if best is None:
                    continue
                reports[number] = {
                    "labelRepairAttempted": True,
                    "labelRepairRecovered": bool(best.get("complete") and best.get("labelRepair")),
                    "labelRepairMode": best_mode,
                    "labelRepairObserved": list(best.get("labelRepairObserved", [])),
                    "labelRepairPositionalMatches": int(best.get("labelRepairPositionalMatches", 0)),
                    "labelRepairTextSha256": best.get("ocrTextSha256"),
                }
                if best.get("complete") and best.get("labelRepair"):
                    best["ocrMode"] = best_mode
                    best["page"] = int(region["page"])
                    recovered[number] = best
    finally:
        document.close()

    return recovered, reports, {str(k): v for k, v in sorted(attempts.items())}, calls


def ocr_question_regions(
    pdf_bytes: bytes,
    regions: list[dict[str, Any]],
    target_numbers: list[int],
) -> tuple[dict[int, dict[str, Any]], dict[str, Any]]:
    recovered, report = V3["ocr_question_regions"](pdf_bytes, regions, target_numbers)
    report = copy.deepcopy(report)
    report["workerVersion"] = WORKER_VERSION

    unresolved = [number for number in target_numbers if number not in recovered]
    if not unresolved:
        return recovered, report

    label_recovered, label_reports, label_attempts, label_calls = _label_repair_pass(
        pdf_bytes, regions, unresolved
    )
    recovered.update(label_recovered)
    unresolved = [number for number in target_numbers if number not in recovered]

    region_reports = copy.deepcopy(report.get("regions", []))
    by_report = {int(item.get("questionNumber", 0)): item for item in region_reports}
    for number, extension in label_reports.items():
        if number in by_report:
            by_report[number].update(extension)
        else:
            region_reports.append({"questionNumber": number, **copy.deepcopy(extension)})

    aggregate_attempts = collections.Counter(
        {int(mode): int(count) for mode, count in report.get("attemptsByMode", {}).items()}
    )
    aggregate_attempts.update({int(mode): int(count) for mode, count in label_attempts.items()})

    report["attempted"] = True
    report["applied"] = bool(recovered)
    report["appliedQuestions"] = sorted(recovered)
    report["unresolvedQuestions"] = unresolved
    report["regions"] = region_reports
    report["attemptsByMode"] = {str(k): v for k, v in sorted(aggregate_attempts.items())}
    report["labelRepairTargetedQuestions"] = [int(number) for number in label_reports]
    report["labelRepairAppliedQuestions"] = sorted(label_recovered)
    report["labelRepairUnresolvedQuestions"] = [
        number for number in label_reports if number not in label_recovered
    ]
    report["tesseractCalls"] = int(report.get("tesseractCalls", 0)) + label_calls
    return recovered, report


def apply_recovered_questions(
    envelope: dict[str, Any],
    entry: dict[str, Any],
    recovered: dict[int, dict[str, Any]],
    report: dict[str, Any],
) -> dict[str, Any]:
    value = V3["apply_recovered_questions"](envelope, entry, recovered, report)
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
    targets = V3["validate_bound_envelope"](envelope, entry, exam_bytes, answer_key_bytes)
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
    if not V3["should_attempt_region_recovery"](envelope, entry) or not targets:
        return envelope, base_report

    year = int(entry["year"])
    try:
        regions = V3["discover_question_regions"](exam_bytes, int(entry["total"]), year)
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
    parser.add_argument("--year", type=int, default=V3["DEFAULT_YEAR"])
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
        print(json.dumps({**BASE["metrics"](recovered), "regionalRecovery": report}, ensure_ascii=False), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
