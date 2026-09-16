#!/usr/bin/env python3
"""Detecção geométrica de questões a partir de grupos ordenados de alternativas.

Este módulo existe para provas em que o número da questão não é extraído de
forma confiável, mas as alternativas A..E mantêm estrutura visual estável. Ele
não interpreta enunciados nem matemática: aprende o estilo tipográfico
dominante dos rótulos de alternativas e exige exatamente N grupos completos,
em ordem visual, antes de produzir qualquer marcador sintético.

Qualquer ambiguidade de quantidade falha fechado.
"""

from __future__ import annotations

import collections
import re
from dataclasses import dataclass
from typing import Any, Callable


class OrderedOptionMarkerError(ValueError):
    pass


@dataclass(frozen=True)
class OptionLabel:
    page_index: int
    block_index: int
    letter: str
    x0: float
    y0: float
    x1: float
    y1: float
    font: str
    size: float


@dataclass(frozen=True)
class OptionGroup:
    page_index: int
    kind: str
    x0: float
    y0: float
    x1: float
    y1: float


_TOKEN_RE = re.compile(r"^\s*[\[(]?([A-Ea-e])[\])\.:;-]?\s*$")
_INLINE_RE = re.compile(r"(?m)^\s*[\[(]?([A-Ea-e])[\])\.:;-]\s+")


def _collect(doc: Any) -> tuple[list[OptionLabel], list[dict[str, Any]]]:
    labels: list[OptionLabel] = []
    blocks: list[dict[str, Any]] = []
    for page_index, page in enumerate(doc):
        data = page.get_text("dict", sort=True)
        for block_index, block in enumerate(data.get("blocks", [])):
            bbox = tuple(float(value) for value in block.get("bbox", (0, 0, 0, 0)))
            raw_lines: list[str] = []
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                raw_lines.append("".join(str(span.get("text", "")) for span in spans))
                if not spans:
                    continue
                first = spans[0]
                match = _TOKEN_RE.fullmatch(str(first.get("text", "")).strip())
                if not match:
                    continue
                x0, y0, x1, y1 = map(float, first["bbox"])
                labels.append(
                    OptionLabel(
                        page_index=page_index,
                        block_index=block_index,
                        letter=match.group(1).upper(),
                        x0=x0,
                        y0=y0,
                        x1=x1,
                        y1=y1,
                        font=str(first.get("font", "")),
                        size=round(float(first.get("size", 0)), 1),
                    )
                )
            raw = "\n".join(raw_lines)
            inline = [value.upper() for value in _INLINE_RE.findall(raw)]
            if inline:
                blocks.append(
                    {
                        "page_index": page_index,
                        "block_index": block_index,
                        "letters": inline,
                        "bbox": bbox,
                    }
                )
    return labels, blocks


def _horizontal_groups(
    labels: list[OptionLabel], option_ids: tuple[str, ...]
) -> tuple[list[OptionGroup], set[int]]:
    groups: list[OptionGroup] = []
    used: set[int] = set()
    by_page: dict[int, list[tuple[int, OptionLabel]]] = collections.defaultdict(list)
    for index, label in enumerate(labels):
        by_page[label.page_index].append((index, label))

    for page_index, page_labels in by_page.items():
        remaining = sorted(page_labels, key=lambda item: (item[1].y0, item[1].x0))
        while remaining:
            seed_index, seed = remaining.pop(0)
            same_y = [(seed_index, seed)]
            keep: list[tuple[int, OptionLabel]] = []
            for item in remaining:
                if abs(item[1].y0 - seed.y0) <= 4.5:
                    same_y.append(item)
                else:
                    keep.append(item)
            remaining = keep
            ordered = sorted(same_y, key=lambda item: item[1].x0)
            if [item[1].letter for item in ordered] != list(option_ids):
                continue
            ids = [item[0] for item in ordered]
            used.update(ids)
            groups.append(
                OptionGroup(
                    page_index=page_index,
                    kind="horizontal",
                    x0=min(item[1].x0 for item in ordered),
                    y0=min(item[1].y0 for item in ordered),
                    x1=max(item[1].x1 for item in ordered),
                    y1=max(item[1].y1 for item in ordered),
                )
            )
    return groups, used


def _vertical_groups(
    labels: list[OptionLabel], option_ids: tuple[str, ...], used: set[int]
) -> list[OptionGroup]:
    groups: list[OptionGroup] = []
    by_page: dict[int, list[tuple[int, OptionLabel]]] = collections.defaultdict(list)
    for index, label in enumerate(labels):
        if index not in used:
            by_page[label.page_index].append((index, label))

    for page_index, page_labels in by_page.items():
        candidates = sorted(page_labels, key=lambda item: (item[1].y0, item[1].x0))
        for index, label in candidates:
            if index in used or label.letter != option_ids[0]:
                continue
            sequence = [(index, label)]
            current = label
            for expected in option_ids[1:]:
                choices = [
                    (candidate_index, candidate)
                    for candidate_index, candidate in candidates
                    if candidate_index not in used
                    and candidate_index != index
                    and candidate.letter == expected
                    and candidate.y0 > current.y0 + 2
                    and candidate.y0 - current.y0 <= 60
                    and abs(candidate.x0 - label.x0) <= 12
                ]
                if not choices:
                    sequence = []
                    break
                chosen = min(choices, key=lambda item: item[1].y0)
                sequence.append(chosen)
                current = chosen[1]
            if len(sequence) != len(option_ids):
                continue
            ids = [item[0] for item in sequence]
            used.update(ids)
            groups.append(
                OptionGroup(
                    page_index=page_index,
                    kind="vertical",
                    x0=min(item[1].x0 for item in sequence),
                    y0=min(item[1].y0 for item in sequence),
                    x1=max(item[1].x1 for item in sequence),
                    y1=max(item[1].y1 for item in sequence),
                )
            )
    return groups


