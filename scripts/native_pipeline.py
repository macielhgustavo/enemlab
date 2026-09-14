#!/usr/bin/env python3
"""Pipeline local para transformar uma prova objetiva em um NativePack revisável.

O script deliberadamente NÃO publica nada. Ele gera WebP por página + um
manifest JSON pequeno. O operador revisa o pack e só então uma etapa separada
pode enviá-lo ao armazenamento privado.

Dependências opcionais de execução:
  python -m pip install pymupdf pillow
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_MARKER = r"QUEST(?:ÃO|AO)\s*[\u2000-\u200f\s]*0?(\d{1,3})"
PARSER_VERSION = "native-pipeline@1.0.0"


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
    return Spec(
        provider_id=str(raw["providerId"]),
        year=int(raw["year"]),
        phase=str(raw["phase"]),
        edition_id=str(raw["editionId"]) if raw.get("editionId") else None,
        total=total,
        option_ids=option_ids,
        source_sha256=sha,
        source_url=str(raw["sourceUrl"]),
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
            text = block[4]
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


def _column(marker: Marker, page_width: float, two_columns: bool) -> int:
    if not two_columns:
        return 0
    return 0 if marker.x0 < page_width / 2 else 1


def _draft_rect(marker: Marker, page: Any, page_markers: list[Marker]) -> tuple[float, float, float, float]:
    width = float(page.rect.width)
    height = float(page.rect.height)
    x_positions = [candidate.x0 for candidate in page_markers]
    two_columns = bool(x_positions) and max(x_positions) - min(x_positions) > width * 0.25
    column = _column(marker, width, two_columns)
    same_column = sorted(
        [
            candidate
            for candidate in page_markers
            if candidate.y0 > marker.y0 and _column(candidate, width, two_columns) == column
        ],
        key=lambda candidate: candidate.y0,
    )
    y1 = same_column[0].y0 - 4 if same_column else height - 24
    if two_columns:
        if column == 0:
            x0, x1 = width * 0.06, width * 0.49
        else:
            x0, x1 = width * 0.51, width * 0.94
    else:
        x0, x1 = width * 0.06, width * 0.94
    y0 = max(0.0, marker.y0 - 4)
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
    detected = []
    for letter in re.findall(r"\(([A-E])\)", text.upper()):
        if letter in allowed and letter not in detected:
            detected.append(letter)
    return detected


def _question_key(spec: Spec, number: int) -> str:
    edition = spec.edition_id or str(spec.year)
    return "-".join([spec.provider_id, edition, spec.phase, str(number)])


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

    questions = []
    for number in range(1, spec.total + 1):
        marker = marker_by_number[number]
        page = doc[marker.page_index]
        rect = _draft_rect(marker, page, by_page[marker.page_index])
        raw_text = page.get_text("text", clip=fitz.Rect(*rect), sort=True).strip()
        option_ids = _detected_options(raw_text, spec.option_ids)
        issues: list[str] = []
        if option_ids != list(spec.option_ids):
            issues.append(
                "alternativas semânticas não foram reconhecidas integralmente; usar visual canônico e revisar texto"
            )
        confidence = 1.0 if not issues else 0.75
        questions.append(
            {
                "questionKey": _question_key(spec, number),
                "providerId": spec.provider_id,
                "year": spec.year,
                **({"editionId": spec.edition_id} if spec.edition_id else {}),
                "phase": spec.phase,
                "number": number,
                "documentId": spec.document_id,
                "visualRegions": [
                    {
                        "page": marker.page_index + 1,
                        "role": "question",
                        "rect": _normalized_rect(rect, page),
                    }
                ],
                "semantic": {"rawText": raw_text},
                "extraction": {
                    "method": "text-layer",
                    "parserVersion": PARSER_VERSION,
                    "confidence": confidence,
                    "markerDetected": True,
                    "optionIdsDetected": option_ids,
                    "issues": issues,
                },
                # O extrator nunca se autoaprova: revisão humana decide publicação.
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
            "needsReview": sum(1 for q in questions if q["extraction"]["issues"]),
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "native-pack.json").write_text(
        json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return pack


def main() -> int:
    parser = argparse.ArgumentParser(description="Gera NativePack revisável a partir de PDF objetivo.")
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
        f"{summary['semanticReady']} semânticas prontas; {summary['needsReview']} para revisão."
    )
    print(f"Pack: {args.out / 'native-pack.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
