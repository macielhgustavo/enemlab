#!/usr/bin/env python3
"""ITA preparation profile for scanned first-phase PDFs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import native_ocr_markers

MARKER_PROFILE = "ita-ocr-question-markers@1"


def prepare(
    target: Any,
    pdf_override: Path | None,
    core: Any,
    ingest: Any,
) -> dict[str, Any]:
    output = target.output_dir
    output.mkdir(parents=True, exist_ok=True)
    pdf = pdf_override or output / "source.pdf"
    if pdf_override is None:
        if not target.exam_url:
            raise core.NativeOrchestratorError("caderno objetivo sem URL no catálogo")
        core._download_pdf(target.exam_url, pdf)
    elif not pdf.exists():
        raise core.NativeOrchestratorError(f"PDF local não encontrado: {pdf}")

    spec_path = core._write_spec(target, pdf, output / "spec.json")
    payload = json.loads(spec_path.read_text(encoding="utf-8"))
    payload["questionKeyFormat"] = ingest._question_key_format(target)
    spec_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    pipeline = core._load_native_pipeline()
    spec = pipeline._load_spec(spec_path)
    fitz, _image = pipeline._imports()
    doc = fitz.open(pdf)
    try:
        markers = native_ocr_markers.detect_markers(
            doc,
            spec.marker_pattern,
            pipeline.Marker,
        )
    finally:
        doc.close()

    pipeline.validate_marker_numbers(markers, spec.total)
    original_detect_markers = pipeline.detect_markers
    pipeline.detect_markers = lambda _doc, _pattern: markers
    try:
        pack = pipeline.build_pack(spec, pdf, output)
    finally:
        pipeline.detect_markers = original_detect_markers
    return ingest._auto_expand_ambiguous_visuals(pack, output)
