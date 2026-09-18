#!/usr/bin/env python3
"""Preparação visual específica do IME usando grupos ordenados A..E."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import native_ingest as ingest
import native_option_markers as option_markers

MARKER_PROFILE = "ordered-option-groups"


def _contains_group(region: dict[str, Any], group: option_markers.OptionGroup, page: Any) -> bool:
    if int(region.get("page") or 0) != group.page_index + 1:
        return False
    rect = region.get("rect")
    if not isinstance(rect, dict):
        return False
    width = float(page.rect.width)
    height = float(page.rect.height)
    x0 = float(rect.get("x") or 0) * width
    y0 = float(rect.get("y") or 0) * height
    x1 = x0 + float(rect.get("width") or 0) * width
    y1 = y0 + float(rect.get("height") or 0) * height
    tolerance = 3.0
    return (
        x0 <= group.x0 + tolerance
        and y0 <= group.y0 + tolerance
        and x1 >= group.x1 - tolerance
        and y1 >= group.y1 - tolerance
    )


def _decorate(pack: dict[str, Any], doc: Any, groups: list[option_markers.OptionGroup], pipeline: Any, error_type: type[Exception]) -> dict[str, Any]:
    questions = pack.get("questions") or []
    if len(questions) != len(groups):
        raise error_type("IME: quantidade do pack diverge dos grupos de alternativas")

    prefix_regions = option_markers.preceding_page_regions(doc, groups)
    for number, (question, group) in enumerate(zip(questions, groups, strict=True), start=1):
        visual_regions = question.get("visualRegions") or []
        prefixes: list[dict[str, Any]] = []
        for page_index, rect in prefix_regions.get(number, []):
            prefixes.append(
                {
                    "page": page_index + 1,
                    "role": "shared-context",
                    "rect": pipeline._normalized_rect(rect, doc[page_index]),
                }
            )
        if prefixes:
            question["visualRegions"] = [*prefixes, *visual_regions]
            visual_regions = question["visualRegions"]

        if not any(
            isinstance(region, dict) and _contains_group(region, group, doc[group.page_index])
            for region in visual_regions
        ):
            raise error_type(f"IME Q{number}: recorte não contém o grupo completo de alternativas")

        extraction = question.setdefault("extraction", {})
        extraction["markerStrategy"] = MARKER_PROFILE
        extraction["optionGroupKind"] = group.kind
        extraction["optionGroupDetected"] = True
        if prefixes:
            completeness = extraction.setdefault("visualCompleteness", {})
            reasons = [str(reason) for reason in completeness.get("reasons") or []]
            completeness["required"] = True
            completeness["resolved"] = True
            completeness["strategy"] = "shared-context"
            completeness["reasons"] = list(
                dict.fromkeys([*reasons, "layout:ordered-option-page-transition"])
            )
            ingest._remove_visual_dependency_issue(extraction)
            extraction["confidence"] = max(float(extraction.get("confidence") or 0), 0.9)
    return pack


def prepare(target: Any, pdf: Path, core: Any, fleet: Any) -> dict[str, Any]:
    if not pdf.exists():
        raise fleet.NativeFleetError(f"{target.identity}: fonte auditada não encontrada")

    question_key_format = ingest._question_key_format(target)
    if not question_key_format:
        raise fleet.NativeFleetError(
            f"{target.identity}: questionKey não comprovada contra o provider executável"
        )

    target.output_dir.mkdir(parents=True, exist_ok=True)
    spec_path = core._write_spec(target, pdf, target.output_dir / "spec.json")
    payload = json.loads(spec_path.read_text(encoding="utf-8"))
    payload["questionKeyFormat"] = question_key_format
    payload["markerStrategy"] = MARKER_PROFILE
    spec_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    pipeline = core._load_native_pipeline()
    spec = pipeline._load_spec(spec_path)
    fitz, _ = pipeline._imports()
    doc = fitz.open(pdf)
    try:
        groups = option_markers.detect_ordered_option_groups(doc, spec.option_ids, spec.total)
        markers = option_markers.markers_from_groups(doc, groups, pipeline.Marker)
        pipeline.validate_marker_numbers(markers, spec.total)

        original = pipeline.detect_markers
        pipeline.detect_markers = lambda _doc, _pattern: markers
        try:
            pack = pipeline.build_pack(spec, pdf, target.output_dir)
        finally:
            pipeline.detect_markers = original

        pack = _decorate(pack, doc, groups, pipeline, fleet.NativeFleetError)
    except option_markers.OrderedOptionMarkerError as error:
        raise fleet.NativeFleetError(f"{target.identity}: {error}") from error
    finally:
        doc.close()

    return ingest._auto_expand_ambiguous_visuals(pack, target.output_dir)
