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
import itertools
import re
from dataclasses import dataclass
from functools import lru_cache
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
    tail_y1: float | None = None


@dataclass(frozen=True)
class OptionGroup:
    page_index: int
    kind: str
    x0: float
    y0: float
    x1: float
    y1: float
    core_y1: float | None = None


@dataclass(frozen=True)
class HeaderBoundary:
    page_index: int
    y0: float
    y1: float
    divider_ratio: float


_TOKEN_RE = re.compile(r"^\s*[\[(]?([A-Ea-e])[\])\.:;-]?\s*$")
_INLINE_RE = re.compile(r"(?m)^\s*[\[(]?([A-Ea-e])[\])\.:;-]\s+")
_LINE_OPTION_RE = re.compile(
    r"^\s*(?:\[|\()?([A-Ea-e])(?:\]|\)|\.|:|;|-)\s*"
)
_ROW_TOLERANCE = 4.5
_WRAPPED_MAX_ROW_GAP = 90.0
_WRAPPED_MAX_HEIGHT = 140.0


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
                        tail_y1=bbox[3],
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


def _collect_line_option_labels(doc: Any) -> list[OptionLabel]:
    """Collect punctuated A..E labels from line starts in document order.

    Unlike isolated-span detection, this also sees labels embedded at the
    beginning of option text. Requiring punctuation avoids treating bare
    mathematical letters as option labels. The containing block tail is kept
    so a synthetic boundary does not cut wrapped option text immediately after
    the label line.
    """
    labels: list[OptionLabel] = []
    for page_index, page in enumerate(doc):
        data = page.get_text("dict", sort=True)
        serial = 0
        for block in data.get("blocks", []):
            block_bbox = tuple(float(value) for value in block.get("bbox", (0, 0, 0, 0)))
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                raw = "".join(str(span.get("text", "")) for span in spans)
                match = _LINE_OPTION_RE.match(raw)
                if not match:
                    continue
                boxes = [
                    tuple(map(float, span["bbox"]))
                    for span in spans
                    if span.get("bbox")
                ]
                if not boxes:
                    continue
                first = spans[0]
                labels.append(
                    OptionLabel(
                        page_index=page_index,
                        block_index=serial,
                        letter=match.group(1).upper(),
                        x0=min(box[0] for box in boxes),
                        y0=min(box[1] for box in boxes),
                        x1=max(box[2] for box in boxes),
                        y1=max(box[3] for box in boxes),
                        font=str(first.get("font", "")),
                        size=round(float(first.get("size", 0)), 1),
                        tail_y1=max(max(box[3] for box in boxes), block_bbox[3]),
                    )
                )
                serial += 1
    return labels


def _ordered_line_group(
    labels: list[OptionLabel],
    option_ids: tuple[str, ...],
) -> OptionGroup | None:
    if len(labels) != len(option_ids):
        return None
    if len({label.page_index for label in labels}) != 1:
        return None
    if collections.Counter(label.letter for label in labels) != collections.Counter(option_ids):
        return None

    return OptionGroup(
        page_index=labels[0].page_index,
        kind="ordered-lines",
        x0=min(label.x0 for label in labels),
        y0=min(label.y0 for label in labels),
        x1=max(label.x1 for label in labels),
        y1=max(
            label.tail_y1 if label.tail_y1 is not None else label.y1
            for label in labels
        ),
        core_y1=max(label.y1 for label in labels),
    )


