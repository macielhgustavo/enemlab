#!/usr/bin/env python3
"""Recover graphical FUVEST alternatives as provenance-bound image crops.

This worker is deliberately narrower than OCR text recovery. It is for questions
whose statement identity is already known but whose A-E options are primarily
visual (graphs, diagrams, structural formulae, vectors, etc.). It never invents
option text. Instead it detects an unambiguous A-E label geometry and writes one
image crop per alternative.

Safety properties:
- question identity comes from the reviewed regional geometry, not OCR;
- document identity and answer key remain SHA-bound and canonical;
- exactly one unambiguous A-E layout must be proven before any crop is applied;
- accepted layouts are only vertical A-E, one-row A-E, or the common two-column
  A/B/C + D/E grid;
- each generated file records SHA-256, source page and PDF-space bounding box;
- recovered questions remain missing-media + semantic-review gated;
- no crop is treated as publication-ready merely because structure closes.
"""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import itertools
import json
import re
import runpy
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

REGIONAL = runpy.run_path(
    str(Path(__file__).with_name("recover-fuvest-region-ocr.py")),
    run_name="fuvest_visual_alternatives_regional",
)
BASE = REGIONAL["BASE"]

WORKER_NAME = "fuvest-visual-alternatives"
WORKER_VERSION = "fuvest-visual-alternatives@0.1.0"
LETTERS = tuple("ABCDE")
RENDER_SCALE = 3.0
MIN_LABEL_CONFIDENCE = 85.0
MIN_LABEL_HEIGHT = 22
MAX_LABEL_WIDTH = 50
LABEL_RE = re.compile(r"^[\(\[\{]?([A-Ea-e])[\)\]\}\.]?$")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _label_center(label: dict[str, Any]) -> tuple[float, float]:
    return (
        float(label["x"]) + float(label["w"]) / 2.0,
        float(label["y"]) + float(label["h"]) / 2.0,
    )


def _label_x(label: dict[str, Any]) -> float:
    return _label_center(label)[0]


def _label_y(label: dict[str, Any]) -> float:
    return _label_center(label)[1]


def parse_tsv_labels(tsv: str) -> list[dict[str, Any]]:
    labels: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(tsv), delimiter="\t"):
        token = str(row.get("text") or "").strip()
        match = LABEL_RE.fullmatch(token)
        if not match:
            continue
        try:
            confidence = float(row.get("conf") or -1)
            x = int(row.get("left") or 0)
            y = int(row.get("top") or 0)
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
        except (TypeError, ValueError):
            continue
        if confidence < MIN_LABEL_CONFIDENCE:
            continue
        if height < MIN_LABEL_HEIGHT or width <= 0 or width > MAX_LABEL_WIDTH:
            continue
        labels.append(
            {
                "letter": match.group(1).upper(),
                "x": x,
                "y": y,
                "w": width,
                "h": height,
                "confidence": confidence,
            }
        )
    return labels


def _gap_is_reasonable(values: list[float], minimum: float = 70.0, maximum: float = 520.0) -> bool:
    if not values or any(value < minimum or value > maximum for value in values):
        return False
    low = min(values)
    high = max(values)
    return low > 0 and high / low <= 2.5


