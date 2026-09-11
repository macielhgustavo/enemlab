#!/usr/bin/env python3
"""Extrai candidatos de mídia de cadernos FUVEST sem publicar nada.

O script consome um ``enemlab-extraction/v1`` já ligado por SHA-256 ao PDF da
prova, usa a geometria nativa do PDF (imagens + desenhos vetoriais), recorta
somente regiões visuais relevantes e produz ``enemlab-media/v1``.

Associação automática só ocorre quando o início da questão pode ser localizado
na própria camada textual e o candidato visual cai inequivocamente dentro da
região daquela questão. Casos ambíguos ficam ``association=review``. Por padrão,
nenhum asset limpa ``questionsMissingMedia``: detectar uma figura não prova que
toda a dependência visual da questão foi recuperada.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

PROTOCOL_VERSION = "enemlab-media/v1"
EXTRACTION_PROTOCOL_VERSION = "enemlab-extraction/v1"
EXTRACTOR_NAME = "fuvest-pdf-media"
EXTRACTOR_VERSION = "fuvest-pdf-media@0.1.0"


@dataclass(frozen=True)
class Rect:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return max(0.0, self.x1 - self.x0)

    @property
    def height(self) -> float:
        return max(0.0, self.y1 - self.y0)

    @property
    def area(self) -> float:
        return self.width * self.height

    @property
    def center_y(self) -> float:
        return (self.y0 + self.y1) / 2

    def expanded(self, amount: float) -> "Rect":
        return Rect(self.x0 - amount, self.y0 - amount, self.x1 + amount, self.y1 + amount)

    def union(self, other: "Rect") -> "Rect":
        return Rect(
            min(self.x0, other.x0),
            min(self.y0, other.y0),
            max(self.x1, other.x1),
            max(self.y1, other.y1),
        )

    def intersects(self, other: "Rect") -> bool:
        return not (
            self.x1 < other.x0
            or other.x1 < self.x0
            or self.y1 < other.y0
            or other.y1 < self.y0
        )


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "enemlab-ingest/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.lower())
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    value = re.sub(r"\s+", " ", value)
    return re.sub(r"[^a-z0-9 ]+", "", value).strip()


def statement_probe(statement: str, max_words: int = 8) -> str:
    words = normalize_text(statement).split()
    return " ".join(words[:max_words])


def rect_from_bbox(value: Iterable[float]) -> Rect:
    x0, y0, x1, y1 = [float(item) for item in value]
    return Rect(x0, y0, x1, y1)


def rect_distance(left: Rect, right: Rect) -> float:
    dx = max(left.x0 - right.x1, right.x0 - left.x1, 0.0)
    dy = max(left.y0 - right.y1, right.y0 - left.y1, 0.0)
    return math.hypot(dx, dy)


def cluster_rectangles(rectangles: list[Rect], gap: float = 8.0) -> list[Rect]:
    """Agrupa partes próximas do mesmo gráfico/figura sem unir a página inteira."""
    remaining = rectangles[:]
    clusters: list[Rect] = []
    while remaining:
        cluster = remaining.pop(0)
        changed = True
        while changed:
            changed = False
            keep: list[Rect] = []
            for candidate in remaining:
                if cluster.expanded(gap).intersects(candidate) or rect_distance(cluster, candidate) <= gap:
                    cluster = cluster.union(candidate)
                    changed = True
                else:
                    keep.append(candidate)
            remaining = keep
        clusters.append(cluster)
    return sorted(clusters, key=lambda rect: (rect.y0, rect.x0))


def page_text_blocks(page: Any) -> list[tuple[Rect, str]]:
    blocks: list[tuple[Rect, str]] = []
    for block in page.get_text("blocks"):
        if len(block) < 5:
            continue
        text = str(block[4] or "").strip()
        if not text:
            continue
        blocks.append((rect_from_bbox(block[:4]), text))
    return blocks


def locate_question_start(page: Any, statement: str) -> float | None:
    probe = statement_probe(statement)
    if not probe:
        return None

    # Start with a short exact-ish textual probe. This survives most line wraps.
    words = probe.split()
    probes = [" ".join(words[:count]) for count in range(min(len(words), 8), 3, -1)]
    normalized_blocks = [(rect, normalize_text(text)) for rect, text in page_text_blocks(page)]
    for candidate in probes:
        matches = [rect for rect, text in normalized_blocks if candidate and candidate in text]
        if len(matches) == 1:
            return matches[0].y0
    return None


def question_regions_for_page(
    page_number: int,
    page: Any,
    questions: list[dict[str, Any]],
) -> list[tuple[int, float, float, bool]]:
    """Retorna (questão, y0, y1, boundary_confident)."""
    page_height = float(page.rect.height)
    starts: list[tuple[int, float, bool]] = []

    starting = sorted(
        [question for question in questions if question.get("page") == page_number],
        key=lambda question: int(question["number"]),
    )
    for question in starting:
        statement = str(question.get("statement") or "")
        y = locate_question_start(page, statement)
        if y is not None:
            starts.append((int(question["number"]), y, True))

    # If a question started on an earlier page and no newer question has started
    # before this page, it owns the top continuation region.
    previous = [
        question
        for question in questions
        if isinstance(question.get("page"), int) and int(question["page"]) < page_number
    ]
    if previous:
        previous_number = max(previous, key=lambda question: int(question["number"]))["number"]
        next_numbers = [int(question["number"]) for question in starting]
        if not next_numbers or int(previous_number) < min(next_numbers):
            starts.append((int(previous_number), 0.0, False))

    starts.sort(key=lambda item: item[1])
    regions: list[tuple[int, float, float, bool]] = []
    for index, (number, y0, confident) in enumerate(starts):
        y1 = starts[index + 1][1] if index + 1 < len(starts) else page_height
        if y1 - y0 >= 8:
            regions.append((number, y0, y1, confident))
    return regions


def visual_rectangles(page: Any) -> list[Rect]:
    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    rectangles: list[Rect] = []

    for image in page.get_image_info(xrefs=True):
        bbox = image.get("bbox")
        if not bbox:
            continue
        rect = rect_from_bbox(bbox)
        if rect.width >= 12 and rect.height >= 10 and rect.area >= 180:
            rectangles.append(rect)

    for drawing in page.get_drawings():
        raw = drawing.get("rect")
        if raw is None:
            continue
        rect = Rect(float(raw.x0), float(raw.y0), float(raw.x1), float(raw.y1))
        # Thin separators, page frames and tiny glyph-like drawings are not media.
        if rect.width < 12 or rect.height < 7 or rect.area < 180:
            continue
        if rect.width > page_width * 0.93 and rect.height > page_height * 0.85:
            continue
        rectangles.append(rect)

    # Ignore headers/footers and impossible page-sized clusters.
    filtered = [
        rect
        for rect in rectangles
        if rect.y1 > 45
        and rect.y0 < page_height - 30
        and rect.width < page_width * 0.96
        and rect.height < page_height * 0.92
    ]
    return cluster_rectangles(filtered)


def choose_region(
    rect: Rect,
    regions: list[tuple[int, float, float, bool]],
) -> tuple[int | None, float, str]:
    matches = [region for region in regions if region[1] <= rect.center_y < region[2]]
    if len(matches) != 1:
        return None, 0.0, "review"
    number, y0, y1, confident = matches[0]
    contained = rect.y0 >= y0 - 4 and rect.y1 <= y1 + 4
    if confident and contained:
        return number, 0.995, "automatic"
    return number, 0.80, "review"


def render_crop(page: Any, rect: Rect, scale: float = 2.0) -> bytes:
    import fitz

    clip = fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y1)
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
    return pix.tobytes("png")


def verify_extraction_envelope(envelope: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
    if envelope.get("protocolVersion") != EXTRACTION_PROTOCOL_VERSION:
        raise ValueError("input must be enemlab-extraction/v1")
    identity = envelope.get("identity")
    extraction = envelope.get("extraction")
    if not isinstance(identity, dict) or not isinstance(extraction, dict):
        raise ValueError("extraction envelope identity/extraction is missing")
    questions = extraction.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError("extraction envelope has no questions")

    source_urls = {
        str(question.get("sourceDocumentUrl"))
        for question in questions
        if question.get("sourceDocumentUrl")
    }
    if len(source_urls) != 1:
        raise ValueError("cannot identify exactly one objective exam document")
    exam_url = next(iter(source_urls))

    documents = envelope.get("documents")
    if not isinstance(documents, list):
        raise ValueError("extraction envelope has no document binding")
    matching = [document for document in documents if document.get("url") == exam_url]
    if len(matching) != 1 or not re.fullmatch(r"[0-9a-fA-F]{64}", str(matching[0].get("sha256", ""))):
        raise ValueError("objective exam SHA-256 binding is missing")
    return extraction, exam_url, str(matching[0]["sha256"]).lower()


def build_media_manifest(
    envelope: dict[str, Any],
    pdf_bytes: bytes,
    media_dir: Path,
    public_prefix: str,
) -> dict[str, Any]:
    import fitz

    extraction, exam_url, expected_sha = verify_extraction_envelope(envelope)
    actual_sha = sha256_bytes(pdf_bytes)
    if actual_sha != expected_sha:
        raise ValueError("objective exam bytes do not match extraction envelope SHA-256")

    identity = envelope["identity"]
    questions = extraction["questions"]
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    media_dir.mkdir(parents=True, exist_ok=True)
    assets: list[dict[str, Any]] = []
    warnings: list[str] = []
    per_question_index: dict[int, int] = {}

    for page_index in range(doc.page_count):
        page_number = page_index + 1
        page = doc[page_index]
        regions = question_regions_for_page(page_number, page, questions)
        candidates = visual_rectangles(page)
        if candidates and not regions:
            warnings.append(
                f"página {page_number}: {len(candidates)} candidato(s) visuais sem região de questão confiável"
            )

        for rect in candidates:
            question_number, confidence, association = choose_region(rect, regions)
            if question_number is None:
                question_token = f"p{page_number:03d}"
                ordinal = sum(1 for asset in assets if asset["page"] == page_number) + 1
            else:
                per_question_index[question_number] = per_question_index.get(question_number, 0) + 1
                ordinal = per_question_index[question_number]
                question_token = f"q{question_number:03d}"

            filename = f"{question_token}-media-{ordinal:02d}.png"
            output_path = media_dir / filename
            png = render_crop(page, rect)
            output_path.write_bytes(png)
            asset_id = f"{identity['editionId']}-{question_token}-{ordinal:02d}"
            public_path = f"{public_prefix.rstrip('/')}/{filename}"

            assets.append(
                {
                    "id": asset_id,
                    "path": public_path,
                    "sha256": sha256_bytes(png),
                    "mimeType": "image/png",
                    "sourceDocumentUrl": exam_url,
                    "page": page_number,
                    "bbox": {
                        "x": round(rect.x0, 2),
                        "y": round(rect.y0, 2),
                        "width": round(rect.width, 2),
                        "height": round(rect.height, 2),
                    },
                    **({"questionNumber": question_number} if question_number is not None else {}),
                    "confidence": confidence,
                    "association": association,
                    "resolvesMissingMedia": False,
                }
            )

    return {
        "protocolVersion": PROTOCOL_VERSION,
        "providerId": identity["providerId"],
        "sourceId": identity["sourceId"],
        "editionId": identity["editionId"],
        "extractor": {"name": EXTRACTOR_NAME, "version": EXTRACTOR_VERSION},
        "document": {"url": exam_url, "sha256": actual_sha},
        "assets": assets,
        "warnings": warnings,
    }


def metrics(manifest: dict[str, Any]) -> dict[str, int]:
    assets = manifest["assets"]
    return {
        "assets": len(assets),
        "automatic": sum(asset.get("association") == "automatic" for asset in assets),
        "review": sum(asset.get("association") == "review" for asset in assets),
        "questionsWithAutomaticMedia": len(
            {
                int(asset["questionNumber"])
                for asset in assets
                if asset.get("association") == "automatic" and asset.get("questionNumber")
            }
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extraction", required=True, type=Path)
    parser.add_argument("--exam-pdf", type=Path)
    parser.add_argument("--media-dir", required=True, type=Path)
    parser.add_argument("--manifest-output", required=True, type=Path)
    parser.add_argument("--public-prefix", default="/ingestion-media")
    parser.add_argument("--metrics", action="store_true")
    args = parser.parse_args(argv)

    envelope = json.loads(args.extraction.read_text(encoding="utf-8"))
    _, exam_url, _ = verify_extraction_envelope(envelope)
    pdf_bytes = args.exam_pdf.read_bytes() if args.exam_pdf else fetch(exam_url)
    manifest = build_media_manifest(envelope, pdf_bytes, args.media_dir, args.public_prefix)
    args.manifest_output.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if args.metrics:
        print(json.dumps(metrics(manifest), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"erro: {error}", file=sys.stderr)
        raise SystemExit(1)