def _partition_ordered_line_groups(
    labels: list[OptionLabel],
    option_ids: tuple[str, ...],
    total: int,
) -> list[OptionGroup]:
    """Prove a near-complete option sequence from punctuated line labels.

    The whole document must partition into consecutive groups containing each
    option exactly once. At most two surplus labels may be discarded, and the
    valid discard set must be unique. A nearly complete sequence may return
    total-1 or total-2 groups so independent geometric evidence can supplement
    the missing groups later.
    """
    width = len(option_ids)
    if width < 1:
        return []
    if total < 3:
        return []
    minimum_groups = max(3, total - 2)
    target = min(total, len(labels) // width)
    if target < minimum_groups:
        return []

    noise = len(labels) - target * width
    if noise < 0 or noise > 2:
        return []

    counts = collections.Counter(label.letter for label in labels)
    expected = collections.Counter({letter: target for letter in option_ids})
    for letter in option_ids:
        if counts[letter] < target:
            return []
    if sum(max(0, counts[letter] - expected[letter]) for letter in option_ids) != noise:
        return []
    if any(letter not in option_ids for letter in counts):
        return []

    surplus_letters = {
        letter
        for letter in option_ids
        if counts[letter] > target
    }
    removable = [
        index for index, label in enumerate(labels)
        if label.letter in surplus_letters
    ]
    skip_sets = [()]
    if noise:
        skip_sets = itertools.combinations(removable, noise)

    solutions: list[tuple[tuple[int, ...], list[OptionGroup]]] = []
    for skips_iter in skip_sets:
        skips = tuple(skips_iter)
        skip_lookup = set(skips)
        filtered = [
            label for index, label in enumerate(labels)
            if index not in skip_lookup
        ]
        if len(filtered) != target * width:
            continue

        candidate: list[OptionGroup] = []
        valid = True
        for offset in range(0, len(filtered), width):
            group = _ordered_line_group(filtered[offset : offset + width], option_ids)
            if group is None:
                valid = False
                break
            candidate.append(group)
        if valid:
            solutions.append((skips, candidate))

    if len(solutions) == 1:
        return solutions[0][1]
    if not solutions or noise == 0:
        return []

    # Multiple sequence-preserving removals are normally ambiguous. We resolve
    # them only when exactly one solution discards labels from a genuinely rare
    # font/size style. This captures extraction noise while keeping dominant
    # option typography protected.
    style_counts = collections.Counter((label.font, label.size) for label in labels)
    rare_limit = max(2, (len(labels) + 49) // 50)  # at most ~2% of labels
    rare_solutions = [
        candidate
        for skips, candidate in solutions
        if skips
        and all(
            style_counts[(labels[index].font, labels[index].size)] <= rare_limit
            for index in skips
        )
    ]
    if len(rare_solutions) == 1:
        return rare_solutions[0]
    return []




def _visual_reading_order(
    doc: Any,
    labels: list[OptionLabel],
    option_ids: tuple[str, ...],
) -> list[OptionLabel]:
    """Ordena rótulos por página e por colunas somente quando o gap é provado.

    O corte não assume que a divisória física está no meio da página. Em provas
    com colunas assimétricas, usamos os X dos rótulos da primeira alternativa e
    exigimos um gap grande entre dois conjuntos. Sem esse gap, mantemos a ordem
    simples Y/X e deixamos os detectores seguintes decidirem.
    """
    by_page: dict[int, list[OptionLabel]] = collections.defaultdict(list)
    for label in labels:
        by_page[label.page_index].append(label)

    ordered: list[OptionLabel] = []
    anchor = option_ids[0]
    for page_index in sorted(by_page):
        page_labels = by_page[page_index]
        width = float(doc[page_index].rect.width)
        anchors = sorted(label.x0 for label in page_labels)
        split_x: float | None = None
        if len(anchors) >= 2:
            gaps = [
                (anchors[index + 1] - anchors[index], index)
                for index in range(len(anchors) - 1)
            ]
            gap, index = max(gaps, default=(0.0, 0))
            if gap >= width * 0.14:
                left_anchor = anchors[index]
                right_anchor = anchors[index + 1]
                split_x = (left_anchor + right_anchor) / 2.0

        if split_x is None:
            ordered.extend(sorted(page_labels, key=lambda item: (item.y0, item.x0)))
            continue

        left = [label for label in page_labels if label.x0 < split_x]
        right = [label for label in page_labels if label.x0 >= split_x]
        if not left or not right:
            ordered.extend(sorted(page_labels, key=lambda item: (item.y0, item.x0)))
            continue

        ordered.extend(sorted(left, key=lambda item: (item.y0, item.x0)))
        ordered.extend(sorted(right, key=lambda item: (item.y0, item.x0)))
    return ordered

def _partition_visual_groups(
    labels: list[OptionLabel],
    option_ids: tuple[str, ...],
    total: int,
    *,
    max_noise: int,
) -> list[OptionGroup]:
    """Exige uma única partição visual em exatamente N grupos."""
    width = len(option_ids)
    noise = len(labels) - total * width
    if width < 1 or total < 1 or noise < 0 or noise > max_noise:
        return []

    @lru_cache(maxsize=None)
    def solve(index: int, groups_done: int, noise_left: int):
        remaining = len(labels) - index
        needed = (total - groups_done) * width
        if remaining < needed or remaining > needed + noise_left:
            return ()
        if groups_done == total:
            if remaining != noise_left:
                return ()
            return ((),)

        solutions: list[tuple[OptionGroup, ...]] = []
        if index + width <= len(labels):
            group = _ordered_line_group(labels[index : index + width], option_ids)
            if group is not None:
                for tail in solve(index + width, groups_done + 1, noise_left):
                    solutions.append((group, *tail))
                    if len(solutions) > 1:
                        return tuple(solutions[:2])

        if noise_left > 0 and index < len(labels):
            for tail in solve(index + 1, groups_done, noise_left - 1):
                solutions.append(tail)
                if len(solutions) > 1:
                    return tuple(solutions[:2])
        return tuple(solutions)

    solutions = solve(0, 0, noise)
    if len(solutions) != 1:
        return []
    return list(solutions[0])


def detect_visual_ordered_option_groups(
    doc: Any,
    labels: list[OptionLabel],
    option_ids: tuple[str, ...],
    total: int,
    *,
    max_noise: int = 4,
) -> list[OptionGroup]:
    ordered = _visual_reading_order(doc, labels, option_ids)
    groups = _partition_visual_groups(
        ordered,
        option_ids,
        total,
        max_noise=max_noise,
    )
    if len(groups) != total:
        raise OrderedOptionMarkerError(
            "rótulos em ordem visual não fecham uma partição única: "
            f"{len(labels)} rótulos para {total} questões"
        )
    return groups


def _cluster_rows(
    items: list[tuple[int, OptionLabel]],
) -> list[list[tuple[int, OptionLabel]]]:
    """Agrupa rótulos por faixa Y mantendo a ordem visual esquerda→direita."""
    remaining = sorted(items, key=lambda item: (item[1].y0, item[1].x0))
    rows: list[list[tuple[int, OptionLabel]]] = []
    while remaining:
        seed = remaining[0][1]
        row: list[tuple[int, OptionLabel]] = []
        keep: list[tuple[int, OptionLabel]] = []
        for item in remaining:
            if abs(item[1].y0 - seed.y0) <= _ROW_TOLERANCE:
                row.append(item)
            else:
                keep.append(item)
        rows.append(sorted(row, key=lambda item: item[1].x0))
        remaining = keep
    return rows


def _horizontal_groups(
    labels: list[OptionLabel], option_ids: tuple[str, ...]
) -> tuple[list[OptionGroup], set[int]]:
    groups: list[OptionGroup] = []
    used: set[int] = set()
    by_page: dict[int, list[tuple[int, OptionLabel]]] = collections.defaultdict(list)
    for index, label in enumerate(labels):
        by_page[label.page_index].append((index, label))

    width = len(option_ids)
    for page_index, page_labels in by_page.items():
        for row in _cluster_rows(page_labels):
            index = 0
            while index <= len(row) - width:
                window = row[index : index + width]
                if [item[1].letter for item in window] != list(option_ids):
                    index += 1
                    continue
                ids = [item[0] for item in window]
                if any(item_id in used for item_id in ids):
                    index += 1
                    continue
                used.update(ids)
                groups.append(
                    OptionGroup(
                        page_index=page_index,
                        kind="horizontal",
                        x0=min(item[1].x0 for item in window),
                        y0=min(item[1].y0 for item in window),
                        x1=max(item[1].x1 for item in window),
                        y1=max(
                            item[1].tail_y1 if item[1].tail_y1 is not None else item[1].y1
                            for item in window
                        ),
                    )
                )
                index += width
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
                    y1=max(
                        item[1].tail_y1 if item[1].tail_y1 is not None else item[1].y1
                        for item in sequence
                    ),
                )
            )
    return groups


