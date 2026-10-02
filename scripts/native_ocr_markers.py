#!/usr/bin/env python3
"""OCR-backed marker detection for scanned NativePack providers.

This module is deliberately narrow: it only turns OCR text blocks into the
same Marker objects used by `native_pipeline.py`. Number coverage is still
validated by the pipeline, so missing/duplicate markers fail closed.
"""

from __future__ import annotations

import re
from typing import Any, Callable


class NativeOcrMarkerError(RuntimeError):
    pass


def _ocr_blocks(page: Any, *, language: str, dpi: int) -> list[Any]:
    try:
        text_page = page.get_textpage_ocr(language=language, dpi=dpi, full=False)
    except Exception as error:
        raise NativeOcrMarkerError(
            "OCR indisponível; instale tesseract-ocr e o idioma necessário"
        ) from error
    try:
        return list(text_page.extractBLOCKS())
    except Exception as error:
        raise NativeOcrMarkerError("OCR não retornou blocos de texto utilizáveis") from error


def detect_markers(
    doc: Any,
    pattern: str,
    marker_factory: Callable[..., Any],
    *,
    language: str = "por+eng",
    dpi: int = 220,
) -> list[Any]:
    marker_re = re.compile(pattern, re.IGNORECASE)
    markers: list[Any] = []
    for page_index, page in enumerate(doc):
        for block in _ocr_blocks(page, language=language, dpi=dpi):
            if len(block) < 5:
                continue
            text = str(block[4])
            for match in marker_re.finditer(text):
                markers.append(
                    marker_factory(
                        number=int(match.group(1)),
                        page_index=page_index,
                        x0=float(block[0]),
                        y0=float(block[1]),
                        x1=float(block[2]),
                        y1=float(block[3]),
                    )
                )
    return markers
