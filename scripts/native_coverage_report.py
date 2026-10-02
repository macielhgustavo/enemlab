#!/usr/bin/env python3
"""Markdown coverage report for local NativePack fleet state.

The report is intentionally local-only. It reads the audited native inventory
and any NativePack/runtime artifacts already present under `.native-out`; when
runtime data is absent it marks the edition as pending instead of inventing
coverage numbers.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import native_ingest

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NATIVE_ROOT = ROOT / ".native-out"
FAILURE_CATEGORIES = (
    "source",
    "missing-markers",
    "duplicate-markers",
    "layout",
    "validation",
    "prepare",
)
FLEET_STATES = {"healthy", "degraded", "unavailable", "pending"}


@dataclass(frozen=True)
class CoverageRow:
    provider: str
    edition: str
    phase: str
    fleet_state: str
    renderable: int | None
    total: int | None
    failure_category: str | None
    detail: str


def _edition_of(target: Any) -> str:
    return str(getattr(target, "edition_id", None) or getattr(target, "year"))


def _target_output_dir(target: Any, native_root: Path) -> Path:
    return native_root / str(target.provider_id) / _edition_of(target) / str(target.phase)


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _valid_rect(rect: dict[str, Any]) -> bool:
    try:
        x = float(rect["x"])
        y = float(rect["y"])
        width = float(rect["width"])
        height = float(rect["height"])
    except (KeyError, TypeError, ValueError):
        return False
    return (
        0 <= x <= 1
        and 0 <= y <= 1
        and 0 < width <= 1
        and 0 < height <= 1
        and x + width <= 1.000001
        and y + height <= 1.000001
    )


def _document_for(pack: dict[str, Any], question: dict[str, Any]) -> dict[str, Any] | None:
    documents = {
        str(document.get("documentId")): document
        for document in pack.get("documents") or []
        if isinstance(document, dict)
    }
    return documents.get(str(question.get("documentId")))


def _question_layout_issues(pack: dict[str, Any], question: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    document = _document_for(pack, question)
    if not document:
        issues.append("documento nativo ausente")
        return issues

    regions = question.get("visualRegions") or []
    if not regions:
        issues.append("sem região visual")
    page_count = int(document.get("pageCount") or 0)
    for region in regions:
        rect = region.get("rect") or {}
        page = int(region.get("page") or 0)
        if page < 1 or page > page_count or not _valid_rect(rect):
            issues.append("região visual inválida")
            break

    extraction = question.get("extraction") or {}
    if not extraction.get("markerDetected"):
        issues.append("marcador da questão não confirmado")
    completeness = extraction.get("visualCompleteness") or {}
    if completeness:
        if completeness.get("required") and not completeness.get("resolved"):
            issues.append("dependência visual/contextual não resolvida")
        strategy = completeness.get("strategy")
        roles = {str(region.get("role") or "") for region in regions}
        if strategy == "shared-context" and "shared-context" not in roles:
            issues.append("contexto compartilhado declarado sem região correspondente")
        if strategy == "continuation" and "continuation" not in roles:
            issues.append("continuação declarada sem região correspondente")
    elif str(extraction.get("parserVersion") or "").startswith("native-pipeline@2"):
        issues.append("pipeline v2 sem evidência de completude visual")

    return issues


def _renderable_count(pack: dict[str, Any]) -> int:
    return sum(
        1
        for question in pack.get("questions") or []
        if isinstance(question, dict) and not _question_layout_issues(pack, question)
    )


def _pack_total(pack: dict[str, Any], fallback: int | None) -> int | None:
    summary = pack.get("reviewSummary") or {}
    expected = summary.get("expected")
    if isinstance(expected, int):
        return expected
    questions = pack.get("questions")
    if isinstance(questions, list):
        return len(questions)
    return fallback


def _category_from_text(text: str) -> str:
    lowered = text.lower()
    if re.search(r"ocr|pymupdf|pillow|prepar|prepare|parser|depend[eê]ncia", lowered):
        return "prepare"
    if re.search(r"url|fonte|caderno|pdf|html|download|http|sha|tls", lowered):
        return "source"
    if re.search(r"faltante|faltantes|missing", lowered):
        return "missing-markers"
    if re.search(r"duplicad|duplicate", lowered):
        return "duplicate-markers"
    if re.search(r"regi[aã]o|layout|visual|completude|contextual|crop", lowered):
        return "layout"
    if re.search(r"questionkey|identidade|alternativa|a-e|gabarito|valida", lowered):
        return "validation"
    return "prepare"


def _pack_failure_category(pack: dict[str, Any], renderable: int, total: int | None) -> tuple[str | None, str]:
    summary = pack.get("reviewSummary") or {}
    markers = summary.get("markers")
    expected = summary.get("expected")
    if isinstance(markers, int) and isinstance(expected, int):
        if markers < expected:
            return "missing-markers", f"{markers}/{expected} marcadores"
        if markers > expected:
            return "duplicate-markers", f"{markers}/{expected} marcadores"

    for question in pack.get("questions") or []:
        if not isinstance(question, dict):
            continue
        issues = _question_layout_issues(pack, question)
        if issues:
            return "layout", f"Q{question.get('number', '?')}: {issues[0]}"
        extraction_issues = (question.get("extraction") or {}).get("issues") or []
        if extraction_issues:
            text = str(extraction_issues[0])
            return _category_from_text(text), f"Q{question.get('number', '?')}: {text}"

    if total is not None and renderable < total:
        return "prepare", f"{renderable}/{total} questões renderizáveis"
    return None, ""


def _health_state(health: dict[str, Any] | None) -> str | None:
    if not health:
        return None
    status = str(health.get("status") or "").lower()
    return status if status in FLEET_STATES else None


def coverage_row_for_target(target: Any, native_root: Path = DEFAULT_NATIVE_ROOT) -> CoverageRow:
    output_dir = _target_output_dir(target, native_root)
    pack = _read_json(output_dir / "native-pack.json")
    health = _read_json(output_dir / "health.json")
    total = int(getattr(target, "total")) if getattr(target, "total", None) is not None else None

    if pack is None:
        category = None
        detail = "sem NativePack local; aguardando preparo/publicação"
        state = "pending"
        if getattr(target, "status", None) != "ready":
            detail = str(getattr(target, "reason", None) or "alvo indisponível")
            category = _category_from_text(detail)
            state = "unavailable"
        return CoverageRow(
            provider=str(target.provider_id),
            edition=_edition_of(target),
            phase=str(target.phase),
            fleet_state=state,
            renderable=None,
            total=total,
            failure_category=category,
            detail=detail,
        )

    renderable = _renderable_count(pack)
    total = _pack_total(pack, total)
    category, detail = _pack_failure_category(pack, renderable, total)
    state = _health_state(health)
    if state is None:
        state = "healthy" if category is None and total is not None and renderable == total else "degraded"
    return CoverageRow(
        provider=str(target.provider_id),
        edition=_edition_of(target),
        phase=str(target.phase),
        fleet_state=state,
        renderable=renderable,
        total=total,
        failure_category=category,
        detail=detail or "NativePack local renderizável",
    )


def build_rows(targets: Iterable[Any], native_root: Path = DEFAULT_NATIVE_ROOT) -> list[CoverageRow]:
    return [
        coverage_row_for_target(target, native_root)
        for target in sorted(
            targets,
            key=lambda item: (
                str(item.provider_id),
                -int(getattr(item, "year", 0) or 0),
                _edition_of(item),
                str(item.phase),
            ),
        )
    ]


def _cell(value: object) -> str:
    text = "—" if value is None or value == "" else str(value)
    return text.replace("|", "\\|").replace("\n", " ")


def render_markdown(rows: list[CoverageRow]) -> str:
    lines = [
        "# Cobertura nativa por provider",
        "",
        "> Relatório local: usa inventário/manifests/catálogo versionados e NativePacks já presentes em `.native-out`. Sem dados de runtime/publicação no repositório, edições preparáveis ficam como `pending` e não recebem números inventados de renderização.",
        "",
        "| Provider | Edição | Fase | Fleet | Renderizáveis | Falha | Detalhe |",
        "| --- | --- | --- | --- | ---: | --- | --- |",
    ]
    for row in rows:
        renderable = "—" if row.renderable is None else f"{row.renderable}/{row.total if row.total is not None else '?'}"
        lines.append(
            "| "
            + " | ".join(
                [
                    _cell(row.provider),
                    _cell(row.edition),
                    _cell(row.phase),
                    _cell(row.fleet_state),
                    _cell(renderable),
                    _cell(row.failure_category),
                    _cell(row.detail),
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Gera relatório markdown de cobertura nativa local.")
    parser.add_argument("--native-root", type=Path, default=DEFAULT_NATIVE_ROOT)
    parser.add_argument("--out", type=Path, help="grava o relatório em arquivo; sem isto imprime em stdout")
    args = parser.parse_args(argv)

    rows = build_rows(native_ingest.discover_targets(), args.native_root)
    markdown = render_markdown(rows)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(markdown, encoding="utf-8")
    else:
        sys.stdout.write(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