def _wrapped_groups(
    labels: list[OptionLabel], option_ids: tuple[str, ...], used: set[int]
) -> list[OptionGroup]:
    """Detecta A..E quebrado em duas ou mais linhas (ex.: ABC / DE).

    Só considera rótulos que sobraram dos detectores horizontal e vertical.
    A sequência precisa continuar canônica em ordem de leitura e ocupar uma
    região compacta; assim grades reais são recuperadas sem transformar letras
    incidentais espalhadas pela página em alternativas.
    """
    groups: list[OptionGroup] = []
    by_page: dict[int, list[tuple[int, OptionLabel]]] = collections.defaultdict(list)
    for index, label in enumerate(labels):
        if index not in used:
            by_page[label.page_index].append((index, label))

    width = len(option_ids)
    for page_index, page_labels in by_page.items():
        rows = _cluster_rows(page_labels)
        flattened: list[tuple[int, OptionLabel, int]] = []
        for row_index, row in enumerate(rows):
            flattened.extend((index, label, row_index) for index, label in row)

        cursor = 0
        while cursor <= len(flattened) - width:
            window = flattened[cursor : cursor + width]
            if [item[1].letter for item in window] != list(option_ids):
                cursor += 1
                continue
            ids = [item[0] for item in window]
            if any(item_id in used for item_id in ids):
                cursor += 1
                continue

            row_ids = [item[2] for item in window]
            distinct_rows = sorted(set(row_ids))
            if len(distinct_rows) < 2:
                cursor += 1
                continue
            # The five labels must occupy consecutive visual rows. This blocks
            # accidental A..E sequences assembled from unrelated page regions.
            if distinct_rows != list(range(distinct_rows[0], distinct_rows[-1] + 1)):
                cursor += 1
                continue

            y0 = min(item[1].y0 for item in window)
            y1 = max(
                item[1].tail_y1 if item[1].tail_y1 is not None else item[1].y1
                for item in window
            )
            if y1 - y0 > _WRAPPED_MAX_HEIGHT:
                cursor += 1
                continue

            row_y = [min(item[1].y0 for item in window if item[2] == row_id) for row_id in distinct_rows]
            if any(next_y - current_y > _WRAPPED_MAX_ROW_GAP for current_y, next_y in zip(row_y, row_y[1:])):
                cursor += 1
                continue

            used.update(ids)
            groups.append(
                OptionGroup(
                    page_index=page_index,
                    kind="wrapped",
                    x0=min(item[1].x0 for item in window),
                    y0=y0,
                    x1=max(item[1].x1 for item in window),
                    y1=y1,
                )
            )
            cursor += width
    return groups


