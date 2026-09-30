#!/usr/bin/env python3
"""Fallback estrutural OCR para marcadores de questão e alternativas.

OCR nunca deriva gabarito nem identidade acadêmica. A saída só vira boundary
quando a sequência estrutural fecha exatamente em 1..N; caso contrário o
provider continua bloqueado.
"""

from __future__ import annotations

import collections
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Any, Callable

import native_option_markers as option_markers


class OcrOptionMarkerError(ValueError):
    pass


_OPTION_TOKEN = re.compile(r"^[\[\(\{<Il|]?([A-Ea-e])[\]\)\}>\.:;\-]$")
_NUMBER_TOKEN = re.compile(r"^[\[\(\{]?0?(\d{1,3})[\]\)\}\.:;\-]?$")


def _option_letter(value: str, *, allow_bare: bool = False) -> str | None:
    token = re.sub(r"\s+", "", value or "")
    if allow_bare and len(token) == 1 and token.upper() in {"A", "B", "C", "D", "E"}:
        return token.upper()
    if len(token) < 2 or len(token) > 4:
        return None
    match = _OPTION_TOKEN.fullmatch(token)
    return match.group(1).upper() if match else None


def _rows(payload: str):
    return csv.DictReader(io.StringIO(payload), delimiter="\t")


def labels_from_tsv(
    payload: str,
    *,
    page_index: int,
    scale: float,
    allow_bare: bool = False,
    bare_min_confidence: float = 55.0,
) -> list[option_markers.OptionLabel]:
    labels: list[option_markers.OptionLabel] = []
    serial = 0
    for row in _rows(payload):
        raw = str(row.get("text") or "")
        token = re.sub(r"\s+", "", raw)
        is_bare = len(token) == 1 and token.upper() in {"A", "B", "C", "D", "E"}
        letter = _option_letter(raw, allow_bare=allow_bare)
        if not letter:
            continue
        try:
            left = float(row["left"]) / scale
            top = float(row["top"]) / scale
            width = float(row["width"]) / scale
            height = float(row["height"]) / scale
            confidence = float(row.get("conf") or -1)
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            continue
        if width <= 0 or height <= 0 or confidence < 15:
            continue
        if is_bare:
            if confidence < bare_min_confidence:
                continue
            if width > height * 1.8:
                continue
        labels.append(
            option_markers.OptionLabel(
                page_index=page_index,
                block_index=serial,
                letter=letter,
                x0=left,
                y0=top,
                x1=left + width,
                y1=top + height,
                font="__ocr_option_bare__" if is_bare else "__ocr_option__",
                size=round(height, 1),
                tail_y1=top + height,
            )
        )
        serial += 1
    return labels


def _dedupe_labels(
    labels: list[option_markers.OptionLabel],
    *,
    tolerance: float = 4.0,
) -> list[option_markers.OptionLabel]:
    deduped: list[option_markers.OptionLabel] = []
    for candidate in sorted(labels, key=lambda item: (item.page_index, item.y0, item.x0, item.letter)):
        candidate_cx = (candidate.x0 + candidate.x1) / 2.0
        candidate_cy = (candidate.y0 + candidate.y1) / 2.0
        duplicate = False
        for existing in deduped:
            if existing.page_index != candidate.page_index or existing.letter != candidate.letter:
                continue
            existing_cx = (existing.x0 + existing.x1) / 2.0
            existing_cy = (existing.y0 + existing.y1) / 2.0
            if (
                abs(existing_cx - candidate_cx) <= tolerance
                and abs(existing_cy - candidate_cy) <= tolerance
            ):
                duplicate = True
                break
        if not duplicate:
            deduped.append(candidate)
    return deduped