def classify_layout(selection: dict[str, dict[str, Any]]) -> str | None:
    xs = {letter: _label_x(selection[letter]) for letter in LETTERS}
    ys = {letter: _label_y(selection[letter]) for letter in LETTERS}

    # One vertical stack, A -> B -> C -> D -> E.
    if max(xs.values()) - min(xs.values()) <= 55.0:
        ordered_y = [ys[letter] for letter in LETTERS]
        if ordered_y == sorted(ordered_y) and _gap_is_reasonable(
            [ordered_y[index + 1] - ordered_y[index] for index in range(4)]
        ):
            return "vertical"

    # Standard FUVEST visual grid: A/B/C at left, D/E at right.
    left = [selection[letter] for letter in "ABC"]
    right = [selection[letter] for letter in "DE"]
    left_x = [_label_x(item) for item in left]
    right_x = [_label_x(item) for item in right]
    if (
        max(left_x) - min(left_x) <= 55.0
        and max(right_x) - min(right_x) <= 55.0
        and statistics.mean(right_x) - statistics.mean(left_x) >= 150.0
        and abs(ys["A"] - ys["D"]) <= 65.0
        and abs(ys["B"] - ys["E"]) <= 65.0
        and ys["A"] < ys["B"] < ys["C"]
        and _gap_is_reasonable([ys["B"] - ys["A"], ys["C"] - ys["B"]])
    ):
        return "two-column-grid"

    # Five visual choices on one horizontal row.
    ordered_x = [xs[letter] for letter in LETTERS]
    if max(ys.values()) - min(ys.values()) <= 65.0:
        if ordered_x == sorted(ordered_x) and _gap_is_reasonable(
            [ordered_x[index + 1] - ordered_x[index] for index in range(4)],
            minimum=45.0,
            maximum=300.0,
        ):
            return "one-row"
    return None


def select_unique_layout(labels: list[dict[str, Any]]) -> dict[str, Any] | None:
    by_letter = {
        letter: [label for label in labels if label.get("letter") == letter]
        for letter in LETTERS
    }
    if any(not by_letter[letter] for letter in LETTERS):
        return None

    valid: list[dict[str, Any]] = []
    for choices in itertools.product(*(by_letter[letter] for letter in LETTERS)):
        selection = {letter: choice for letter, choice in zip(LETTERS, choices)}
        layout = classify_layout(selection)
        if layout:
            valid.append({"layout": layout, "labels": selection})
            if len(valid) > 1:
                # More than one geometrically valid interpretation is ambiguous.
                return None
    return valid[0] if len(valid) == 1 else None


def _median_positive_gap(values: list[float], fallback: float) -> float:
    positive = [value for value in values if value > 0]
    return float(statistics.median(positive)) if positive else fallback


def alternative_boxes(
    image_width: int,
    image_height: int,
    layout: dict[str, Any],
) -> dict[str, tuple[int, int, int, int]]:
    labels: dict[str, dict[str, Any]] = layout["labels"]
    kind = str(layout["layout"])
    margin = 10
    result: dict[str, tuple[int, int, int, int]] = {}

    if kind == "vertical":
        ys = [_label_y(labels[letter]) for letter in LETTERS]
        step = _median_positive_gap([ys[i + 1] - ys[i] for i in range(4)], 180.0)
        x0 = max(0, int(min(float(labels[letter]["x"]) for letter in LETTERS)) - 25)
        for index, letter in enumerate(LETTERS):
            top = max(0, int(float(labels[letter]["y"])) - margin)
            if index + 1 < len(LETTERS):
                bottom = max(top + 40, int(float(labels[LETTERS[index + 1]]["y"])) - margin)
            else:
                bottom = min(image_height, int(top + step))
            result[letter] = (x0, top, image_width, bottom)

    elif kind == "two-column-grid":
        split = image_width // 2
        left_letters = "ABC"
        right_letters = "DE"
        left_y = [_label_y(labels[letter]) for letter in left_letters]
        left_step = _median_positive_gap(
            [left_y[index + 1] - left_y[index] for index in range(2)], 220.0
        )
        right_y = [_label_y(labels[letter]) for letter in right_letters]
        right_step = _median_positive_gap([right_y[1] - right_y[0]], left_step)
        for column_letters, x0, x1, step in (
            (left_letters, 0, split, left_step),
            (right_letters, split, image_width, right_step),
        ):
            for index, letter in enumerate(column_letters):
                top = max(0, int(float(labels[letter]["y"])) - margin)
                if index + 1 < len(column_letters):
                    bottom = max(
                        top + 40,
                        int(float(labels[column_letters[index + 1]]["y"])) - margin,
                    )
                else:
                    bottom = min(image_height, int(top + step))
                result[letter] = (x0, top, x1, bottom)

    elif kind == "one-row":
        xs = [_label_x(labels[letter]) for letter in LETTERS]
        boundaries = [0]
        boundaries.extend(int((xs[index] + xs[index + 1]) / 2.0) for index in range(4))
        boundaries.append(image_width)
        top = max(0, int(min(float(labels[letter]["y"]) for letter in LETTERS)) - margin)
        for index, letter in enumerate(LETTERS):
            result[letter] = (boundaries[index], top, boundaries[index + 1], image_height)
    else:
        raise ValueError(f"unsupported visual alternative layout {kind}")

    if set(result) != set(LETTERS):
        raise ValueError("visual alternative boxes did not close exactly at A-E")
    for letter, (x0, y0, x1, y1) in result.items():
        if x1 - x0 < 35 or y1 - y0 < 35:
            raise ValueError(f"visual alternative {letter} crop is too small")
    return result