def _intersects_2d(
    group: OptionGroup,
    page_index: int,
    bbox: tuple[float, float, float, float],
) -> bool:
    if group.page_index != page_index:
        return False
    bx0, by0, bx1, by1 = bbox
    group_y1 = group.core_y1 if group.core_y1 is not None else group.y1
    return (
        max(0.0, min(group.x1, bx1) - max(group.x0, bx0)) > 2
        and max(0.0, min(group_y1, by1) - max(group.y0, by0)) > 2
    )


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
        bbox = tuple(float(value) for value in block["bbox"])
        overlaps = any(
            _intersects_2d(group, int(block["page_index"]), bbox)
            for group in [*groups, *fallback]
        )
        if overlaps:
            continue
        bx0, by0, bx1, by1 = bbox
        fallback.append(
            OptionGroup(
                page_index=int(block["page_index"]),
                kind="block",
                x0=bx0,
                y0=by0,
                x1=bx1,
                y1=by1,
            )
        )
    return fallback


def _style_option_groups(
    labels: list[OptionLabel], option_ids: tuple[str, ...]
) -> list[OptionGroup]:
    """Return groups only from styles with repeated geometric evidence.

    A single A..E sequence in an isolated font can be a mathematical false
    positive. Two or more complete groups using the same font/size is strong
    enough to make that style eligible; rare true layouts can still be
    recovered by the punctuation-aware block fallbacks below.
    """
    by_style: dict[tuple[str, float], list[OptionLabel]] = collections.defaultdict(list)
    for label in labels:
        by_style[(label.font, label.size)].append(label)

    groups: list[OptionGroup] = []
    for style_labels in by_style.values():
        horizontal, used = _horizontal_groups(style_labels, option_ids)
        vertical = _vertical_groups(style_labels, option_ids, used)
        wrapped = _wrapped_groups(style_labels, option_ids, used)
        candidates = [*horizontal, *vertical, *wrapped]
        if len(candidates) >= 2:
            groups.extend(candidates)
    return groups


