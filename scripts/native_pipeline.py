#!/usr/bin/env python3
"""Pipeline v2 para transformar uma prova objetiva em NativePack verificável.

O pipeline continua sem publicar nada. Ele rasteriza as páginas uma única vez,
detecta questões/contextos compartilhados, gera regiões visuais e registra
evidência explícita de completude. Itens ambíguos ficam em review e falham
fechado; os demais podem ser aprovados automaticamente pelo publicador ZIP.

Dependências opcionais de execução:
  python -m pip install pymupdf pillow
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_MARKER = r"QUEST(?:ÃO|AO)\s*[\u2000-\u200f\s]*0?(\d{1,3})"
PARSER_VERSION = "native-pipeline@2.0.0"
PAGE_X0 = 0.06
PAGE_X1 = 0.94
PAGE_Y_BOTTOM = 0.94


class NativePipelineError(ValueError):
    pass


@dataclass(frozen=True)
class Spec:
    provider_id: str
    year: int
    phase: str
    edition_id: str | None
    total: int
    option_ids: tuple[str, ...]
    source_sha256: str
    source_url: str
    question_key_format: str
    marker_pattern: str = DEFAULT_MARKER

    @property
    def document_id(self) -> str:
        suffix = self.edition_id or str(self.year)
        return f"{self.provider_id}-{suffix}-{self.phase}"


@dataclass(frozen=True)
class Marker:
    number: int
    page_index: int
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass(frozen=True)
class SharedContext:
    start: int
    end: int
    page_index: int
    rect: tuple[float, float, float, float]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_spec(path: Path) -> Spec:
    raw = json.loads(path.read_text(encoding="utf-8"))
    option_ids = tuple(raw.get("optionIds") or ())
    if len(option_ids) < 2 or len(set(option_ids)) != len(option_ids):
        raise NativePipelineError("optionIds inválido")
    if any(letter not in {"A", "B", "C", "D", "E"} for letter in option_ids):
        raise NativePipelineError("somente resposta única A-E é suportada")
    total = int(raw["total"])
    if total < 1:
        raise NativePipelineError("total inválido")
    sha = str(raw["sourceSha256"]).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", sha):
        raise NativePipelineError("sourceSha256 inválido")

    # A identidade não pode ser inferida do provider/ano/fase dentro do
    # extrator. O orquestrador fornece um formato auditado contra questionKey.
    question_key_format = str(raw.get("questionKeyFormat") or "").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*-\{number\}", question_key_format):
        raise NativePipelineError(
            "questionKeyFormat ausente ou inválido; identidade precisa ser comprovada pelo provider"
        )
    rendered_keys = [question_key_format.replace("{number}", str(number)) for number in range(1, total + 1)]
    if len(set(rendered_keys)) != total:
        raise NativePipelineError("questionKeyFormat gera chaves duplicadas")

    return Spec(
        provider_id=str(raw["providerId"]),
        year=int(raw["year"]),
        phase=str(raw["phase"]),
        edition_id=str(raw["editionId"]) if raw.get("editionId") else None,
        total=total,
        option_ids=option_ids,
        source_sha256=sha,
        source_url=str(raw["sourceUrl"]),
        question_key_format=question_key_format,
        marker_pattern=str(raw.get("markerPattern") or DEFAULT_MARKER),
    )


def validate_marker_numbers(markers: list[Marker], total: int) -> None:
    numbers = [marker.number for marker in markers]
    duplicates = sorted({number for number in numbers if numbers.count(number) > 1})
    missing = sorted(set(range(1, total + 1)) - set(numbers))
    extra = sorted(set(numbers) - set(range(1, total + 1)))
    problems: list[str] = []
    if duplicates:
        problems.append(f"marcadores duplicados: {duplicates}")
    if missing:
        problems.append(f"marcadores faltantes: {missing}")
    if extra:
        problems.append(f"marcadores fora da faixa: {extra}")
    if problems:
        raise NativePipelineError("; ".join(problems))


def _imports():
    try:
        import pymupdf as fitz  # type: ignore
    except ImportError:
        try:
            import fitz  # type: ignore
        except ImportError as exc:
            raise NativePipelineError(
                "PyMuPDF ausente. Rode: python -m pip install pymupdf pillow"
            ) from exc
    try:
        from PIL import Image  # type: ignore
    except ImportError as exc:
        raise NativePipelineError(
            "Pillow ausente. Rode: python -m pip install pymupdf pillow"
        ) from exc
    return fitz, Image


def detect_markers(doc: Any, pattern: str) -> list[Marker]:
    marker_re = re.compile(pattern, re.IGNORECASE)
    markers: list[Marker] = []
    for page_index, page in enumerate(doc):
        for block in page.get_text("blocks", sort=False):
            text = str(block[4])
            for match in marker_re.finditer(text):
                markers.append(
                    Marker(
                        number=int(match.group(1)),
                        page_index=page_index,
                        x0=float(block[0]),
                        y0=float(block[1]),
                        x1=float(block[2]),
                        y1=float(block[3]),
                    )
                )
    return markers


def _plain(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text.lower())
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn")


def _shared_question_range(text: str) -> tuple[int, int] | None:
    plain = _plain(text)
    patterns = (
        r"quest(?:oes|ao)\s+(?:de\s+)?0?(\d{1,3})\s*(?:a|ate|[-–—])\s*0?(\d{1,3})",
        r"itens?\s+(?:de\s+)?0?(\d{1,3})\s*(?:a|ate|[-–—])\s*0?(\d{1,3})",
    )
    for pattern in patterns:
        match = re.search(pattern, plain, re.IGNORECASE)
        if match:
            start, end = int(match.group(1)), int(match.group(2))
            if start >= 1 and end >= start:
                return start, end
    return None


def _visual_dependency_reasons(text: str) -> list[str]:
    plain = _plain(text)
    rules = (
        ("context:romance", r"\bromance\b"),
        ("context:poem", r"\bpoema\b|\bversos?\b|eu lirico|\bestrofes?\b"),
        ("context:text", r"\btrecho\b|\bexcerto\b|\bpassagem\b|texto\s+[ivx]+"),
        ("media:image", r"ilustrad|\bimagem\b|\bfigura\b|fotograf|\btirinha\b|\bcharge\b|\bcartum\b|quadrinh"),
        ("media:chart", r"\bgrafico\b|\btabela\b|\bmapa\b|\bdiagrama\b"),
    )
    reasons: list[str] = []
    for tag, pattern in rules:
        if re.search(pattern, plain, re.IGNORECASE) and tag not in reasons:
            reasons.append(tag)
    return reasons


def _column(marker: Marker, page_width: float, two_columns: bool) -> int:
    if not two_columns:
        return 0
    return 0 if marker.x0 < page_width / 2 else 1


def _two_columns(page_markers: list[Marker], page_width: float) -> bool:
    if len(page_markers) < 2:
        return False
    x_positions = [candidate.x0 for candidate in page_markers]
    return max(x_positions) - min(x_positions) > page_width * 0.25


def _should_span_columns(
    marker: Marker,
    page_markers: list[Marker],
    page_width: float,
    page_height: float,
) -> bool:
    """Detecta blocos que começam na esquerda e atravessam a página.

    Se existe outra questão na coluna direita praticamente na mesma altura, as
    duas são paralelas e não há span. Se a próxima questão da direita só começa
    bem abaixo e vem antes da próxima da esquerda, o bloco atual pode ocupar a
    largura inteira (casos como tirinha/tabela e questões multi-coluna).
    """
    if not _two_columns(page_markers, page_width):
        return False
    if _column(marker, page_width, True) != 0:
        return False
    opposite = sorted(
        [
            candidate
            for candidate in page_markers
            if _column(candidate, page_width, True) == 1 and candidate.y0 >= marker.y0 - 2
        ],
        key=lambda candidate: candidate.y0,
    )
    if not opposite:
        return False
    first_opposite = opposite[0]
    if abs(first_opposite.y0 - marker.y0) <= page_height * 0.075:
        return False
    if first_opposite.y0 <= marker.y0 + page_height * 0.075:
        return False
    same_below = sorted(
        [
            candidate
            for candidate in page_markers
            if candidate.y0 > marker.y0 and _column(candidate, page_width, True) == 0
        ],
        key=lambda candidate: candidate.y0,
    )
    return not same_below or first_opposite.y0 < same_below[0].y0


def _next_marker_after(marker: Marker, page_markers: list[Marker]) -> Marker | None:
    later = [candidate for candidate in page_markers if candidate.y0 > marker.y0 + 2]
    return min(later, key=lambda candidate: candidate.y0) if later else None


def _draft_rect(marker: Marker, page: Any, page_markers: list[Marker]) -> tuple[float, float, float, float]:
    width = float(page.rect.width)
    height = float(page.rect.height)
    two_columns = _two_columns(page_markers, width)
    y0 = max(0.0, marker.y0 - 4)

    if _should_span_columns(marker, page_markers, width, height):
        next_marker = _next_marker_after(marker, page_markers)
        y1 = next_marker.y0 - 4 if next_marker else height * PAGE_Y_BOTTOM
        return width * PAGE_X0, y0, width * PAGE_X1, min(height, max(marker.y1 + 18, y1))

    column = _column(marker, width, two_columns)
    same_column = sorted(
        [
            candidate
            for candidate in page_markers
            if candidate.y0 > marker.y0 and _column(candidate, width, two_columns) == column
        ],
        key=lambda candidate: candidate.y0,
    )
    y1 = same_column[0].y0 - 4 if same_column else height * PAGE_Y_BOTTOM
    if two_columns:
        if column == 0:
            x0, x1 = width * PAGE_X0, width * 0.49
        else:
            x0, x1 = width * 0.51, width * PAGE_X1
    else:
        x0, x1 = width * PAGE_X0, width * PAGE_X1
    y1 = min(height, max(marker.y1 + 18, y1))
    return x0, y0, x1, y1


def _normalized_rect(rect: tuple[float, float, float, float], page: Any) -> dict[str, float]:
    x0, y0, x1, y1 = rect
    width = float(page.rect.width)
    height = float(page.rect.height)
    return {
        "x": round(x0 / width, 6),
        "y": round(y0 / height, 6),
        "width": round((x1 - x0) / width, 6),
        "height": round((y1 - y0) / height, 6),
    }


def _detected_options(text: str, allowed: tuple[str, ...]) -> list[str]:
    detected: list[str] = []
    patterns = (r"\(([A-E])\)", r"(?:^|\n)\s*([A-E])[\).]\s+")
    upper = text.upper()
    for pattern in patterns:
        for letter in re.findall(pattern, upper, re.MULTILINE):
            if letter in allowed and letter not in detected:
                detected.append(letter)
    return detected


def _question_key(spec: Spec, number: int) -> str:
    return spec.question_key_format.replace("{number}", str(number))


def _intersects(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _rect_has_image(page: Any, rect: tuple[float, float, float, float]) -> bool:
    try:
        blocks = page.get_text("dict").get("blocks", [])
    except Exception:
        return False
    for block in blocks:
        if block.get("type") != 1:
            continue
        bbox = block.get("bbox")
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        image_rect = tuple(float(value) for value in bbox)
        if _intersects(rect, image_rect):
            return True
    return False


def _shared_context_rect(
    page: Any,
    block: tuple[Any, ...],
    first_marker: Marker,
) -> tuple[float, float, float, float]:
    width = float(page.rect.width)
    height = float(page.rect.height)
    bx0, by0, bx1, by1 = map(float, block[:4])
    y0 = max(0.0, by0 - 4)

    if first_marker.page_index > 0:  # overwritten below by caller when pages differ
        pass

    # Quando a primeira questão começa na mesma página e na coluna oposta, o
    # estímulo normalmente ocupa a coluna do cabeçalho até o rodapé útil.
    header_column = 0 if bx0 < width / 2 else 1
    marker_column = 0 if first_marker.x0 < width / 2 else 1
    block_is_wide = (bx1 - bx0) > width * 0.62
    if not block_is_wide and header_column != marker_column:
        if header_column == 0:
            return width * 0.04, y0, width * 0.49, height * PAGE_Y_BOTTOM
        return width * 0.51, y0, width * 0.96, height * PAGE_Y_BOTTOM

    y1 = max(by1 + 12, first_marker.y0 - 4)
    return width * 0.04, y0, width * 0.96, min(height * PAGE_Y_BOTTOM, y1)


def _detect_shared_contexts(
    doc: Any,
    marker_by_number: dict[int, Marker],
    total: int,
) -> list[SharedContext]:
    contexts: list[SharedContext] = []
    seen: set[tuple[int, int, int]] = set()
    for page_index, page in enumerate(doc):
        width = float(page.rect.width)
        height = float(page.rect.height)
        for block in page.get_text("blocks", sort=True):
            text = str(block[4])
            question_range = _shared_question_range(text)
            if not question_range:
                continue
            start, end = question_range
            if start < 1 or end > total or start not in marker_by_number:
                continue
            key = (start, end, page_index)
            if key in seen:
                continue
            seen.add(key)
            first_marker = marker_by_number[start]
            bx0, by0, bx1, by1 = map(float, block[:4])
            y0 = max(0.0, by0 - 4)

            if first_marker.page_index > page_index:
                # Estímulo em página anterior: capture toda a área útil da
                # página desde o cabeçalho; isso inclui texto e imagens.
                rect = (width * 0.04, y0, width * 0.96, height * PAGE_Y_BOTTOM)
            elif first_marker.page_index == page_index:
                rect = _shared_context_rect(page, block, first_marker)
            else:
                continue
            contexts.append(SharedContext(start=start, end=end, page_index=page_index, rect=rect))
    return contexts


def _continuation_regions(
    doc: Any,
    marker: Marker,
    next_marker: Marker | None,
) -> list[tuple[int, tuple[float, float, float, float]]]:
    if not next_marker or next_marker.page_index <= marker.page_index:
        return []
    regions: list[tuple[int, tuple[float, float, float, float]]] = []
    for page_index in range(marker.page_index + 1, next_marker.page_index + 1):
        page = doc[page_index]
        width = float(page.rect.width)
        height = float(page.rect.height)
        y1 = height * PAGE_Y_BOTTOM
        if page_index == next_marker.page_index:
            y1 = min(y1, max(height * 0.04, next_marker.y0 - 4))
        if y1 <= height * 0.04:
            continue
        regions.append(
            (
                page_index,
                (width * PAGE_X0, height * 0.03, width * PAGE_X1, y1),
            )
        )
    return regions


def _text_for_regions(doc: Any, regions: list[tuple[int, tuple[float, float, float, float]]], fitz: Any) -> str:
    pieces: list[str] = []
    for page_index, rect in regions:
        text = doc[page_index].get_text("text", clip=fitz.Rect(*rect), sort=True).strip()
        if text:
            pieces.append(text)
    return "\n".join(pieces)


def build_pack(spec: Spec, pdf_path: Path, output_dir: Path, scale: float = 1.5, quality: int = 82) -> dict[str, Any]:
    fitz, Image = _imports()
    actual_sha = _sha256(pdf_path)
    if actual_sha != spec.source_sha256:
        raise NativePipelineError(
            f"SHA-256 diverge: esperado {spec.source_sha256}, recebido {actual_sha}"
        )

    doc = fitz.open(pdf_path)
    markers = detect_markers(doc, spec.marker_pattern)
    validate_marker_numbers(markers, spec.total)
    marker_by_number = {marker.number: marker for marker in markers}

    pages_dir = output_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    for page_number, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        image.save(
            pages_dir / f"page-{page_number:03d}.webp",
            format="WEBP",
            quality=quality,
            method=4,
        )

    by_page: dict[int, list[Marker]] = {}
    for marker in markers:
        by_page.setdefault(marker.page_index, []).append(marker)
    for page_markers in by_page.values():
        page_markers.sort(key=lambda item: (item.y0, item.x0))

    shared_contexts = _detect_shared_contexts(doc, marker_by_number, spec.total)
    contexts_by_number: dict[int, list[SharedContext]] = {}
    for context in shared_contexts:
        for number in range(context.start, context.end + 1):
            contexts_by_number.setdefault(number, []).append(context)

    questions: list[dict[str, Any]] = []
    multi_region_count = 0
    for number in range(1, spec.total + 1):
        marker = marker_by_number[number]
        page = doc[marker.page_index]
        rect = _draft_rect(marker, page, by_page[marker.page_index])
        primary_regions = [(marker.page_index, rect)]
        primary_text = _text_for_regions(doc, primary_regions, fitz)
        option_ids = _detected_options(primary_text, spec.option_ids)

        # Se a questão não termina antes da próxima página, continue até o
        # próximo marcador oficial e tente completar as alternativas.
        continuation_regions: list[tuple[int, tuple[float, float, float, float]]] = []
        next_marker = marker_by_number.get(number + 1)
        if option_ids != list(spec.option_ids) and next_marker and next_marker.page_index > marker.page_index:
            continuation_regions = _continuation_regions(doc, marker, next_marker)
            combined_text = "\n".join(
                part
                for part in [primary_text, _text_for_regions(doc, continuation_regions, fitz)]
                if part
            )
            option_ids = _detected_options(combined_text, spec.option_ids)
        else:
            combined_text = primary_text

        visual_regions: list[dict[str, Any]] = []
        for context in contexts_by_number.get(number, []):
            context_page = doc[context.page_index]
            visual_regions.append(
                {
                    "page": context.page_index + 1,
                    "role": "shared-context",
                    "rect": _normalized_rect(context.rect, context_page),
                }
            )
        visual_regions.append(
            {
                "page": marker.page_index + 1,
                "role": "question",
                "rect": _normalized_rect(rect, page),
            }
        )
        for page_index, continuation_rect in continuation_regions:
            visual_regions.append(
                {
                    "page": page_index + 1,
                    "role": "continuation",
                    "rect": _normalized_rect(continuation_rect, doc[page_index]),
                }
            )
        if len(visual_regions) > 1:
            multi_region_count += 1

        reasons = _visual_dependency_reasons(combined_text)
        has_shared = bool(contexts_by_number.get(number))
        has_continuation = bool(continuation_regions)
        has_image = any(
            _rect_has_image(doc[page_index], region_rect)
            for page_index, region_rect in [*primary_regions, *continuation_regions]
        )

        required = bool(reasons or has_shared or has_continuation)
        unresolved_reasons: list[str] = []
        context_reasons = [reason for reason in reasons if reason.startswith("context:")]
        media_reasons = [reason for reason in reasons if reason.startswith("media:")]
        if context_reasons and not has_shared:
            unresolved_reasons.extend(context_reasons)
        if media_reasons and not has_image and not has_shared:
            unresolved_reasons.extend(media_reasons)
        if option_ids != list(spec.option_ids):
            unresolved_reasons.append("options:incomplete")

        resolved = not unresolved_reasons
        if has_shared:
            strategy = "shared-context"
        elif has_continuation:
            strategy = "continuation"
        elif required and resolved:
            strategy = "question-region"
        elif required:
            strategy = "manual"
        else:
            strategy = "not-required"

        issues: list[str] = []
        if option_ids != list(spec.option_ids):
            issues.append(
                "alternativas semânticas não foram reconhecidas integralmente; revisar extensão visual"
            )
        if unresolved_reasons:
            issues.append(
                "dependência visual/contextual não resolvida automaticamente: "
                + ", ".join(dict.fromkeys(unresolved_reasons))
            )
        confidence = 1.0 if not issues else 0.65

        questions.append(
            {
                "questionKey": _question_key(spec, number),
                "providerId": spec.provider_id,
                "year": spec.year,
                **({"editionId": spec.edition_id} if spec.edition_id else {}),
                "phase": spec.phase,
                "number": number,
                "documentId": spec.document_id,
                "visualRegions": visual_regions,
                "semantic": {"rawText": combined_text},
                "extraction": {
                    "method": "text-layer",
                    "parserVersion": PARSER_VERSION,
                    "confidence": confidence,
                    "markerDetected": True,
                    "optionIdsDetected": option_ids,
                    "issues": issues,
                    "visualCompleteness": {
                        "required": required,
                        "resolved": resolved,
                        "reasons": list(dict.fromkeys(reasons + unresolved_reasons)),
                        "strategy": strategy,
                    },
                },
                # O extrator nunca se autoaprova. O ZIP publisher autoaprova
                # somente os itens sem issues e com todos os gates satisfeitos.
                "status": "review",
            }
        )

    page_asset_pattern = (
        f"native/{spec.provider_id}/{spec.edition_id or spec.year}/{spec.phase}/page-{{page:03d}}.webp"
    )
    pack = {
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "documents": [
            {
                "documentId": spec.document_id,
                "providerId": spec.provider_id,
                "year": spec.year,
                **({"editionId": spec.edition_id} if spec.edition_id else {}),
                "phase": spec.phase,
                "sourceUrl": spec.source_url,
                "sourceSha256": actual_sha,
                "sourceBytes": pdf_path.stat().st_size,
                "pageCount": len(doc),
                "pageAssetPattern": page_asset_pattern,
                "renderScale": scale,
                "imageFormat": "webp",
            }
        ],
        "questions": questions,
        "reviewSummary": {
            "markers": len(markers),
            "expected": spec.total,
            "semanticReady": sum(1 for q in questions if not q["extraction"]["issues"]),
            "sharedContextGroups": len(shared_contexts),
            "multiRegionQuestions": multi_region_count,
            "visualComplete": sum(
                1 for q in questions if q["extraction"]["visualCompleteness"]["resolved"]
            ),
            "needsReview": sum(1 for q in questions if q["extraction"]["issues"]),
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "native-pack.json").write_text(
        json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return pack


def main() -> int:
    parser = argparse.ArgumentParser(description="Gera NativePack v2 verificável a partir de PDF objetivo.")
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--scale", type=float, default=1.5)
    parser.add_argument("--quality", type=int, default=82)
    args = parser.parse_args()

    spec = _load_spec(args.spec)
    pack = build_pack(spec, args.pdf, args.out, args.scale, args.quality)
    summary = pack["reviewSummary"]
    print(
        f"{spec.document_id}: {summary['markers']}/{summary['expected']} marcadores; "
        f"{summary['visualComplete']} completos; {summary['sharedContextGroups']} contextos compartilhados; "
        f"{summary['needsReview']} para revisão."
    )
    print(f"Pack: {args.out / 'native-pack.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
