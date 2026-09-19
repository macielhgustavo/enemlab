#!/usr/bin/env python3
"""Provider-aware preparation entrypoint for the autonomous NativePack fleet."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import replace
from pathlib import Path
from typing import Any

import native_fleet as fleet
import native_ime_prepare as ime_prepare
import native_ingest as ingest
import native_ocr_markers as ocr_markers
import native_option_markers as option_markers
import native_orchestrator as core

EEAR_MARKER_PATTERN = r"(?m)^\s*(0[1-9]|[1-9]\d|100)\s*[–—-]\s+"
NUMBERED_LINE_RE = re.compile(
    r"^\s*(?:(?:QUEST(?:ÃO|AO)|Q)\s*)?[\[(]?0?(\d{1,3})[\])\.:;\-–—]?(?:\s+|$)",
    re.IGNORECASE,
)

PROVIDER_MARKER_PATTERNS: dict[str, str] = {
    "eear": EEAR_MARKER_PATTERN,
}

ADAPTIVE_OPTION_PROVIDERS = {"eear", "unioeste", "espcex"}
PINNED_ARCHIVE_PROVIDERS = {"ime", "afa", "epcar"}
SOURCE_AUDIT_FILENAME = "exam-sources.audit.json"
MIRROR_AUDIT_FILENAME = "native-sources.audit.json"
SOURCE_AUDIT_SCHEMA_VERSION = 1
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def apply_layout_profile(target: core.NativeTarget) -> core.NativeTarget:
    marker_pattern = PROVIDER_MARKER_PATTERNS.get(target.provider_id)
    if not marker_pattern:
        return target
    return replace(target, marker_pattern=marker_pattern)


def _source_audit_record(target: core.NativeTarget) -> dict[str, object] | None:
    if target.provider_id not in PINNED_ARCHIVE_PROVIDERS:
        return None

    path = core.PROVIDERS / target.provider_id / SOURCE_AUDIT_FILENAME
    if not path.exists():
        return None

    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != SOURCE_AUDIT_SCHEMA_VERSION:
        raise fleet.NativeFleetError(
            f"{target.identity}: versão do manifesto de fonte auditada não suportada"
        )
    if raw.get("provider") != target.provider_id:
        raise fleet.NativeFleetError(
            f"{target.identity}: manifesto de fonte pertence a outro provider"
        )

    records = raw.get("records")
    if not isinstance(records, dict):
        raise fleet.NativeFleetError(f"{target.identity}: manifesto de fonte sem records")

    key = target.edition_id if target.edition_id else str(target.year)
    record = records.get(key)
    return record if isinstance(record, dict) else None


def _pinned_archive_metadata(target: core.NativeTarget) -> tuple[str, str, int] | None:
    record = _source_audit_record(target)
    if not record:
        return None

    official = record.get("examUrl")
    archive = record.get("examArchiveUrl")
    digest = record.get("examSha256")
    byte_length = record.get("examBytes")
    present = [official is not None, archive is not None, digest is not None, byte_length is not None]
    if any(present) and not all(present):
        raise fleet.NativeFleetError(f"{target.identity}: metadados de fonte pinada incompletos")
    if not all(present):
        return None

    if not target.exam_url:
        raise fleet.NativeFleetError(f"{target.identity}: fonte pinada sem URL oficial")
    official = str(official)
    archive = str(archive)
    digest = str(digest).lower()
    try:
        byte_length = int(byte_length)
    except (TypeError, ValueError) as error:
        raise fleet.NativeFleetError(f"{target.identity}: examBytes inválido") from error

    if official != target.exam_url:
        raise fleet.NativeFleetError(
            f"{target.identity}: URL oficial do audit diverge do catálogo executável"
        )

    expected_archive = re.compile(
        r"^https://web\.archive\.org/web/\d{14}id_/" + re.escape(target.exam_url) + r"$"
    )
    if not expected_archive.fullmatch(archive):
        raise fleet.NativeFleetError(
            f"{target.identity}: snapshot não corresponde exatamente à URL oficial"
        )
    if not SHA256_RE.fullmatch(digest):
        raise fleet.NativeFleetError(f"{target.identity}: examSha256 inválido")
    if byte_length < 1:
        raise fleet.NativeFleetError(f"{target.identity}: examBytes inválido")
    return archive, digest, byte_length


def _verified_pdf_override(target: core.NativeTarget) -> Path | None:
    pinned = _pinned_archive_metadata(target)
    if not pinned:
        return None
    archive_url, expected_sha, expected_bytes = pinned
    destination = target.output_dir / "source-pinned.pdf"
    temporary = target.output_dir / "source-pinned.tmp"
    target.output_dir.mkdir(parents=True, exist_ok=True)
    temporary.unlink(missing_ok=True)
    try:
        core._download_pdf(archive_url, temporary)
        actual_sha = core._sha256(temporary)
        actual_bytes = temporary.stat().st_size
        if actual_sha != expected_sha:
            raise fleet.NativeFleetError(
                f"{target.identity}: SHA do snapshot diverge do audit ({actual_sha})"
            )
        if actual_bytes != expected_bytes:
            raise fleet.NativeFleetError(
                f"{target.identity}: tamanho do snapshot diverge do audit "
                f"({actual_bytes}/{expected_bytes})"
            )
        temporary.replace(destination)
        return destination
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _mirror_source_metadata(target: core.NativeTarget) -> tuple[str, str, int] | None:
    path = core.PROVIDERS / target.provider_id / MIRROR_AUDIT_FILENAME
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != SOURCE_AUDIT_SCHEMA_VERSION:
        raise fleet.NativeFleetError(
            f"{target.identity}: versão do audit de mirror não suportada"
        )
    if raw.get("provider") != target.provider_id:
        raise fleet.NativeFleetError(
            f"{target.identity}: audit de mirror pertence a outro provider"
        )
    records = raw.get("records")
    if not isinstance(records, dict):
        raise fleet.NativeFleetError(f"{target.identity}: audit de mirror sem records")
    record = records.get(f"{target.edition_id or target.year}:{target.phase}")
    if not isinstance(record, dict):
        return None
    if not target.exam_url or record.get("catalogExamUrl") != target.exam_url:
        raise fleet.NativeFleetError(
            f"{target.identity}: URL catalogada diverge do audit de mirror"
        )

    mirror = str(record.get("mirrorUrl") or "")
    digest = str(record.get("mirrorSha256") or "").lower()
    try:
        byte_length = int(record.get("mirrorBytes") or 0)
    except (TypeError, ValueError) as error:
        raise fleet.NativeFleetError(f"{target.identity}: mirrorBytes inválido") from error
    if not re.fullmatch(r"https://[^\s]+", mirror):
        raise fleet.NativeFleetError(f"{target.identity}: mirrorUrl inválido")
    if not SHA256_RE.fullmatch(digest):
        raise fleet.NativeFleetError(f"{target.identity}: mirrorSha256 inválido")
    if byte_length < 1:
        raise fleet.NativeFleetError(f"{target.identity}: mirrorBytes inválido")
    return mirror, digest, byte_length


def _verified_mirror_override(target: core.NativeTarget) -> tuple[Path, str] | None:
    metadata = _mirror_source_metadata(target)
    if not metadata:
        return None
    mirror_url, expected_sha, expected_bytes = metadata
    destination = target.output_dir / "source-mirror.pdf"
    temporary = target.output_dir / "source-mirror.tmp"
    target.output_dir.mkdir(parents=True, exist_ok=True)
    temporary.unlink(missing_ok=True)
    try:
        core._download_pdf(mirror_url, temporary)
        actual_sha = core._sha256(temporary)
        actual_bytes = temporary.stat().st_size
        if actual_sha != expected_sha or actual_bytes != expected_bytes:
            raise fleet.NativeFleetError(
                f"{target.identity}: mirror diverge do audit "
                f"({actual_sha}, {actual_bytes} bytes)"
            )
        temporary.replace(destination)
        return destination, mirror_url
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _numbered_line_markers(
    doc: Any,
    target: core.NativeTarget,
    pipeline: Any,
) -> list[Any]:
    line_labels = option_markers._collect_line_option_labels(doc)
    isolated_labels, _ = option_markers._collect(doc)
    option_page_counts: dict[int, int] = {}
    for label in [*line_labels, *isolated_labels]:
        option_page_counts[label.page_index] = option_page_counts.get(label.page_index, 0) + 1
    option_pages = {
        page_index
        for page_index, count in option_page_counts.items()
        if count >= max(2, len(target.option_ids) - 1)
    }

    markers: list[Any] = []
    for page_index, page in enumerate(doc):
        if option_pages and page_index not in option_pages:
            continue
        data = page.get_text("dict", sort=True)
        width = float(page.rect.width)
        height = float(page.rect.height)
        for block in data.get("blocks", []):
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                raw = "".join(str(span.get("text", "")) for span in spans).strip()
                match = NUMBERED_LINE_RE.match(raw)
                if not match:
                    continue
                number = int(match.group(1))
                if not 1 <= number <= target.total:
                    continue
                boxes = [
                    tuple(map(float, span["bbox"]))
                    for span in spans
                    if span.get("bbox")
                ]
                if not boxes:
                    continue
                x0 = min(box[0] for box in boxes)
                y0 = min(box[1] for box in boxes)
                x1 = max(box[2] for box in boxes)
                y1 = max(box[3] for box in boxes)
                if x0 > width * 0.24 or y0 < height * 0.045 or y0 > height * 0.97:
                    continue
                markers.append(
                    pipeline.Marker(
                        number=number,
                        page_index=page_index,
                        x0=x0,
                        y0=y0,
                        x1=x1,
                        y1=y1,
                    )
                )

    markers = pipeline.canonicalize_markers(markers, target.total)
    pipeline.validate_marker_numbers(markers, target.total)
    return markers


def _prepare_with_markers(
    target: core.NativeTarget,
    pdf: Path,
    markers: list[Any],
    marker_strategy: str,
) -> dict[str, Any]:
    question_key_format = ingest._question_key_format(target)
    if not question_key_format:
        raise fleet.NativeFleetError(
            f"{target.identity}: questionKey não comprovada contra o provider executável"
        )

    target.output_dir.mkdir(parents=True, exist_ok=True)
    spec_path = core._write_spec(target, pdf, target.output_dir / "spec.json")
    payload = json.loads(spec_path.read_text(encoding="utf-8"))
    payload["questionKeyFormat"] = question_key_format
    payload["markerStrategy"] = marker_strategy
    spec_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    pipeline = core._load_native_pipeline()
    spec = pipeline._load_spec(spec_path)
    pipeline.validate_marker_numbers(markers, spec.total)
    original = pipeline.detect_markers
    pipeline.detect_markers = lambda _doc, _pattern: markers
    try:
        pack = pipeline.build_pack(spec, pdf, target.output_dir)
    finally:
        pipeline.detect_markers = original

    for question in pack.get("questions") or []:
        extraction = question.setdefault("extraction", {})
        extraction["markerStrategy"] = marker_strategy
    return ingest._auto_expand_ambiguous_visuals(pack, target.output_dir)


def _contains_group(
    region: dict[str, Any],
    group: option_markers.OptionGroup,
    page: Any,
) -> bool:
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


def _decorate_group_pack(
    target: core.NativeTarget,
    pack: dict[str, Any],
    doc: Any,
    groups: list[option_markers.OptionGroup],
    pipeline: Any,
    marker_strategy: str,
) -> dict[str, Any]:
    questions = pack.get("questions") or []
    if len(questions) != len(groups):
        raise fleet.NativeFleetError(
            f"{target.identity}: quantidade do pack diverge dos grupos de alternativas"
        )

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
            isinstance(region, dict)
            and _contains_group(region, group, doc[group.page_index])
            for region in visual_regions
        ):
            page = doc[group.page_index]
            width = float(page.rect.width)
            height = float(page.rect.height)
            pad = 6.0
            safety = (
                max(0.0, group.x0 - pad),
                max(0.0, group.y0 - pad),
                min(width, group.x1 + pad),
                min(height, group.y1 + pad),
            )
            question.setdefault("visualRegions", []).append(
                {
                    "page": group.page_index + 1,
                    "role": "continuation",
                    "rect": pipeline._normalized_rect(safety, page),
                }
            )
            visual_regions = question["visualRegions"]
        if not any(
            isinstance(region, dict)
            and _contains_group(region, group, doc[group.page_index])
            for region in visual_regions
        ):
            raise fleet.NativeFleetError(
                f"{target.identity} Q{number}: recorte de segurança não contém alternativas"
            )

        extraction = question.setdefault("extraction", {})
        extraction["markerStrategy"] = marker_strategy
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


def _prepare_with_option_groups(
    target: core.NativeTarget,
    pdf: Path,
    groups: list[option_markers.OptionGroup],
    marker_strategy: str,
) -> dict[str, Any]:
    question_key_format = ingest._question_key_format(target)
    if not question_key_format:
        raise fleet.NativeFleetError(
            f"{target.identity}: questionKey não comprovada contra o provider executável"
        )
    target.output_dir.mkdir(parents=True, exist_ok=True)
    spec_path = core._write_spec(target, pdf, target.output_dir / "spec.json")
    payload = json.loads(spec_path.read_text(encoding="utf-8"))
    payload["questionKeyFormat"] = question_key_format
    payload["markerStrategy"] = marker_strategy
    spec_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    pipeline = core._load_native_pipeline()
    spec = pipeline._load_spec(spec_path)
    fitz, _ = pipeline._imports()
    doc = fitz.open(pdf)
    try:
        synthetic = option_markers.markers_from_groups(doc, groups, pipeline.Marker)
        pipeline.validate_marker_numbers(synthetic, spec.total)
        original = pipeline.detect_markers
        pipeline.detect_markers = lambda _doc, _pattern: synthetic
        try:
            pack = pipeline.build_pack(spec, pdf, target.output_dir)
        finally:
            pipeline.detect_markers = original
        pack = _decorate_group_pack(
            target,
            pack,
            doc,
            groups,
            pipeline,
            marker_strategy,
        )
    finally:
        doc.close()
    return ingest._auto_expand_ambiguous_visuals(pack, target.output_dir)


def _adaptive_prepare(
    target: core.NativeTarget,
    pdf: Path,
) -> tuple[dict[str, Any], str]:
    pipeline = core._load_native_pipeline()
    fitz, _ = pipeline._imports()
    doc = fitz.open(pdf)
    default_error = ""
    numbered_error = ""
    group_error = ""
    groups: list[option_markers.OptionGroup] | None = None
    numbered: list[Any] | None = None
    try:
        try:
            default_markers = pipeline.canonicalize_markers(
                pipeline.detect_markers(
                    doc,
                    target.marker_pattern or pipeline.DEFAULT_MARKER,
                ),
                target.total,
            )
            pipeline.validate_marker_numbers(default_markers, target.total)
            default_valid = True
        except Exception as error:
            default_valid = False
            default_error = str(error)

        if not default_valid and target.provider_id in {"espcex", "unioeste"}:
            try:
                numbered = _numbered_line_markers(doc, target, pipeline)
            except Exception as error:
                numbered = None
                numbered_error = str(error)

        if not default_valid and numbered is None:
            try:
                groups = option_markers.detect_ordered_option_groups(
                    doc,
                    target.option_ids,
                    target.total,
                )
            except option_markers.OrderedOptionMarkerError as error:
                group_error = str(error)
    finally:
        doc.close()

    if default_valid:
        return ingest._prepare(target, pdf_override=pdf), (
            target.provider_id if target.marker_pattern else "default"
        )
    if numbered is not None:
        return (
            _prepare_with_markers(
                target,
                pdf,
                numbered,
                "numbered-lines",
            ),
            "numbered-lines",
        )
    if groups is not None:
        return (
            _prepare_with_option_groups(
                target,
                pdf,
                groups,
                "ordered-option-groups",
            ),
            "ordered-option-groups",
        )

    if target.provider_id == "espcex":
        ocr_number_errors: list[str] = []
        try:
            candidates = ocr_markers.detect_ocr_number_marker_candidates(
                pdf,
                target.option_ids,
                target.total,
                pipeline.Marker,
            )
        except ocr_markers.OcrOptionMarkerError as error:
            candidates = []
            ocr_number_errors.append(str(error))
        for strategy, candidate_markers in candidates:
            try:
                candidate_markers = pipeline.canonicalize_markers(
                    candidate_markers,
                    target.total,
                )
                pipeline.validate_marker_numbers(candidate_markers, target.total)
                return (
                    _prepare_with_markers(
                        target,
                        pdf,
                        candidate_markers,
                        strategy,
                    ),
                    strategy,
                )
            except Exception as error:
                ocr_number_errors.append(f"{strategy}: {error}")

        try:
            ocr_groups = ocr_markers.detect_ocr_option_groups(
                pdf,
                target.option_ids,
                target.total,
            )
        except ocr_markers.OcrOptionMarkerError as error:
            raise fleet.NativeFleetError(
                f"{target.identity}: padrão ({default_error}); "
                f"linhas numeradas ({numbered_error}); grupos ({group_error}); "
                f"OCR números ({' | '.join(ocr_number_errors) or 'sem candidatos'}); "
                f"OCR alternativas ({error})"
            ) from error
        return (
            _prepare_with_option_groups(
                target,
                pdf,
                ocr_groups,
                "ocr-ordered-option-groups",
            ),
            "ocr-ordered-option-groups",
        )

    raise fleet.NativeFleetError(
        f"{target.identity}: padrão ({default_error}); "
        f"linhas numeradas ({numbered_error}); grupos ({group_error})"
    )

def prepare(provider: str, selector: str, phase: str, out: Path) -> dict[str, object]:
    targets = ingest.discover_targets()
    target = core._select_target(targets, provider, selector, phase)
    if target.status != "ready":
        raise fleet.NativeFleetError(f"{target.identity} bloqueado: {target.reason}")

    profiled = apply_layout_profile(target)
    archive_override = _verified_pdf_override(profiled)
    mirror_override = _verified_mirror_override(profiled)
    if archive_override is not None and mirror_override is not None:
        raise fleet.NativeFleetError(
            f"{profiled.identity}: duas fontes override concorrentes"
        )

    source_target = profiled
    pdf_override = archive_override
    source_profile = "pinned-archive" if archive_override else "default"
    if mirror_override is not None:
        pdf_override, mirror_url = mirror_override
        source_target = replace(profiled, exam_url=mirror_url)
        source_profile = "pinned-mirror"

    if source_target.provider_id == "ime":
        if pdf_override is None:
            raise fleet.NativeFleetError(
                f"{source_target.identity}: fonte auditada pinada é obrigatória"
            )
        pack = ime_prepare.prepare(source_target, pdf_override, core, fleet)
        marker_profile = f"ime-{ime_prepare.MARKER_PROFILE}"
    elif source_target.provider_id in ADAPTIVE_OPTION_PROVIDERS:
        if pdf_override is None:
            if not source_target.exam_url:
                raise fleet.NativeFleetError(
                    f"{source_target.identity}: caderno objetivo sem URL"
                )
            pdf_override = source_target.output_dir / "source.pdf"
            core._download_pdf(source_target.exam_url, pdf_override)
        pack, marker_profile = _adaptive_prepare(source_target, pdf_override)
    else:
        pack = ingest._prepare(source_target, pdf_override=pdf_override)
        marker_profile = (
            source_target.provider_id if source_target.marker_pattern else "default"
        )

    bundle = fleet._render_bundle(profiled, pack, out)
    return {
        "identity": profiled.identity,
        "assets": bundle["assetCount"],
        "revision": fleet.REVISION,
        "markerProfile": marker_profile,
        "sourceProfile": source_profile,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare one fleet target with provider layout/source profiles"
    )
    parser.add_argument("provider")
    parser.add_argument("selector")
    parser.add_argument("--phase", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(
        json.dumps(
            prepare(args.provider, args.selector, args.phase, args.out),
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