def _block_single_label_groups(
    blocks: list[dict[str, Any]],
    groups: list[OptionGroup],
    option_ids: tuple[str, ...],
) -> list[OptionGroup]:
    """Recover A..E when each punctuated option starts its own text block.

    These candidates are intentionally built only from blocks that expose one
    canonical option letter. The same geometric detectors used for isolated
    spans then validate horizontal, vertical or wrapped A..E structure.
    """
    pseudo: list[OptionLabel] = []
    for block in blocks:
        seen: list[str] = []
        for letter in block["letters"]:
            if not seen or seen[-1] != letter:
                seen.append(letter)
        if len(seen) != 1 or seen[0] not in option_ids:
            continue
        bx0, by0, bx1, by1 = map(float, block["bbox"])
        pseudo.append(
            OptionLabel(
                page_index=int(block["page_index"]),
                block_index=int(block["block_index"]),
                letter=seen[0],
                x0=bx0,
                y0=by0,
                x1=bx1,
                y1=by1,
                font="__block_option__",
                size=0.0,
            )
        )

    if not pseudo:
        return []

    horizontal, used = _horizontal_groups(pseudo, option_ids)
    vertical = _vertical_groups(pseudo, option_ids, used)
    wrapped = _wrapped_groups(pseudo, option_ids, used)
    recovered: list[OptionGroup] = []
    for candidate in [*horizontal, *vertical, *wrapped]:
        if any(
            _intersects_2d(existing, candidate.page_index, (candidate.x0, candidate.y0, candidate.x1, candidate.y1))
            for existing in [*groups, *recovered]
        ):
            continue
        recovered.append(candidate)
    return recovered


def _vector_header_boundaries(doc: Any, total: int) -> list[HeaderBoundary]:
    """Detecta a assinatura vetorial dominante dos cabeçalhos de questão.

    Alguns cadernos usam uma pequena faixa horizontal com um divisor vertical
    repetido no início de cada questão. Candidatos são agrupados pela posição
    normalizada do divisor; só aceitamos uma assinatura dominante que produza
    exatamente `total` cabeçalhos. Qualquer empate ou contagem divergente
    mantém o fallback fechado.
    """
    candidates: list[HeaderBoundary] = []
    for page_index, page in enumerate(doc):
        get_drawings = getattr(page, "get_drawings", None)
        if not callable(get_drawings):
            continue

        width = float(page.rect.width)
        horizontal_ys: set[float] = set()
        verticals: list[tuple[float, float, float]] = []
        for drawing in get_drawings():
            for item in drawing.get("items", []):
                if not item:
                    continue
                kind = item[0]
                if kind == "l":
                    p1, p2 = item[1], item[2]
                    x0, x1 = sorted((float(p1.x), float(p2.x)))
                    y0, y1 = sorted((float(p1.y), float(p2.y)))
                    if abs(y1 - y0) <= 1.0 and x1 - x0 >= width * 0.60:
                        horizontal_ys.add(round((y0 + y1) / 2, 1))
                    if abs(x1 - x0) <= 1.0 and y1 - y0 >= 8:
                        verticals.append(((x0 + x1) / 2, y0, y1))
                elif kind == "re":
                    rect = item[1]
                    if float(rect.width) >= width * 0.60:
                        horizontal_ys.add(round(float(rect.y0), 1))
                        horizontal_ys.add(round(float(rect.y1), 1))
                    if float(rect.height) >= 8:
                        verticals.append((float(rect.x0), float(rect.y0), float(rect.y1)))
                        verticals.append((float(rect.x1), float(rect.y0), float(rect.y1)))

        ys = sorted(horizontal_ys)
        for top, bottom in zip(ys, ys[1:]):
            gap = bottom - top
            if not 15.0 <= gap <= 21.0:
                continue
            dividers = [
                x
                for x, y0, y1 in verticals
                if y0 <= top + 2.5
                and y1 >= bottom - 2.5
                and width * 0.50 <= x <= width * 0.80
            ]
            if not dividers:
                continue
            divider = sum(dividers) / len(dividers)
            candidates.append(
                HeaderBoundary(
                    page_index=page_index,
                    y0=top,
                    y1=bottom,
                    divider_ratio=divider / width,
                )
            )

    if len(candidates) < total:
        return []

    clusters: list[list[HeaderBoundary]] = []
    for candidate in sorted(candidates, key=lambda item: item.divider_ratio):
        placed = False
        for cluster in clusters:
            center = sum(item.divider_ratio for item in cluster) / len(cluster)
            if abs(candidate.divider_ratio - center) <= 0.008:
                cluster.append(candidate)
                placed = True
                break
        if not placed:
            clusters.append([candidate])

    exact = [cluster for cluster in clusters if len(cluster) == total]
    if len(exact) != 1:
        return []
    return sorted(exact[0], key=lambda item: (item.page_index, item.y0))