def _render_primary(document: Any, region: dict[str, Any], path: Path) -> dict[str, Any]:
    primary = (region.get("segments") or [
        {"page": region["page"], "column": region["column"], "bbox": region["bbox"]}
    ])[0]
    REGIONAL["_render_segment"](document, primary, path)
    return primary


def _run_tsv(executable: str, image_path: Path, language: str) -> str:
    return subprocess.run(
        [executable, str(image_path), "stdout", "-l", language, "--psm", "11", "tsv"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    ).stdout


def _pdf_bbox(primary: dict[str, Any], box: tuple[int, int, int, int]) -> list[float]:
    px0, py0, px1, py1 = box
    bx0, by0, _, _ = [float(value) for value in primary["bbox"]]
    return [
        round(bx0 + px0 / RENDER_SCALE, 3),
        round(by0 + py0 / RENDER_SCALE, 3),
        round(bx0 + px1 / RENDER_SCALE, 3),
        round(by0 + py1 / RENDER_SCALE, 3),
    ]


def recover_visual_alternatives(
    envelope: dict[str, Any],
    entry: dict[str, Any],
    exam_bytes: bytes,
    answer_key_bytes: bytes,
    output_dir: Path,
    public_prefix: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    targets = REGIONAL["validate_bound_envelope"](
        envelope, entry, exam_bytes, answer_key_bytes
    )
    report: dict[str, Any] = {
        "workerVersion": WORKER_VERSION,
        "attempted": False,
        "applied": False,
        "targetedQuestions": targets,
        "appliedQuestions": [],
        "unresolvedQuestions": targets,
        "assets": [],
    }
    if not targets or REGIONAL["layout_profile"](int(entry["year"])) is None:
        return envelope, report

    language, unavailable = REGIONAL["tesseract_language"]()
    executable = shutil.which("tesseract")
    if unavailable or not executable or not language:
        report["rejectedReason"] = unavailable or "tesseract-not-installed"
        return envelope, report

    try:
        import pymupdf
        from PIL import Image, ImageStat
    except ImportError as error:
        report["rejectedReason"] = f"visual-dependency-unavailable:{error.name}"
        return envelope, report

    regions = REGIONAL["discover_question_regions"](
        exam_bytes, int(entry["total"]), int(entry["year"])
    )
    by_region = {int(region["number"]): region for region in regions}
    by_question = {
        int(question["number"]): question
        for question in envelope.get("extraction", {}).get("questions", [])
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    recovered: dict[int, list[dict[str, str]]] = {}
    assets: list[dict[str, Any]] = []
    document = pymupdf.open(stream=exam_bytes, filetype="pdf")
    report["attempted"] = True

    try:
        with tempfile.TemporaryDirectory(prefix="enemlab-fuvest-visual-alt-") as directory:
            temporary = Path(directory)
            for number in targets:
                question = by_question.get(number)
                region = by_region.get(number)
                if not question or not region or not str(question.get("statement") or "").strip():
                    continue

                full_image_path = temporary / f"q{number:03d}.png"
                primary = _render_primary(document, region, full_image_path)
                labels = parse_tsv_labels(_run_tsv(executable, full_image_path, language))
                layout = select_unique_layout(labels)
                if layout is None:
                    continue

                image = Image.open(full_image_path).convert("RGB")
                boxes = alternative_boxes(image.width, image.height, layout)
                question_alternatives: list[dict[str, str]] = []
                question_assets: list[dict[str, Any]] = []
                valid = True
                for letter in LETTERS:
                    box = boxes[letter]
                    crop = image.crop(box)
                    stats = ImageStat.Stat(crop.convert("L"))
                    if not stats.extrema or stats.extrema[0][0] >= 248:
                        valid = False
                        break
                    filename = f"q{number:03d}-alt-{letter}.png"
                    path = output_dir / filename
                    crop.save(path, format="PNG", optimize=True)
                    png = path.read_bytes()
                    public_path = f"{public_prefix.rstrip('/')}/{filename}"
                    pdf_bbox = _pdf_bbox(primary, box)
                    question_alternatives.append({"id": letter, "file": public_path})
                    question_assets.append(
                        {
                            "questionNumber": number,
                            "alternativeId": letter,
                            "path": public_path,
                            "sha256": sha256_bytes(png),
                            "mimeType": "image/png",
                            "sourceDocumentUrl": entry["examUrl"],
                            "page": int(primary["page"]),
                            "bbox": pdf_bbox,
                            "layout": layout["layout"],
                        }
                    )
                if not valid:
                    for asset in question_assets:
                        generated = output_dir / Path(str(asset["path"])).name
                        if generated.exists():
                            generated.unlink()
                    continue
                recovered[number] = question_alternatives
                assets.extend(question_assets)
    finally:
        document.close()

    if not recovered:
        report["assets"] = []
        return envelope, report

    value = copy.deepcopy(envelope)
    extraction = value["extraction"]
    canonical_key = copy.deepcopy(extraction["answerKey"])
    applied = set(recovered)
    for question in extraction["questions"]:
        number = int(question["number"])
        if number in recovered:
            question["alternatives"] = recovered[number]

    missing_media = {int(number) for number in extraction.get("questionsMissingMedia", [])}
    missing_media.update(applied)
    extraction["questionsMissingMedia"] = sorted(missing_media)

    issues = list(extraction.get("semanticFidelityIssues", []))
    for number in sorted(applied):
        page = int(by_region[number]["page"])
        issues.append(
            {
                "code": "layout-ambiguity",
                "severity": "error",
                "questionNumber": number,
                "page": page,
                "field": "alternative:A",
                "message": (
                    "alternativas predominantemente visuais foram preservadas como crops A-E; "
                    "associação e conteúdo exigem revisão antes de uso nativo"
                ),
            }
        )
    extraction["semanticFidelityIssues"] = issues
    if extraction["answerKey"] != canonical_key:
        raise AssertionError("visual alternative recovery changed canonical answer key")

    report.update(
        {
            "applied": True,
            "appliedQuestions": sorted(applied),
            "unresolvedQuestions": [number for number in targets if number not in applied],
            "assets": assets,
            "answerKeyPreserved": True,
            "semanticVerificationRequired": True,
            "mediaVerificationRequired": True,
        }
    )
    value["visualAlternativeRecovery"] = report
    return value, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--media-dir", required=True, type=Path)
    parser.add_argument("--public-prefix", default="/ingestion-media/fuvest")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--metrics", action="store_true")
    args = parser.parse_args()

    manifest = BASE["load_manifest"]()
    try:
        entry, exam_bytes, key_bytes, pages = BASE["load_year_documents"](args.year, manifest)
        envelope = BASE["build_envelope"](entry, exam_bytes, key_bytes, pages)
        envelope, _ = REGIONAL["recover_envelope"](envelope, entry, exam_bytes, key_bytes)
        result, report = recover_visual_alternatives(
            envelope,
            entry,
            exam_bytes,
            key_bytes,
            args.media_dir,
            f"{args.public_prefix.rstrip('/')}/{args.year}/visual-alternatives",
        )
    except Exception as error:  # noqa: BLE001
        print(f"FUVEST {args.year}: VISUAL ALTERNATIVES BLOQUEADO — {error}", file=sys.stderr)
        return 1

    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)
    if args.metrics:
        print(
            json.dumps(
                {**BASE["metrics"](result), "visualAlternativeRecovery": report},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