def _block_fallback_groups(
    blocks: list[dict[str, Any]],
    groups: list[OptionGroup],
    option_ids: tuple[str, ...],
) -> list[OptionGroup]:
    fallback: list[OptionGroup] = []
    for block in blocks:
        seen: list[str] = []
        for letter in block["letters"]:
            if not seen or seen[-1] != letter:
                seen.append(letter)
        if seen != list(option_ids):
            continue
        bx0, by0, bx1, by1 = block["bbox"]
        overlaps = any(
            group.page_index == block["page_index"]
            and max(0.0, min(group.y1, by1) - max(group.y0, by0)) > 2
            for group in [*groups, *fallback]
        )
        if overlaps:
            continue
        fallback.append(
            OptionGroup(
                page_index=int(block["page_index"]),
                kind="block",
                x0=float(bx0),
                y0=float(by0),
                x1=float(bx1),
                y1=float(by1),
            )
        )
    return fallback


def detect_ordered_option_groups(
    doc: Any,
    option_ids: tuple[str, ...],
    total: int,
) -> list[OptionGroup]:
    if tuple(option_ids) != tuple(sorted(option_ids)):
        raise OrderedOptionMarkerError("alternativas precisam estar em ordem canônica")
    if len(option_ids) < 3:
        raise OrderedOptionMarkerError("estratégia exige pelo menos três alternativas")

    labels, blocks = _collect(doc)
    if not labels:
        raise OrderedOptionMarkerError("nenhum rótulo de alternativa detectado")

    styles = collections.Counter((label.font, label.size) for label in labels)
    dominant_style, dominant_count = styles.most_common(1)[0]
    minimum_style_evidence = max(len(option_ids) * 2, int(total * len(option_ids) * 0.6))
    if dominant_count < minimum_style_evidence:
        raise OrderedOptionMarkerError(
            f"estilo de alternativa sem evidência suficiente: {dominant_count}/{minimum_style_evidence}"
        )

    filtered = [
        label for label in labels if (label.font, label.size) == dominant_style
    ]
    horizontal, used = _horizontal_groups(filtered, option_ids)
    vertical = _vertical_groups(filtered, option_ids, used)
    groups = [*horizontal, *vertical]
    groups.extend(_block_fallback_groups(blocks, groups, option_ids))
    groups.sort(key=lambda group: (group.page_index, group.y0, group.x0))

    if len(groups) != total:
        raise OrderedOptionMarkerError(
            f"grupos completos de alternativas divergentes: {len(groups)}/{total}"
        )
    return groups


def markers_from_groups(
    doc: Any,
    groups: list[OptionGroup],
    marker_factory: Callable[..., Any],
) -> list[Any]:
    markers: list[Any] = []
    previous: OptionGroup | None = None
    for number, group in enumerate(groups, start=1):
        page = doc[group.page_index]
        width = float(page.rect.width)
        height = float(page.rect.height)
        if previous is not None and previous.page_index == group.page_index:
            y0 = min(group.y0 - 6, previous.y1 + 6)
        else:
            y0 = height * 0.03
        y0 = max(height * 0.02, min(y0, group.y0 - 2))
        markers.append(
            marker_factory(
                number=number,
                page_index=group.page_index,
                x0=width * 0.06,
                y0=y0,
                x1=width * 0.94,
                y1=min(group.y0, y0 + 2),
            )
        )
        previous = group
    return markers


def preceding_page_regions(
    doc: Any,
    groups: list[OptionGroup],
) -> dict[int, list[tuple[int, tuple[float, float, float, float]]]]:
    """Regiões de segurança para questão cujo grupo mudou de página.

    A questão N pode começar depois das alternativas da questão N-1 e só
    terminar na página seguinte. Nesses casos incluímos a cauda da página
    anterior e eventuais páginas intermediárias. Regiões minúsculas de rodapé
    são descartadas.
    """
    result: dict[int, list[tuple[int, tuple[float, float, float, float]]]] = {}
    for index in range(1, len(groups)):
        previous = groups[index - 1]
        current = groups[index]
        if current.page_index <= previous.page_index:
            continue

        regions: list[tuple[int, tuple[float, float, float, float]]] = []
        previous_page = doc[previous.page_index]
        prev_width = float(previous_page.rect.width)
        prev_height = float(previous_page.rect.height)
        tail_y0 = min(prev_height * 0.975, previous.y1 + 4)
        tail_y1 = prev_height * 0.975
        if tail_y1 - tail_y0 >= prev_height * 0.06:
            regions.append(
                (
                    previous.page_index,
                    (prev_width * 0.06, tail_y0, prev_width * 0.94, tail_y1),
                )
            )

        for page_index in range(previous.page_index + 1, current.page_index):
            page = doc[page_index]
            width = float(page.rect.width)
            height = float(page.rect.height)
            regions.append(
                (page_index, (width * 0.06, height * 0.03, width * 0.94, height * 0.975))
            )

        if regions:
            result[index + 1] = regions
    return result