def _significant_raster_group(
    doc: Any,
    boundary: HeaderBoundary,
    next_boundary: HeaderBoundary | None,
) -> OptionGroup | None:
    """Cria evidência visual para uma questão cujas alternativas são rasterizadas."""
    page = doc[boundary.page_index]
    width = float(page.rect.width)
    height = float(page.rect.height)
    start = boundary.y1 + 2.0
    if next_boundary is not None and next_boundary.page_index == boundary.page_index:
        end = max(start, next_boundary.y0 - 4.0)
    else:
        end = height * 0.94
    if end <= start:
        return None

    get_images = getattr(page, "get_images", None)
    get_image_rects = getattr(page, "get_image_rects", None)
    if not callable(get_images) or not callable(get_image_rects):
        return None

    minimum_area = width * height * 0.015
    rects: list[tuple[float, float, float, float]] = []
    seen: set[tuple[float, float, float, float]] = set()
    for image in get_images(full=True):
        if not image:
            continue
        for rect in get_image_rects(image[0]):
            x0, y0, x1, y1 = map(float, (rect.x0, rect.y0, rect.x1, rect.y1))
            if y1 < start or y0 > end:
                continue
            clipped_y0 = max(start, y0)
            clipped_y1 = min(end, y1)
            if (x1 - x0) * (clipped_y1 - clipped_y0) < minimum_area:
                continue
            key = (round(x0, 2), round(clipped_y0, 2), round(x1, 2), round(clipped_y1, 2))
            if key in seen:
                continue
            seen.add(key)
            rects.append((x0, clipped_y0, x1, clipped_y1))

    if not rects:
        return None

    return OptionGroup(
        page_index=boundary.page_index,
        kind="raster-header-image",
        x0=min(rect[0] for rect in rects),
        y0=min(rect[1] for rect in rects),
        x1=max(rect[2] for rect in rects),
        y1=end,
        core_y1=max(rect[3] for rect in rects),
    )


def _header_interval_index(
    group: OptionGroup,
    boundaries: list[HeaderBoundary],
) -> int | None:
    matches: list[int] = []
    for index, boundary in enumerate(boundaries):
        if group.page_index < boundary.page_index:
            continue
        if group.page_index == boundary.page_index and group.y0 < boundary.y1:
            continue

        next_boundary = boundaries[index + 1] if index + 1 < len(boundaries) else None
        if next_boundary is not None:
            if group.page_index > next_boundary.page_index:
                continue
            if (
                group.page_index == next_boundary.page_index
                and group.y0 >= next_boundary.y0
            ):
                continue
        matches.append(index)
    return matches[0] if len(matches) == 1 else None