def _anchored_bare_labels(
    doc: Any,
    strict: list[option_markers.OptionLabel],
    relaxed: list[option_markers.OptionLabel],
    option_ids: tuple[str, ...],
) -> list[option_markers.OptionLabel]:
    anchor = option_ids[0]
    by_page: dict[int, list[float]] = collections.defaultdict(list)
    global_ratios: list[float] = []
    for label in strict:
        if label.letter != anchor:
            continue
        width = float(doc[label.page_index].rect.width)
        if width <= 0:
            continue
        ratio = label.x0 / width
        by_page[label.page_index].append(ratio)
        global_ratios.append(ratio)

    sizes = sorted(label.size for label in strict if label.size > 0)
    median_size = sizes[len(sizes) // 2] if sizes else 0.0
    accepted: list[option_markers.OptionLabel] = []
    for label in relaxed:
        if label.font != "__ocr_option_bare__":
            continue
        width = float(doc[label.page_index].rect.width)
        height = float(doc[label.page_index].rect.height)
        if width <= 0 or height <= 0:
            continue
        if label.y0 < height * 0.05 or label.y1 > height * 0.975:
            continue
        if median_size and not (median_size * 0.55 <= label.size <= median_size * 1.8):
            continue
        anchors = by_page.get(label.page_index) or global_ratios
        ratio = label.x0 / width
        if not anchors or min(abs(ratio - value) for value in anchors) > 0.04:
            continue

        x_tolerance = max(14.0, width * 0.035)
        y_tolerance = max(70.0, median_size * 7.0 if median_size else 70.0)
        center_y = (label.y0 + label.y1) / 2.0
        neighbors = [
            candidate
            for candidate in strict
            if candidate.page_index == label.page_index
            and candidate.letter != label.letter
            and abs(candidate.x0 - label.x0) <= x_tolerance
            and abs(((candidate.y0 + candidate.y1) / 2.0) - center_y) <= y_tolerance
        ]
        if len({candidate.letter for candidate in neighbors}) < 2:
            continue
        accepted.append(label)
    return accepted


def number_markers_from_tsv(
    payload: str,
    *,
    page_index: int,
    scale: float,
    page_width: float,
    page_height: float,
    total: int,
    marker_factory: Callable[..., Any],
    x_ranges: tuple[tuple[float, float], ...] = ((0.0, 0.22),),
) -> list[Any]:
    markers: list[Any] = []
    for row in _rows(payload):
        token = re.sub(r"\s+", "", str(row.get("text") or ""))
        match = _NUMBER_TOKEN.fullmatch(token)
        if not match:
            continue
        number = int(match.group(1))
        if not 1 <= number <= total:
            continue
        try:
            left = float(row["left"]) / scale
            top = float(row["top"]) / scale
            width = float(row["width"]) / scale
            height = float(row["height"]) / scale
            confidence = float(row.get("conf") or -1)
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            continue
        # A faixa horizontal é perfilável. O default preserva o comportamento
        # histórico da EsPCEx; provas em duas colunas podem liberar âncoras
        # adicionais sem aceitar números arbitrários no miolo do enunciado.
        if confidence < 20:
            continue
        ratio = left / page_width if page_width > 0 else 1.0
        if not any(start <= ratio <= end for start, end in x_ranges):
            continue
        if top < page_height * 0.065 or top > page_height * 0.965:
            continue
        if width <= 0 or height <= 0:
            continue
        markers.append(
            marker_factory(
                number=number,
                page_index=page_index,
                x0=left,
                y0=top,
                x1=left + width,
                y1=top + height,
            )
        )
    return markers


def _normalized_ocr_word(value: str) -> str:
    return (
        unicodedata.normalize("NFD", value or "")
        .encode("ascii", "ignore")
        .decode("ascii")
        .strip()
        .lower()
    )


_DIGIT_CONFUSIONS = str.maketrans(
    {
        "O": "0",
        "o": "0",
        "Q": "0",
        "I": "1",
        "l": "1",
        "|": "1",
        "Z": "2",
        "S": "5",
        "s": "5",
        "G": "6",
        "T": "7",
        "B": "8",
    }
)


def _ocr_number_value(
    value: str,
    total: int,
    *,
    allow_digit_confusions: bool = False,
    expected_numbers: set[int] | None = None,
    allow_pure_digit_confusions: bool = False,
) -> int | None:
    token = re.sub(r"\s+", "", value or "")
    strict = _NUMBER_TOKEN.fullmatch(token)
    if strict:
        number = int(strict.group(1))
        if not 1 <= number <= total:
            return None
        if expected_numbers is not None and number not in expected_numbers:
            return None
        return number
    if not allow_digit_confusions:
        return None

    core = token.strip("[](){}.:;-")
    if not core or len(core) > 3:
        return None
    has_digit = any(char.isdigit() for char in core)
    # Letra pura só pode ser corrigida dentro de recuperação localizada, com
    # conjunto explícito de números esperados. Ex.: B→8 nunca vale globalmente.
    if not has_digit and (
        not allow_pure_digit_confusions or expected_numbers is None
    ):
        return None
    normalized = core.translate(_DIGIT_CONFUSIONS)
    if not normalized.isdigit():
        return None
    number = int(normalized)
    if not 1 <= number <= total:
        return None
    if expected_numbers is not None and number not in expected_numbers:
        return None
    return number


def line_question_markers_from_tsv(
    payload: str,
    *,
    page_index: int,
    scale: float,
    page_width: float,
    page_height: float,
    total: int,
    marker_factory: Callable[..., Any],
    x_ranges: tuple[tuple[float, float], ...],
    allow_digit_confusions: bool = False,
    expected_numbers: set[int] | None = None,
    allow_pure_digit_confusions: bool = False,
) -> list[Any]:
    """Extrai números só do início lógico de linhas de questão.

    Em scans de duas colunas, procurar todo token numérico gera falsos
    positivos em fórmulas. Aqui aceitamos apenas:
    - linha que começa por um número em uma âncora horizontal permitida; ou
    - cabeçalho explícito "QUESTÃO/Q <n>".

    A sequência final 1..N continua sendo validada pelo pipeline antes de
    qualquer pack ser produzido.
    """
    grouped: dict[tuple[str, str, str], list[dict[str, str]]] = collections.defaultdict(list)
    for row in _rows(payload):
        if not str(row.get("text") or "").strip():
            continue
        key = (
            str(row.get("block_num") or ""),
            str(row.get("par_num") or ""),
            str(row.get("line_num") or ""),
        )
        grouped[key].append(row)

    markers: list[Any] = []
    for rows in grouped.values():
        def word_order(row: dict[str, str]) -> tuple[int, float]:
            try:
                word = int(row.get("word_num") or 0)
            except (TypeError, ValueError):
                word = 0
            try:
                left = float(row.get("left") or 0)
            except (TypeError, ValueError):
                left = 0.0
            return word, left

        words = sorted(rows, key=word_order)
        parsed: list[tuple[dict[str, str], str, float]] = []
        for row in words:
            try:
                confidence = float(row.get("conf") or -1)
            except (TypeError, ValueError):
                continue
            if confidence < 20:
                continue
            parsed.append((row, str(row.get("text") or ""), confidence))
        if not parsed:
            continue

        number_row: dict[str, str] | None = None
        number: int | None = None
        explicit = False
        for index, (_row, raw, _confidence) in enumerate(parsed[:4]):
            normalized = _normalized_ocr_word(raw)
            if normalized not in {"questao", "q"} or index + 1 >= len(parsed):
                continue
            candidate_value = _ocr_number_value(
                parsed[index + 1][1],
                total,
                allow_digit_confusions=allow_digit_confusions,
                expected_numbers=expected_numbers,
                allow_pure_digit_confusions=allow_pure_digit_confusions,
            )
            if candidate_value is not None:
                number_row = parsed[index + 1][0]
                number = candidate_value
                explicit = True
                break

        if number_row is None:
            first_row, first_raw, _confidence = parsed[0]
            candidate_value = _ocr_number_value(
                first_raw,
                total,
                allow_digit_confusions=allow_digit_confusions,
                expected_numbers=expected_numbers,
                allow_pure_digit_confusions=allow_pure_digit_confusions,
            )
            if candidate_value is not None:
                number_row = first_row
                number = candidate_value

        if number_row is None or number is None:
            continue

        try:
            left = float(number_row["left"]) / scale
            top = float(number_row["top"]) / scale
            width = float(number_row["width"]) / scale
            height = float(number_row["height"]) / scale
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            continue
        if width <= 0 or height <= 0:
            continue
        if top < page_height * 0.05 or top > page_height * 0.97:
            continue

        ratio = left / page_width if page_width > 0 else 1.0
        if not explicit and not any(start <= ratio <= end for start, end in x_ranges):
            continue

        markers.append(
            marker_factory(
                number=number,
                page_index=page_index,
                x0=left,
                y0=top,
                x1=left + width,
                y1=top + height,
            )
        )
    return markers


def _same_number_marker_geometry(left: Any, right: Any, tolerance: float = 7.0) -> bool:
    return (
        left.number == right.number
        and left.page_index == right.page_index
        and abs(float(left.x0) - float(right.x0)) <= tolerance
        and abs(float(left.y0) - float(right.y0)) <= tolerance
    )


def _dedupe_number_markers(markers: list[Any]) -> list[Any]:
    deduped: list[Any] = []
    for candidate in sorted(
        markers,
        key=lambda item: (item.number, item.page_index, item.y0, item.x0),
    ):
        if any(_same_number_marker_geometry(existing, candidate) for existing in deduped):
            continue
        deduped.append(candidate)
    return deduped


def _longest_consecutive_run(numbers: set[int]) -> int:
    longest = 0
    current = 0
    previous: int | None = None
    for number in sorted(numbers):
        if previous is not None and number == previous + 1:
            current += 1
        else:
            current = 1
        longest = max(longest, current)
        previous = number
    return longest


def suppress_structural_number_noise(
    markers: list[Any],
    page_widths: dict[int, float],
    page_heights: dict[int, float],
    *,
    rail_tolerance: float = 0.025,
) -> list[Any]:
    """Remove padrões que provam ser índice/rodapé, sem escolher questão por palpite.

    Dois ruídos aparecem em scans de vestibular:
    - número de página centralizado no rodapé;
    - listas densas de muitos números na mesma página e no mesmo trilho x
      (índice, cartão de respostas ou instruções).

    Uma lista densa só perde um candidato quando o mesmo número também existe
    fora dela. Q1 preserva o primeiro candidato do documento, porque uma lista
    pode começar exatamente onde a primeira questão começa. O gate monotônico
    1..N continua obrigatório depois desta limpeza.
    """
    items = _dedupe_number_markers(markers)
    if not items:
        return []

    def x_ratio(item: Any) -> float:
        width = float(page_widths.get(int(item.page_index)) or 0)
        return float(item.x0) / width if width > 0 else 1.0

    # Rodapé numerado: exige simultaneamente centro horizontal e último 7% da
    # página. Assim uma questão real perto do fim da página não é descartada.
    footer_ids: set[int] = set()
    for item in items:
        height = float(page_heights.get(int(item.page_index)) or 0)
        if height <= 0:
            continue
        yr = float(item.y0) / height
        xr = x_ratio(item)
        if yr >= 0.93 and 0.42 <= xr <= 0.58:
            footer_ids.add(id(item))

    working = [item for item in items if id(item) not in footer_ids]
    by_page: dict[int, list[Any]] = collections.defaultdict(list)
    for item in working:
        by_page[int(item.page_index)].append(item)

    dense_ids: set[int] = set()
    for page_items in by_page.values():
        ordered = sorted(page_items, key=lambda item: (x_ratio(item), float(item.y0)))
        rails: list[list[Any]] = []
        for item in ordered:
            ratio = x_ratio(item)
            if not rails:
                rails.append([item])
                continue
            rail_ratio = sum(x_ratio(value) for value in rails[-1]) / len(rails[-1])
            if abs(ratio - rail_ratio) <= rail_tolerance:
                rails[-1].append(item)
            else:
                rails.append([item])

        for rail in rails:
            distinct = {int(item.number) for item in rail}
            if len(distinct) < 5:
                continue
            ys = sorted(float(item.y0) for item in rail)
            gaps = [right - left for left, right in zip(ys, ys[1:]) if right > left]
            median_gap = sorted(gaps)[len(gaps) // 2] if gaps else float("inf")
            # Sequência numérica por si só não prova índice: uma página real
            # também pode conter Q9..Q13 no mesmo alinhamento. Exigimos
            # densidade vertical de fato, característica de índice/cartão.
            is_dense = len(distinct) >= 5 and median_gap <= 40.0
            if not is_dense:
                continue

            rail_ids = {id(item) for item in rail}
            for item in rail:
                # A primeira questão pode coincidir com o começo visual de uma
                # lista de instruções. Mantemos apenas o Q1 mais cedo; todos os
                # outros candidatos densos precisam de evidência fora do rail.
                if int(item.number) == 1:
                    q1 = [value for value in working if int(value.number) == 1]
                    earliest = min(
                        q1,
                        key=lambda value: (
                            int(value.page_index),
                            float(value.y0),
                            float(value.x0),
                        ),
                    )
                    if item is earliest:
                        continue
                has_outside = any(
                    int(other.number) == int(item.number)
                    and id(other) not in rail_ids
                    for other in working
                )
                if has_outside:
                    dense_ids.add(id(item))

    return [item for item in working if id(item) not in dense_ids]


def _marker_reading_key(
    marker: Any,
    page_widths: dict[int, float],
    *,
    column_split: float = 0.42,
) -> tuple[int, int, float, float]:
    width = float(page_widths.get(int(marker.page_index)) or 0)
    if width <= 0:
        raise OcrOptionMarkerError(
            f"largura ausente para página OCR {int(marker.page_index) + 1}"
        )
    ratio = float(marker.x0) / width
    column = 0 if ratio < column_split else 1
    return (int(marker.page_index), column, float(marker.y0), float(marker.x0))


def select_dominant_question_rail(
    markers: list[Any],
    total: int,
    page_widths: dict[int, float],
    *,
    bucket_width: float = 0.02,
    tolerance: float = 0.018,
) -> tuple[list[Any], float | None]:
    """Mantém o trilho horizontal comprovado por ampla cobertura numérica.

    Só escolhemos um rail quando ele cobre pelo menos 1/3 da prova, várias
    páginas e supera claramente o segundo melhor. Números sem candidato no rail
    ficam ausentes para recuperação localizada; não escolhemos um candidato
    off-rail por conveniência.
    """
    items = _dedupe_number_markers(markers)
    if not items:
        return [], None

    buckets: dict[int, list[Any]] = collections.defaultdict(list)
    for item in items:
        width = float(page_widths.get(int(item.page_index)) or 0)
        if width <= 0:
            continue
        ratio = float(item.x0) / width
        # Trilhos de questão ficam dentro da área de conteúdo, não na margem
        # extrema. A faixa ainda suporta layouts em coluna esquerda/direita.
        if not 0.04 <= ratio <= 0.90:
            continue
        bucket = int(round(ratio / bucket_width))
        buckets[bucket].append(item)

    scored: list[tuple[int, int, int, float, list[Any]]] = []
    for bucket, values in buckets.items():
        numbers = {int(item.number) for item in values}
        pages = {int(item.page_index) for item in values}
        if len(numbers) < max(8, total // 3) or len(pages) < 4:
            continue
        ratios = sorted(
            float(item.x0) / float(page_widths[int(item.page_index)])
            for item in values
        )
        center = ratios[len(ratios) // 2]
        scored.append((len(numbers), len(pages), -bucket, center, values))

    if not scored:
        return items, None
    scored.sort(reverse=True)
    best_numbers, best_pages, _bucket, center, _values = scored[0]
    if len(scored) > 1:
        second_numbers, second_pages, *_rest = scored[1]
        # Sem vantagem clara, fail-closed: não filtramos por rail.
        if second_numbers >= best_numbers - max(3, total // 10) and second_pages >= best_pages - 2:
            return items, None

    selected: list[Any] = []
    by_number: dict[int, list[Any]] = collections.defaultdict(list)
    for item in items:
        by_number[int(item.number)].append(item)

    for number in range(1, total + 1):
        candidates = by_number.get(number, [])
        if not candidates:
            continue
        rail = [
            item
            for item in candidates
            if abs(
                float(item.x0) / float(page_widths[int(item.page_index)]) - center
            )
            <= tolerance
        ]
        if number == 1:
            # Q1 é a única exceção: a capa pode usar recuo diferente. O primeiro
            # candidato é estruturalmente compatível com o início da prova.
            selected.append(
                min(
                    candidates,
                    key=lambda item: _marker_reading_key(item, page_widths),
                )
            )
        elif rail:
            selected.extend(rail)
        # Sem rail: deixa faltar e força recuperação localizada.

    return _dedupe_number_markers(selected), center


def filter_recovery_between_known_neighbors(
    recovered: list[Any],
    known: list[Any],
    page_widths: dict[int, float],
) -> list[Any]:
    """Aceita recuperação só dentro do intervalo dos vizinhos conhecidos."""
    by_number: dict[int, list[Any]] = collections.defaultdict(list)
    for item in _dedupe_number_markers(known):
        by_number[int(item.number)].append(item)
    known_numbers = sorted(by_number)
    accepted: list[Any] = []

    for candidate in recovered:
        number = int(candidate.number)
        lower_numbers = [value for value in known_numbers if value < number]
        upper_numbers = [value for value in known_numbers if value > number]
        if not lower_numbers or not upper_numbers:
            continue
        lower = by_number[max(lower_numbers)]
        upper = by_number[min(upper_numbers)]
        key = _marker_reading_key(candidate, page_widths)
        if any(
            _marker_reading_key(left, page_widths) < key < _marker_reading_key(right, page_widths)
            for left in lower
            for right in upper
        ):
            accepted.append(candidate)
    return _dedupe_number_markers(accepted)


def unique_monotonic_marker_sequence(
    markers: list[Any],
    total: int,
    page_widths: dict[int, float],
    *,
    column_split: float = 0.42,
) -> list[Any] | None:
    """Resolve duplicatas somente quando existe um único caminho 1..N.

    O grafo liga um candidato de Qn a Q(n+1) apenas quando sua posição avança
    na ordem de leitura de página/coluna. Contamos caminhos até 2; portanto
    duas sequências plausíveis continuam ambíguas e falham fechado.
    """
    if not 0.2 <= column_split <= 0.8:
        raise OcrOptionMarkerError("column_split fora da faixa segura")

    markers = _dedupe_number_markers(markers)
    by_number: dict[int, list[Any]] = {
        number: [item for item in markers if item.number == number]
        for number in range(1, total + 1)
    }
    if any(not candidates for candidates in by_number.values()):
        return None

    def reading_key(marker: Any) -> tuple[int, int, float, float]:
        return _marker_reading_key(
            marker,
            page_widths,
            column_split=column_split,
        )

    levels: dict[int, list[Any]] = {}
    counts: dict[int, list[int]] = {}
    parents: dict[int, list[int | None]] = {}

    levels[1] = sorted(by_number[1], key=reading_key)
    counts[1] = [1] * len(levels[1])
    parents[1] = [None] * len(levels[1])

    for number in range(2, total + 1):
        previous = levels[number - 1]
        current = sorted(by_number[number], key=reading_key)
        current_counts: list[int] = []
        current_parents: list[int | None] = []

        for candidate in current:
            contributors: list[int] = []
            path_count = 0
            for index, prev in enumerate(previous):
                if counts[number - 1][index] == 0:
                    continue
                if reading_key(prev) >= reading_key(candidate):
                    continue
                contributors.append(index)
                path_count = min(2, path_count + counts[number - 1][index])

            current_counts.append(path_count)
            if path_count == 1:
                unique_parent = next(
                    (
                        index
                        for index in contributors
                        if counts[number - 1][index] == 1
                    ),
                    None,
                )
                current_parents.append(unique_parent)
            else:
                current_parents.append(None)

        levels[number] = current
        counts[number] = current_counts
        parents[number] = current_parents

    total_paths = min(2, sum(counts[total]))
    if total_paths != 1:
        return None

    final_index = next(index for index, count in enumerate(counts[total]) if count == 1)
    resolved: list[Any] = [levels[total][final_index]]
    index = final_index
    for number in range(total, 1, -1):
        parent = parents[number][index]
        if parent is None:
            return None
        index = parent
        resolved.append(levels[number - 1][index])
    resolved.reverse()
    return resolved


def _marker_geometry_diagnostics(
    markers: list[Any],
    page_widths: dict[int, float],
) -> dict[str, list[dict[str, float | int]]]:
    by_number: dict[int, list[Any]] = collections.defaultdict(list)
    for marker in _dedupe_number_markers(markers):
        by_number[int(marker.number)].append(marker)

    result: dict[str, list[dict[str, float | int]]] = {}
    for number, candidates in sorted(by_number.items()):
        if len(candidates) < 2:
            continue
        rows: list[dict[str, float | int]] = []
        for item in sorted(candidates, key=lambda x: (x.page_index, x.y0, x.x0)):
            width = float(page_widths.get(item.page_index) or 1.0)
            rows.append(
                {
                    "p": int(item.page_index) + 1,
                    "x": round(float(item.x0), 1),
                    "y": round(float(item.y0), 1),
                    "xr": round(float(item.x0) / width, 3),
                }
            )
        result[str(number)] = rows
    return result


def _neighbor_recovery_pages(
    markers: list[Any],
    missing_numbers: set[int],
    total: int,
    *,
    max_page_gap: int = 3,
) -> set[int]:
    """Restringe OCR caro às páginas entre os vizinhos conhecidos mais próximos.

    Usa o conhecido anterior/posterior, não apenas n-1/n+1, para suportar dois
    ou mais marcadores consecutivos ausentes sem ampliar a busca ao documento.
    """
    by_number: dict[int, list[Any]] = collections.defaultdict(list)
    for marker in _dedupe_number_markers(markers):
        by_number[int(marker.number)].append(marker)
    known_numbers = sorted(by_number)

    pages: set[int] = set()
    for number in sorted(missing_numbers):
        lower_numbers = [value for value in known_numbers if value < number]
        upper_numbers = [value for value in known_numbers if value > number]
        previous = by_number[max(lower_numbers)] if lower_numbers else []
        following = by_number[min(upper_numbers)] if upper_numbers else []

        if previous and following:
            for left in previous:
                for right in following:
                    if left.page_index > right.page_index:
                        continue
                    gap = int(right.page_index) - int(left.page_index)
                    if gap > max_page_gap:
                        continue
                    pages.update(range(int(left.page_index), int(right.page_index) + 1))
        elif previous:
            pages.update(int(item.page_index) for item in previous)
        elif following:
            pages.update(int(item.page_index) for item in following)

    return pages


def _page_tsv(page: Any, fitz: Any, tesseract: str, dpi: int, psm: int) -> str:
    scale = dpi / 72.0
    pix = page.get_pixmap(
        matrix=fitz.Matrix(scale, scale),
        colorspace=fitz.csGRAY,
        alpha=False,
    )
    env = dict(os.environ)
    env.setdefault("OMP_THREAD_LIMIT", "1")
    result = subprocess.run(
        [
            tesseract,
            "stdin",
            "stdout",
            "--dpi",
            str(dpi),
            "--psm",
            str(psm),
            "tsv",
        ],
        input=pix.tobytes("png"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        env=env,
    )
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise OcrOptionMarkerError(f"tesseract falhou: {detail[:240]}")
    return result.stdout.decode("utf-8", errors="replace")


def _fitz():
    try:
        import pymupdf as fitz  # type: ignore
    except ImportError:
        try:
            import fitz  # type: ignore
        except ImportError as error:
            raise OcrOptionMarkerError("PyMuPDF indisponível") from error
    return fitz


def _tesseract() -> str:
    executable = shutil.which("tesseract")
    if not executable:
        raise OcrOptionMarkerError("tesseract indisponível para fallback estrutural")
    return executable


def detect_ocr_number_marker_candidates(
    pdf: Path,
    option_ids: tuple[str, ...],
    total: int,
    marker_factory: Callable[..., Any],
    *,
    dpi: int = 216,
    x_ranges: tuple[tuple[float, float], ...] = ((0.0, 0.22),),
    require_option_evidence: bool = True,
    line_anchored_only: bool = False,
    allow_digit_confusions: bool = False,
) -> list[tuple[str, list[Any]]]:
    if not 144 <= dpi <= 300:
        raise OcrOptionMarkerError("dpi OCR fora da faixa segura")
    fitz = _fitz()
    tesseract = _tesseract()
    doc = fitz.open(pdf)
    try:
        candidates: list[tuple[str, list[Any]]] = []
        merged_line_markers: list[Any] = []
        page_widths = {
            page_index: float(page.rect.width)
            for page_index, page in enumerate(doc)
        }
        page_heights = {
            page_index: float(page.rect.height)
            for page_index, page in enumerate(doc)
        }
        psm_modes = (11, 6, 3, 12) if line_anchored_only else (11, 6)

        for psm in psm_modes:
            markers: list[Any] = []
            for page_index, page in enumerate(doc):
                payload = _page_tsv(page, fitz, tesseract, dpi, psm)
                scale = dpi / 72.0
                options = labels_from_tsv(
                    payload,
                    page_index=page_index,
                    scale=scale,
                )
                # Capa/instruções podem conter listas numeradas. O perfil
                # histórico exige alternativas; scans como o ITA usam um
                # detector de início de linha e dispensam essa pré-condição.
                if require_option_evidence and len(options) < 2:
                    continue
                if line_anchored_only:
                    page_markers = line_question_markers_from_tsv(
                        payload,
                        page_index=page_index,
                        scale=scale,
                        page_width=float(page.rect.width),
                        page_height=float(page.rect.height),
                        total=total,
                        marker_factory=marker_factory,
                        x_ranges=x_ranges,
                        allow_digit_confusions=allow_digit_confusions,
                    )
                else:
                    page_markers = number_markers_from_tsv(
                        payload,
                        page_index=page_index,
                        scale=scale,
                        page_width=float(page.rect.width),
                        page_height=float(page.rect.height),
                        total=total,
                        marker_factory=marker_factory,
                        x_ranges=x_ranges,
                    )
                markers.extend(page_markers)

            if markers:
                strategy = "ocr-number-line" if line_anchored_only else "ocr-number"
                candidates.append((f"{strategy}-psm{psm}", markers))

            if line_anchored_only:
                merged_line_markers.extend(markers)
                resolved = unique_monotonic_marker_sequence(
                    merged_line_markers,
                    total,
                    page_widths,
                )
                if resolved is not None:
                    # Coloca o candidato provado antes dos passes individuais.
                    return [("ocr-number-line-monotonic", resolved), *candidates]

        if line_anchored_only and merged_line_markers:
            merged_line_markers = _dedupe_number_markers(merged_line_markers)
            cleaned_line_markers = suppress_structural_number_noise(
                merged_line_markers,
                page_widths,
                page_heights,
            )
            rail_markers, rail_center = select_dominant_question_rail(
                cleaned_line_markers,
                total,
                page_widths,
            )
            resolved = unique_monotonic_marker_sequence(
                rail_markers,
                total,
                page_widths,
            )
            if resolved is not None:
                strategy = (
                    "ocr-number-line-dominant-rail"
                    if rail_center is not None
                    else "ocr-number-line-structural"
                )
                return [(strategy, resolved), *candidates]

            present = {int(item.number) for item in rail_markers}
            missing = set(range(1, total + 1)) - present

            # Quando o rail comprovado perde poucos números, fazemos recuperação
            # localizada entre vizinhos conhecidos. O teto é maior que o antigo
            # porque agora cada leitura também é limitada ao número esperado e
            # ao intervalo físico, mantendo o fail-closed.
            if 0 < len(missing) <= 8:
                recovery_pages = _neighbor_recovery_pages(
                    rail_markers,
                    missing,
                    total,
                )
                if recovery_pages:
                    recovery_dpi = 300
                    for psm in (4, 11, 6, 3, 12):
                        recovered: list[Any] = []
                        for page_index in sorted(recovery_pages):
                            page = doc[page_index]
                            payload = _page_tsv(
                                page,
                                fitz,
                                tesseract,
                                recovery_dpi,
                                psm,
                            )
                            recovered.extend(
                                line_question_markers_from_tsv(
                                    payload,
                                    page_index=page_index,
                                    scale=recovery_dpi / 72.0,
                                    page_width=float(page.rect.width),
                                    page_height=float(page.rect.height),
                                    total=total,
                                    marker_factory=marker_factory,
                                    x_ranges=x_ranges,
                                    allow_digit_confusions=True,
                                    expected_numbers=set(missing),
                                    allow_pure_digit_confusions=True,
                                )
                            )
                        recovered = filter_recovery_between_known_neighbors(
                            recovered,
                            rail_markers,
                            page_widths,
                        )
                        rail_markers.extend(recovered)
                        rail_markers = _dedupe_number_markers(rail_markers)
                        resolved = unique_monotonic_marker_sequence(
                            rail_markers,
                            total,
                            page_widths,
                        )
                        if resolved is not None:
                            return [
                                (f"ocr-number-line-monotonic-recovery-psm{psm}", resolved),
                                *candidates,
                            ]

            # Diagnóstico explícito para o gate: mostra a cobertura combinada
            # de todas as passadas quando ainda não há uma sequência única.
            print(
                "OCR_MARKER_GEOMETRY "
                + json.dumps(
                    _marker_geometry_diagnostics(
                        merged_line_markers,
                        page_widths,
                    ),
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                file=sys.stderr,
            )
            candidates.append(
                ("ocr-number-line-merged", rail_markers)
            )

        return candidates
    finally:
        doc.close()


def detect_ocr_option_groups(
    pdf: Path,
    option_ids: tuple[str, ...],
    total: int,
    *,
    dpi: int = 180,
) -> list[option_markers.OptionGroup]:
    if not 144 <= dpi <= 300:
        raise OcrOptionMarkerError("dpi OCR fora da faixa segura")
    fitz = _fitz()
    tesseract = _tesseract()
    doc = fitz.open(pdf)
    required = total * len(option_ids)

    def try_groups(
        labels: list[option_markers.OptionLabel],
        strategy: str,
    ) -> list[option_markers.OptionGroup] | None:
        labels = _dedupe_labels(labels)
        counts = collections.Counter(label.letter for label in labels)
        if any(counts[letter] < total for letter in option_ids):
            return None
        noise = len(labels) - required
        if noise < 0:
            return None
        noise_limit = max(12, min(24, total // 2))
        if noise > noise_limit:
            return None
        try:
            groups = option_markers.detect_visual_ordered_option_groups(
                doc,
                labels,
                option_ids,
                total,
                max_noise=noise_limit,
            )
        except option_markers.OrderedOptionMarkerError:
            return None
        return [
            option_markers.OptionGroup(
                page_index=group.page_index,
                kind=f"ocr-{strategy}-{group.kind}",
                x0=group.x0,
                y0=group.y0,
                x1=group.x1,
                y1=group.y1,
                core_y1=group.core_y1,
            )
            for group in groups
        ]

    try:
        strict_11: list[option_markers.OptionLabel] = []
        payloads_11: list[tuple[int, str]] = []
        for page_index, page in enumerate(doc):
            payload = _page_tsv(page, fitz, tesseract, dpi, 11)
            payloads_11.append((page_index, payload))
            strict_11.extend(
                labels_from_tsv(
                    payload,
                    page_index=page_index,
                    scale=dpi / 72.0,
                )
            )
        if not strict_11:
            raise OcrOptionMarkerError("OCR não encontrou rótulos pontuados de alternativas")

        groups = try_groups(strict_11, "psm11")
        if groups is not None:
            return groups

        strict_6: list[option_markers.OptionLabel] = []
        relaxed: list[option_markers.OptionLabel] = []
        for page_index, page in enumerate(doc):
            payload = _page_tsv(page, fitz, tesseract, dpi, 6)
            strict_6.extend(
                labels_from_tsv(
                    payload,
                    page_index=page_index,
                    scale=dpi / 72.0,
                )
            )
            relaxed.extend(
                labels_from_tsv(
                    payload,
                    page_index=page_index,
                    scale=dpi / 72.0,
                    allow_bare=True,
                )
            )
        for page_index, payload in payloads_11:
            relaxed.extend(
                labels_from_tsv(
                    payload,
                    page_index=page_index,
                    scale=dpi / 72.0,
                    allow_bare=True,
                )
            )

        merged_strict = _dedupe_labels([*strict_11, *strict_6])
        groups = try_groups(merged_strict, "merged-strict")
        if groups is not None:
            return groups

        strict_counts = collections.Counter(label.letter for label in merged_strict)
        relaxed_deduped = _dedupe_labels(relaxed)
        deficient_relaxed = [
            label
            for label in relaxed_deduped
            if strict_counts[label.letter] < total
        ]
        anchored_bare = _anchored_bare_labels(
            doc,
            merged_strict,
            deficient_relaxed,
            option_ids,
        )
        if any(strict_counts[letter] < total for letter in option_ids):
            groups = try_groups(
                [*merged_strict, *anchored_bare],
                "anchored-bare",
            )
            if groups is not None:
                return groups

        final_labels = _dedupe_labels([*merged_strict, *anchored_bare])
        final_counts = collections.Counter(label.letter for label in final_labels)
        count_summary = ",".join(
            f"{letter}:{final_counts[letter]}" for letter in option_ids
        )
        raise OcrOptionMarkerError(
            "OCR de alternativas não provou partição única: "
            f"{len(final_labels)} rótulos ({count_summary}) para {total} questões"
        )
    finally:
        doc.close()

