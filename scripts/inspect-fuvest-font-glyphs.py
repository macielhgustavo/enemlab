#!/usr/bin/env python3
"""Diagnostica glifos suspeitos da camada textual FUVEST por fonte PDF.

O objetivo é separar exceções que podem ganhar um mapeamento determinístico de
fonte das que precisam de OCR/vision. O script NÃO altera conteúdo.

Para cada fragmento emitido pelo pypdf, registra codepoint suspeito, BaseFont,
subtipo, presença de ToUnicode, fingerprint do programa de fonte embutido e,
quando possível, o código-fonte do CMap que está sendo traduzido para o
codepoint problemático.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import re
import runpy
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable

from pypdf import PdfReader

QUESTIONS = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))
SUSPECT_CATEGORIES = {"Cc", "Cf", "Co"}
IGNORED_CONTROLS = {"\n", "\r", "\t", "\u00ad"}
WORKER_VERSION = "fuvest-font-glyph-inspector@0.1.1"


def is_suspicious(char: str) -> bool:
    return char == "\ufffd" or (
        unicodedata.category(char) in SUSPECT_CATEGORIES and char not in IGNORED_CONTROLS
    )


def dereference(value: Any) -> Any:
    getter = getattr(value, "get_object", None)
    return getter() if callable(getter) else value


def to_unicode_bytes(font_dict: Any) -> bytes | None:
    if not font_dict:
        return None
    value = dereference(font_dict).get("/ToUnicode")
    if value is None:
        return None
    stream = dereference(value)
    getter = getattr(stream, "get_data", None)
    if not callable(getter):
        return None
    try:
        return bytes(getter())
    except Exception:  # noqa: BLE001 - diagnostics must not break extraction
        return None


def embedded_font_bytes(font_dict: Any) -> bytes | None:
    if not font_dict:
        return None
    font = dereference(font_dict)
    descriptor = font.get("/FontDescriptor")
    if descriptor is None and font.get("/DescendantFonts"):
        descendants = dereference(font.get("/DescendantFonts"))
        if descendants:
            descendant = dereference(descendants[0])
            descriptor = descendant.get("/FontDescriptor")
    if descriptor is None:
        return None
    descriptor = dereference(descriptor)
    for key in ("/FontFile", "/FontFile2", "/FontFile3"):
        stream_ref = descriptor.get(key)
        if stream_ref is None:
            continue
        stream = dereference(stream_ref)
        getter = getattr(stream, "get_data", None)
        if not callable(getter):
            continue
        try:
            return bytes(getter())
        except Exception:  # noqa: BLE001
            continue
    return None


def _decode_hex_unicode(value: str) -> str | None:
    try:
        raw = bytes.fromhex(value)
    except ValueError:
        return None
    if not raw or len(raw) % 2:
        return None
    try:
        return raw.decode("utf-16-be")
    except UnicodeDecodeError:
        return None


def parse_tounicode_sources(data: bytes | None) -> dict[str, list[str]]:
    """Return destination Unicode text -> source CMap hex codes.

    Supports common bfchar and single-destination bfrange forms. Array bfrange
    values are intentionally ignored rather than guessed.
    """
    if not data:
        return {}
    text = data.decode("latin-1", errors="ignore")
    result: dict[str, list[str]] = collections.defaultdict(list)

    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, flags=re.S):
        for source, destination in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            decoded = _decode_hex_unicode(destination)
            if decoded is not None:
                result[decoded].append(source.upper())

    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, flags=re.S):
        for start, end, destination in re.findall(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>",
            block,
        ):
            try:
                start_value = int(start, 16)
                end_value = int(end, 16)
                destination_value = int(destination, 16)
            except ValueError:
                continue
            width = len(destination)
            if end_value < start_value or end_value - start_value > 4096:
                continue
            for offset, source_value in enumerate(range(start_value, end_value + 1)):
                dest_hex = f"{destination_value + offset:0{width}X}"
                decoded = _decode_hex_unicode(dest_hex)
                if decoded is not None:
                    result[decoded].append(f"{source_value:0{len(start)}X}")

    return {key: sorted(set(values)) for key, values in result.items()}


def font_identity(font_dict: Any) -> dict[str, Any]:
    if not font_dict:
        return {
            "baseFont": "<unknown>",
            "subtype": "<unknown>",
            "encoding": None,
            "hasToUnicode": False,
            "fontSha256": None,
        }
    font = dereference(font_dict)
    embedded = embedded_font_bytes(font)
    encoding = font.get("/Encoding")
    if encoding is not None:
        encoding = str(dereference(encoding))
    return {
        "baseFont": str(font.get("/BaseFont", "<unknown>")),
        "subtype": str(font.get("/Subtype", "<unknown>")),
        "encoding": encoding,
        "hasToUnicode": to_unicode_bytes(font) is not None,
        "fontSha256": hashlib.sha256(embedded).hexdigest() if embedded else None,
    }


def inspect_pdf(year: int, pdf_bytes: bytes) -> list[dict[str, Any]]:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    observations: list[dict[str, Any]] = []
    font_cache: dict[int, tuple[dict[str, Any], dict[str, list[str]]]] = {}

    for page_number, page in enumerate(reader.pages, start=1):
        def visitor(text: str, _cm: Any, _tm: Any, font_dict: Any, font_size: float) -> None:
            if not text or not any(is_suspicious(char) for char in text):
                return
            cache_key = id(font_dict)
            cached = font_cache.get(cache_key)
            if cached is None:
                identity = font_identity(font_dict)
                cmap = parse_tounicode_sources(to_unicode_bytes(font_dict))
                cached = (identity, cmap)
                font_cache[cache_key] = cached
            identity, cmap = cached
            for index, char in enumerate(text):
                if not is_suspicious(char):
                    continue
                observations.append(
                    {
                        "year": year,
                        "page": page_number,
                        "codepoint": f"U+{ord(char):04X}",
                        "category": unicodedata.category(char),
                        "unicodeName": unicodedata.name(char, "<unnamed>"),
                        **identity,
                        "cmapSources": cmap.get(char, []),
                        "fontSize": round(float(font_size or 0), 3),
                        "context": text[max(0, index - 20):index] + "<X>" + text[index + 1:index + 21],
                    }
                )

        page.extract_text(visitor_text=visitor)

    return observations


def summarize(observations: Iterable[dict[str, Any]]) -> dict[str, Any]:
    observations = list(observations)
    cluster_counts: collections.Counter[tuple[Any, ...]] = collections.Counter()
    cluster_years: dict[tuple[Any, ...], set[int]] = collections.defaultdict(set)
    examples: dict[tuple[Any, ...], dict[str, Any]] = {}

    for item in observations:
        key = (
            item["codepoint"],
            item["baseFont"],
            item["subtype"],
            item["fontSha256"],
            tuple(item["cmapSources"]),
        )
        cluster_counts[key] += 1
        cluster_years[key].add(int(item["year"]))
        examples.setdefault(key, item)

    clusters = []
    for key, count in cluster_counts.most_common():
        example = examples[key]
        clusters.append(
            {
                "codepoint": key[0],
                "baseFont": key[1],
                "subtype": key[2],
                "fontSha256": key[3],
                "cmapSources": list(key[4]),
                "count": count,
                "editions": len(cluster_years[key]),
                "years": sorted(cluster_years[key]),
                "hasToUnicode": example["hasToUnicode"],
                "encoding": example["encoding"],
                "fontSize": example["fontSize"],
                "context": example["context"],
            }
        )

    return {
        "workerVersion": WORKER_VERSION,
        "observations": len(observations),
        "clusters": len(clusters),
        "withToUnicode": sum(bool(item["hasToUnicode"]) for item in observations),
        "withCmapSource": sum(bool(item["cmapSources"]) for item in observations),
        "withEmbeddedFont": sum(bool(item["fontSha256"]) for item in observations),
        "topClusters": clusters[:80],
    }


def parse_years(raw: str, manifest: dict[str, dict[str, Any]]) -> list[int]:
    eligible = sorted(
        int(year)
        for year, entry in manifest.items()
        if entry.get("examUrl") and entry.get("answerKeyUrl")
    )
    if raw.strip().lower() == "all":
        return eligible
    requested = sorted({int(part.strip()) for part in raw.split(",") if part.strip()})
    unknown = [year for year in requested if year not in eligible]
    if unknown:
        raise ValueError(f"edições sem caderno canônico: {unknown}")
    return requested


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", default="all")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args(argv)
    if args.concurrency < 1 or args.concurrency > 8:
        raise ValueError("concurrency must be between 1 and 8")

    manifest = QUESTIONS["load_manifest"]()
    years = parse_years(args.years, manifest)
    observations: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    def inspect_year(year: int) -> tuple[int, list[dict[str, Any]]]:
        pdf_bytes = QUESTIONS["fetch"](manifest[str(year)]["examUrl"])
        return year, inspect_pdf(year, pdf_bytes)

    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {executor.submit(inspect_year, year): year for year in years}
        for future in as_completed(futures):
            year = futures[future]
            try:
                _, found = future.result()
                observations.extend(found)
            except Exception as error:  # noqa: BLE001
                failures.append({"year": year, "error": str(error)})
                print(f"FUVEST {year}: GLYPH INSPECTION BLOCKED — {error}", file=sys.stderr)

    report = summarize(observations)
    report["requestedEditions"] = len(years)
    report["failures"] = sorted(failures, key=lambda item: int(item["year"]))
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