def _supplement_raster_header_gap(
    doc: Any,
    line_groups: list[OptionGroup],
    total: int,
) -> list[OptionGroup]:
    """Supre exatamente uma questão rasterizada usando evidência independente.

    Exige N-1 grupos textuais já provados, N cabeçalhos vetoriais com assinatura
    dominante, mapeamento um-a-um dos grupos para os intervalos e exatamente um
    intervalo vazio contendo uma imagem significativa. Assim o detector não
    inventa uma questão só para atingir a contagem esperada.
    """
    if len(line_groups) != total - 1:
        return []

    boundaries = _vector_header_boundaries(doc, total)
    if len(boundaries) != total:
        return []

    occupied: set[int] = set()
    for group in line_groups:
        index = _header_interval_index(group, boundaries)
        if index is None or index in occupied:
            return []
        occupied.add(index)

    missing = [index for index in range(total) if index not in occupied]
    if len(missing) != 1:
        return []

    missing_index = missing[0]
    next_boundary = (
        boundaries[missing_index + 1]
        if missing_index + 1 < len(boundaries)
        else None
    )
    raster = _significant_raster_group(
        doc,
        boundaries[missing_index],
        next_boundary,
    )
    if raster is None:
        return []

    groups = [*line_groups, raster]
    groups.sort(key=lambda group: (group.page_index, group.y0, group.x0))
    return groups if len(groups) == total else []


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
    line_labels = _collect_line_option_labels(doc)
    if not labels and not blocks and not line_labels:
        raise OrderedOptionMarkerError("nenhum rótulo de alternativa detectado")

    line_groups = _partition_ordered_line_groups(
        line_labels, option_ids, total
    )
    if len(line_groups) == total:
        return line_groups

    visual_groups: list[OptionGroup] = []
    if total >= 3:
        try:
            visual_groups = detect_visual_ordered_option_groups(
                doc,
                line_labels,
                option_ids,
                total,
                max_noise=4,
            )
        except OrderedOptionMarkerError:
            visual_groups = []
    if len(visual_groups) == total:
        return visual_groups

    isolated_visual_groups: list[OptionGroup] = []
    if total >= 3 and labels:
        try:
            isolated_visual_groups = detect_visual_ordered_option_groups(
                doc,
                labels,
                option_ids,
                total,
                max_noise=4,
            )
        except OrderedOptionMarkerError:
            isolated_visual_groups = []
    if len(isolated_visual_groups) == total:
        return isolated_visual_groups

    geometric = _style_option_groups(labels, option_ids)
    geometric.extend(_block_fallback_groups(blocks, geometric, option_ids))
    geometric.extend(_block_single_label_groups(blocks, geometric, option_ids))
    geometric.sort(key=lambda group: (group.page_index, group.y0, group.x0))

    if line_groups:
        supplements: list[OptionGroup] = []
        for candidate in geometric:
            bbox = (candidate.x0, candidate.y0, candidate.x1, candidate.y1)
            if any(
                _intersects_2d(existing, candidate.page_index, bbox)
                for existing in [*line_groups, *supplements]
            ):
                continue
            supplements.append(candidate)

        missing = total - len(line_groups)
        if len(supplements) == missing:
            groups = [*line_groups, *supplements]
            groups.sort(key=lambda group: (group.page_index, group.y0, group.x0))
            return groups

        if missing == 1 and not supplements:
            raster_groups = _supplement_raster_header_gap(doc, line_groups, total)
            if len(raster_groups) == total:
                return raster_groups

        raise OrderedOptionMarkerError(
            "grupos de linhas pontuadas exigem suplemento inequívoco: "
            f"{len(line_groups)}+{len(supplements)}/{total}"
        )

    if len(geometric) != total:
        raise OrderedOptionMarkerError(
            f"grupos completos de alternativas divergentes: {len(geometric)}/{total}"
        )
    return geometric


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
        marker_x0 = max(width * 0.02, min(group.x0, width * 0.94))
        marker_x1 = min(width * 0.98, max(marker_x0 + 2.0, group.x1))
        markers.append(
            marker_factory(
                number=number,
                page_index=group.page_index,
                x0=marker_x0,
                y0=y0,
                x1=marker_x1,
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
