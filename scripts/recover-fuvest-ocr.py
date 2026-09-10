#!/usr/bin/env python3
"""Selective local recovery worker for FUVEST ingestion failures.

Consumes ``enemlab-extraction-failure/v1`` produced by the deterministic
FUVEST parser, verifies the exact source-document SHA-256 values and rebuilds
only the requested pages.

Some historical FUVEST PDFs keep the body text selectable while rasterizing the
question-number labels. Re-OCRing the whole page is both slower and less
reliable. This worker therefore masks every glyph already represented by the
native text layer, isolates the small raster-only labels at the beginning of
each column, and reinserts validated structural numbers into a column-aware
native-text reconstruction.

The sequence is used only after the visual boundary set closes exactly at the
reviewed question count. Missing or extra raster labels fail closed. Recovered
pages remain semantically unverified and still require visual/human review
before native publication. Canonical answers always come from the reviewed
FUVEST manifest; this worker never derives or edits the answer key.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import runpy
import sys
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
BASE = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))
MANIFEST = ROOT / "src/lib/providers/fuvest/answer-keys.generated.json"
FAILURE_PROTOCOL_VERSION = "enemlab-extraction-failure/v1"
SUCCESS_PROTOCOL_VERSION = "enemlab-extraction/v1"
PROVIDER_ID = "fuvest"
SOURCE_ID = "fuvest-archive"
WORKER_NAME = "fuvest-raster-boundary-recovery"
WORKER_VERSION = "fuvest-raster-boundary-recovery@0.3.0"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

# The historical FUVEST label font is rasterized, but its rendered geometry is
# stable. These are deliberately narrow gates: if another edition/layout does
# not match, recovery fails instead of guessing boundaries.
LABEL_X_TOLERANCE_PT = 1.6
LABEL_WIDTH_MIN_PT = 8.0
LABEL_WIDTH_MAX_PT = 16.0
LABEL_HEIGHT_MIN_PT = 8.0
LABEL_HEIGHT_MAX_PT = 11.0
LABEL_DENSITY_MIN = 0.45
LABEL_DENSITY_MAX = 0.70
LABEL_STRIP_LEFT_PAD_PT = 3.0
LABEL_STRIP_WIDTH_PT = 38.0
TEXT_MASK_PAD_PT = 1.6
CONTENT_TOP_PT = 40.0
CONTENT_BOTTOM_PT = 790.0


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "enemlab-ingest/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("failure envelope must be a JSON object")
    return value


def load_manifest(path: Path = MANIFEST) -> dict[str, dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_failure_envelope(
    failure: dict[str, Any], manifest: dict[str, dict[str, Any]]
) -> tuple[dict[str, Any], list[int]]:
    if failure.get("protocolVersion") != FAILURE_PROTOCOL_VERSION:
        raise ValueError("unsupported failure protocol")

    identity = failure.get("identity")
    if not isinstance(identity, dict):
        raise ValueError("failure identity is missing")
    if identity.get("providerId") != PROVIDER_ID or identity.get("sourceId") != SOURCE_ID:
        raise ValueError("failure envelope belongs to another provider/source")
    if identity.get("phase") != "first":
        raise ValueError("only FUVEST first-phase recovery is supported")

    year = identity.get("year")
    edition_id = identity.get("editionId")
    if not isinstance(year, int) or edition_id != str(year):
        raise ValueError("failure envelope has inconsistent edition identity")

    entry = manifest.get(str(year))
    if entry is None:
        raise ValueError(f"FUVEST {year}: edition is not in reviewed manifest")
    BASE["validate_manifest_entry"](entry, year)

    documents = failure.get("documents")
    if not isinstance(documents, list) or len(documents) != 2:
        raise ValueError("failure envelope must contain exactly exam and answer-key documents")
    expected_urls = {entry["examUrl"], entry["answerKeyUrl"]}
    actual_urls: set[str] = set()
    for document in documents:
        if not isinstance(document, dict):
            raise ValueError("failure document is malformed")
        url = document.get("url")
        digest = str(document.get("sha256", "")).lower()
        if url in actual_urls:
            raise ValueError("failure envelope contains duplicate document URL")
        if url not in expected_urls or not SHA256_RE.fullmatch(digest):
            raise ValueError("failure envelope document binding is invalid")
        actual_urls.add(url)
    if actual_urls != expected_urls:
        raise ValueError("failure envelope document set does not match reviewed manifest")

    request = failure.get("fallbackRequest")
    targets = request.get("targets") if isinstance(request, dict) else None
    if not isinstance(targets, list) or not targets:
        raise ValueError("failure envelope has no selective fallback targets")

    pages: set[int] = set()
    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("fallback target is malformed")
        page = target.get("page")
        if not isinstance(page, int) or page < 1:
            raise ValueError("recovery requires page-bound targets")
        pages.add(page)
    return entry, sorted(pages)


def fetch_bound_documents(
    failure: dict[str, Any], entry: dict[str, Any]
) -> tuple[bytes, bytes]:
    by_url = {str(document["url"]): document for document in failure["documents"]}
    downloaded: dict[str, bytes] = {}

    for url, document in by_url.items():
        body = fetch(url)
        if sha256_bytes(body) != str(document["sha256"]).lower():
            raise ValueError(f"source document changed since failure envelope: {url}")
        downloaded[url] = body

    exam_bytes = downloaded[entry["examUrl"]]
    key_bytes = downloaded[entry["answerKeyUrl"]]
    BASE["verify_answer_key_hash"](entry, key_bytes)
    return exam_bytes, key_bytes


def _row_groups(rows: list[int], max_gap: int) -> list[tuple[int, int]]:
    if not rows:
        return []
    groups: list[tuple[int, int]] = []
    start = previous = rows[0]
    for value in rows[1:]:
        if value <= previous + max_gap:
            previous = value
            continue
        groups.append((start, previous))
        start = previous = value
    groups.append((start, previous))
    return groups


def is_raster_label_shape(
    *, x_pt: float, column_start_pt: float, width_pt: float, height_pt: float, density: float
) -> bool:
    return (
        abs(x_pt - column_start_pt) <= LABEL_X_TOLERANCE_PT
        and LABEL_WIDTH_MIN_PT <= width_pt <= LABEL_WIDTH_MAX_PT
        and LABEL_HEIGHT_MIN_PT <= height_pt <= LABEL_HEIGHT_MAX_PT
        and LABEL_DENSITY_MIN <= density <= LABEL_DENSITY_MAX
    )


def _native_lines(page) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            text = "".join(str(span.get("text", "")) for span in spans).strip()
            bbox = line.get("bbox")
            if not text or not bbox:
                continue
            x0, y0, x1, y1 = (float(value) for value in bbox)
            if y1 < CONTENT_TOP_PT or y0 > CONTENT_BOTTOM_PT:
                continue
            lines.append(
                {"text": text, "x0": x0, "y0": y0, "x1": x1, "y1": y1}
            )
    return lines


def _most_common_position(values: list[float]) -> float:
    if not values:
        raise ValueError("could not infer FUVEST column start from native text")
    quantized = [round(value * 2) / 2 for value in values]
    return float(Counter(quantized).most_common(1)[0][0])


def infer_column_starts(document, target_pages: list[int]) -> tuple[float, float, float]:
    left: list[float] = []
    right: list[float] = []
    widths: list[float] = []

    for page_number in target_pages:
        if page_number < 1 or page_number > document.page_count:
            raise ValueError(f"requested recovery page {page_number} is outside PDF range")
        page = document.load_page(page_number - 1)
        width = float(page.rect.width)
        widths.append(width)
        midpoint = width / 2
        for line in _native_lines(page):
            x0 = float(line["x0"])
            if 20 <= x0 < midpoint - 8:
                left.append(x0)
            elif midpoint + 5 < x0 <= width - 20:
                right.append(x0)

    if not widths or max(widths) - min(widths) > 1.0:
        raise ValueError("target pages do not share a stable page width")
    page_width = sum(widths) / len(widths)
    left_start = _most_common_position(left)
    right_start = _most_common_position(right)
    if not (20 <= left_start < page_width / 2 < right_start < page_width - 20):
        raise ValueError("inferred FUVEST column geometry is invalid")
    return left_start, right_start, page_width / 2


def detect_raster_question_labels(
    exam_bytes: bytes,
    target_pages: list[int],
    expected_count: int,
    *,
    dpi: int = 216,
) -> tuple[list[dict[str, Any]], tuple[float, float, float]]:
    try:
        import pymupdf
        from PIL import Image, ImageDraw
    except ImportError as error:
        raise RuntimeError("install pymupdf and pillow to use raster-boundary recovery") from error

    document = pymupdf.open(stream=exam_bytes, filetype="pdf")
    try:
        left_start, right_start, midpoint = infer_column_starts(document, target_pages)
        scale = dpi / 72
        candidates: list[dict[str, Any]] = []

        for page_number in target_pages:
            page = document.load_page(page_number - 1)
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            image = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("L")
            masked = image.copy()
            draw = ImageDraw.Draw(masked)
            native_lines = _native_lines(page)

            # Remove all rendered glyphs already represented by native PDF text.
            # The question labels in the problematic layout survive because they
            # are raster-only, while body text disappears from the search image.
            for line in native_lines:
                draw.rectangle(
                    (
                        int((line["x0"] - TEXT_MASK_PAD_PT) * scale),
                        int((line["y0"] - TEXT_MASK_PAD_PT) * scale),
                        int((line["x1"] + TEXT_MASK_PAD_PT) * scale),
                        int((line["y1"] + TEXT_MASK_PAD_PT) * scale),
                    ),
                    fill=255,
                )

            pixels = masked.load()
            for column, column_start in (("L", left_start), ("R", right_start)):
                x0 = max(0, int((column_start - LABEL_STRIP_LEFT_PAD_PT) * scale))
                x1 = min(
                    masked.width,
                    int((column_start + LABEL_STRIP_WIDTH_PT) * scale),
                )
                y0 = max(0, int(CONTENT_TOP_PT * scale))
                y1 = min(masked.height, int(CONTENT_BOTTOM_PT * scale))
                rows: list[int] = []
                minimum_dark = max(3, int(scale * 2.0))

                for y in range(y0, y1):
                    dark = sum(1 for x in range(x0, x1) if pixels[x, y] < 120)
                    if dark >= minimum_dark:
                        rows.append(y)

                for start, end in _row_groups(rows, max(2, int(scale * 1.7))):
                    coords = [
                        (x, y)
                        for y in range(max(y0, start - 1), min(y1, end + 2))
                        for x in range(x0, x1)
                        if pixels[x, y] < 120
                    ]
                    if not coords:
                        continue
                    bx0 = min(x for x, _ in coords)
                    bx1 = max(x for x, _ in coords)
                    by0 = min(y for _, y in coords)
                    by1 = max(y for _, y in coords)
                    width_pt = (bx1 - bx0 + 1) / scale
                    height_pt = (by1 - by0 + 1) / scale
                    area = max(1, (bx1 - bx0 + 1) * (by1 - by0 + 1))
                    density = len(coords) / area
                    candidate_x = bx0 / scale
                    if not is_raster_label_shape(
                        x_pt=candidate_x,
                        column_start_pt=column_start,
                        width_pt=width_pt,
                        height_pt=height_pt,
                        density=density,
                    ):
                        continue
                    candidates.append(
                        {
                            "page": page_number,
                            "column": column,
                            "x": candidate_x,
                            "y": by0 / scale,
                            "width": width_pt,
                            "height": height_pt,
                            "density": density,
                        }
                    )

        candidates.sort(
            key=lambda item: (
                int(item["page"]),
                0 if item["column"] == "L" else 1,
                float(item["y"]),
            )
        )
        if len(candidates) != expected_count:
            page_counts = Counter(int(item["page"]) for item in candidates)
            raise ValueError(
                "raster boundary set did not close at reviewed question count: "
                f"expected {expected_count}, found {len(candidates)}; "
                f"page counts {dict(sorted(page_counts.items()))}"
            )

        for number, candidate in enumerate(candidates, start=1):
            candidate["number"] = number
        return candidates, (left_start, right_start, midpoint)
    finally:
        document.close()


def reconstruct_target_pages(
    exam_bytes: bytes,
    target_pages: list[int],
    expected_count: int,
    *,
    dpi: int = 216,
) -> tuple[dict[int, str], list[dict[str, Any]], tuple[float, float, float]]:
    try:
        import pymupdf
    except ImportError as error:
        raise RuntimeError("install pymupdf to use raster-boundary recovery") from error

    labels, geometry = detect_raster_question_labels(
        exam_bytes, target_pages, expected_count, dpi=dpi
    )
    left_start, right_start, midpoint = geometry
    labels_by_page: dict[int, list[dict[str, Any]]] = {}
    for label in labels:
        labels_by_page.setdefault(int(label["page"]), []).append(label)

    document = pymupdf.open(stream=exam_bytes, filetype="pdf")
    try:
        reconstructed: dict[int, str] = {}
        for page_number in target_pages:
            page = document.load_page(page_number - 1)
            native = _native_lines(page)
            page_labels = labels_by_page.get(page_number, [])
            column_texts: list[str] = []

            for column, column_start in (("L", left_start), ("R", right_start)):
                line_events: list[tuple[float, int, float, str]] = []
                for line in native:
                    center = (float(line["x0"]) + float(line["x1"])) / 2
                    belongs_left = center < midpoint
                    if (column == "L") != belongs_left:
                        continue
                    line_events.append(
                        (float(line["y0"]), 1, float(line["x0"]), str(line["text"]))
                    )

                for label in page_labels:
                    if label["column"] != column:
                        continue
                    line_events.append(
                        (float(label["y"]), 0, column_start, f"{int(label['number']):02d}")
                    )

                line_events.sort(key=lambda event: (event[0], event[1], event[2]))
                text = "\n".join(event[3] for event in line_events if event[3].strip())
                if text:
                    column_texts.append(text)

            if not column_texts:
                raise ValueError(f"native reconstruction returned empty page {page_number}")
            reconstructed[page_number] = "\n".join(column_texts)
        return reconstructed, labels, geometry
    finally:
        document.close()


def merge_recovered_with_native_pages(
    exam_bytes: bytes, recovered_text_by_page: dict[int, str]
) -> list[str]:
    pages = list(BASE["extract_pdf_pages"](exam_bytes))
    for page_number, text in recovered_text_by_page.items():
        if page_number < 1 or page_number > len(pages):
            raise ValueError(f"recovery page {page_number} is outside extracted page range")
        pages[page_number - 1] = text
    return pages


def touched_questions(
    questions: list[dict[str, Any]], target_pages: set[int], total_pages: int
) -> set[int]:
    touched: set[int] = set()
    ordered = sorted(questions, key=lambda question: int(question["number"]))
    for index, question in enumerate(ordered):
        start = question.get("page")
        if not isinstance(start, int):
            touched.add(int(question["number"]))
            continue
        next_start = (
            ordered[index + 1].get("page") if index + 1 < len(ordered) else total_pages + 1
        )
        end = next_start if isinstance(next_start, int) else start
        if any(start <= page <= end for page in target_pages):
            touched.add(int(question["number"]))
    return touched


def build_recovery_envelope(
    failure: dict[str, Any],
    entry: dict[str, Any],
    exam_bytes: bytes,
    key_bytes: bytes,
    recovered_text_by_page: dict[int, str],
    *,
    boundary_labels: list[dict[str, Any]] | None = None,
    geometry: tuple[float, float, float] | None = None,
) -> dict[str, Any]:
    pages = merge_recovered_with_native_pages(exam_bytes, recovered_text_by_page)
    extraction = BASE["extraction_payload"](entry, pages)
    target_pages = set(recovered_text_by_page)
    affected = touched_questions(extraction["questions"], target_pages, len(pages))

    semantic = list(extraction.get("semanticFidelityIssues", []))
    semantic.extend(
        {
            "code": "extractor-reported",
            "severity": "error",
            "questionNumber": number,
            "message": (
                "conteúdo desta questão cruza página reconstruída por boundary raster; "
                "exige verificação visual/semântica antes de uso nativo"
            ),
        }
        for number in sorted(affected)
    )
    extraction["semanticFidelityIssues"] = semantic
    extraction.setdefault("warnings", []).append(
        "reconstrução seletiva de boundaries raster aplicada às páginas "
        + ", ".join(str(page) for page in sorted(target_pages))
    )

    BASE["verify_answer_key_hash"](entry, key_bytes)
    extraction["answerKey"] = {
        str(number): answer for number, answer in entry["answers"].items()
    }
    extraction["annulled"] = list(entry.get("annulled", []))

    recovery: dict[str, Any] = {
        "method": "raster-boundary-reconstruction",
        "pages": sorted(target_pages),
        "semanticVerificationRequired": True,
    }
    if boundary_labels is not None:
        recovery["boundaryLabels"] = len(boundary_labels)
    if geometry is not None:
        recovery["columnStartsPt"] = [round(geometry[0], 1), round(geometry[1], 1)]

    return {
        "protocolVersion": SUCCESS_PROTOCOL_VERSION,
        "identity": dict(failure["identity"]),
        "extractor": {"name": WORKER_NAME, "version": WORKER_VERSION},
        "documents": [dict(document) for document in failure["documents"]],
        "extraction": extraction,
        "recovery": recovery,
    }


def metrics(envelope: dict[str, Any]) -> dict[str, int]:
    base = BASE["metrics"](envelope)
    recovery = envelope.get("recovery", {})
    return {
        **base,
        "recoveryPages": len(recovery.get("pages", [])),
        "boundaryLabels": int(recovery.get("boundaryLabels", 0)),
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--failure", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dpi", type=int, default=216)
    parser.add_argument("--metrics", action="store_true")
    args = parser.parse_args()

    if args.dpi < 144 or args.dpi > 400:
        print("RECOVERY BLOCKED — dpi must be between 144 and 400", file=sys.stderr)
        return 1

    try:
        failure = load_json(args.failure)
        manifest = load_manifest()
        entry, target_pages = validate_failure_envelope(failure, manifest)
        exam_bytes, key_bytes = fetch_bound_documents(failure, entry)
        recovered_pages, labels, geometry = reconstruct_target_pages(
            exam_bytes,
            target_pages,
            int(entry["total"]),
            dpi=args.dpi,
        )
        envelope = build_recovery_envelope(
            failure,
            entry,
            exam_bytes,
            key_bytes,
            recovered_pages,
            boundary_labels=labels,
            geometry=geometry,
        )
        write_json(args.output, envelope)
    except Exception as error:  # noqa: BLE001
        print(f"RECOVERY BLOCKED — {error}", file=sys.stderr)
        return 1

    if args.metrics:
        print(json.dumps(metrics(envelope), ensure_ascii=False), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
