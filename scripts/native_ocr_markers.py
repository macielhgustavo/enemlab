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
import os
import re
import shutil
import subprocess
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
        explicit = False
        for index, (_row, raw, _confidence) in enumerate(parsed[:4]):
            normalized = _normalized_ocr_word(raw)
            if normalized not in {"questao", "q"} or index + 1 >= len(parsed):
                continue
            candidate = re.sub(r"\s+", "", parsed[index + 1][1])
            if _NUMBER_TOKEN.fullmatch(candidate):
                number_row = parsed[index + 1][0]
                explicit = True
                break

        if number_row is None:
            first_row, first_raw, _confidence = parsed[0]
            if _NUMBER_TOKEN.fullmatch(re.sub(r"\s+", "", first_raw)):
                number_row = first_row

        if number_row is None:
            continue

        token = re.sub(r"\s+", "", str(number_row.get("text") or ""))
        match = _NUMBER_TOKEN.fullmatch(token)
        if not match:
            continue
        number = int(match.group(1))
        if not 1 <= number <= total:
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
) -> list[tuple[str, list[Any]]]:
    if not 144 <= dpi <= 300:
        raise OcrOptionMarkerError("dpi OCR fora da faixa segura")
    fitz = _fitz()
    tesseract = _tesseract()
    doc = fitz.open(pdf)
    try:
        candidates: list[tuple[str, list[Any]]] = []
        for psm in (11, 6):
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

