#!/usr/bin/env python3
"""Recupera glifos FUVEST somente quando a própria fonte embutida prova o Unicode.

Este worker existe para reduzir exceções de fidelidade semântica sem fazer
substituições globais como ``U+0003 -> espaço``. Uma correção automática só é
permitida quando conseguimos provar a cadeia:

    fonte embutida (SHA-256) + CID -> GID -> glyph -> único Unicode portátil

O caminho inicial aceita fontes Type0 com Identity-H e CIDFontType2. Type3 sem
fonte embutida/ToUnicode não é adivinhada: fica explicitamente sem resolução e
deve seguir para OCR/vision regional. Todo envelope reparado precisa voltar ao
parser e aos gates canônicos do ENEMLab.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import runpy
import sys
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))
WORKER_NAME = "fuvest-proof-font-map"
WORKER_VERSION = "fuvest-proof-font-map@0.1.0"
IGNORED_CONTROLS = {"\n", "\r", "\t", "\u00ad"}


def is_suspicious(char: str) -> bool:
    return char == "\ufffd" or (
        unicodedata.category(char) in {"Cc", "Cf", "Co"} and char not in IGNORED_CONTROLS
    )


def is_portable_replacement(value: str) -> bool:
    if len(value) != 1 or value in IGNORED_CONTROLS:
        return False
    if value == "\ufffd":
        return False
    return unicodedata.category(value) not in {"Cc", "Cf", "Co", "Cs", "Cn"}


def dereference(value: Any) -> Any:
    getter = getattr(value, "get_object", None)
    return getter() if callable(getter) else value


def to_unicode_bytes(font_dict: Any) -> bytes | None:
    if not font_dict:
        return None
    font = dereference(font_dict)
    value = font.get("/ToUnicode")
    if value is None:
        return None
    stream = dereference(value)
    getter = getattr(stream, "get_data", None)
    if not callable(getter):
        return None
    try:
        return bytes(getter())
    except Exception:  # noqa: BLE001 - recovery must fail closed per font
        return None


def descendant_font(font_dict: Any) -> Any | None:
    if not font_dict:
        return None
    font = dereference(font_dict)
    descendants = font.get("/DescendantFonts")
    if not descendants:
        return None
    values = dereference(descendants)
    if not values:
        return None
    return dereference(values[0])


def embedded_font_bytes(font_dict: Any) -> bytes | None:
    descendant = descendant_font(font_dict)
    candidates = [descendant, dereference(font_dict) if font_dict else None]
    for candidate in candidates:
        if not candidate:
            continue
        descriptor = candidate.get("/FontDescriptor")
        if descriptor is None:
            continue
        descriptor = dereference(descriptor)
        for key in ("/FontFile2", "/FontFile3", "/FontFile"):
            ref = descriptor.get(key)
            if ref is None:
                continue
            stream = dereference(ref)
            getter = getattr(stream, "get_data", None)
            if not callable(getter):
                continue
            try:
                return bytes(getter())
            except Exception:  # noqa: BLE001
                continue
    return None


def cid_to_gid_from_stream(data: bytes, cid: int) -> int | None:
    offset = cid * 2
    if cid < 0 or offset + 2 > len(data):
        return None
    return int.from_bytes(data[offset : offset + 2], "big")


def cid_to_gid(font_dict: Any, cid: int) -> int | None:
    descendant = descendant_font(font_dict)
    if not descendant or str(descendant.get("/Subtype", "")) != "/CIDFontType2":
        return None
    mapping = descendant.get("/CIDToGIDMap")
    if mapping is None:
        # PDF CIDFontType2 defaults to identity only when no explicit map is
        # present. We still require Identity-H at the parent before reaching
        # this function.
        return cid
    resolved = dereference(mapping)
    if str(resolved) == "/Identity":
        return cid
    getter = getattr(resolved, "get_data", None)
    if not callable(getter):
        return None
    try:
        return cid_to_gid_from_stream(bytes(getter()), cid)
    except Exception:  # noqa: BLE001
        return None


def reverse_unicode_cmap(font_bytes: bytes) -> tuple[list[str], dict[str, set[str]]]:
    try:
        from fontTools.ttLib import TTFont
    except ImportError as error:  # pragma: no cover - exercised by benchmark/CLI
        raise RuntimeError("fontTools is required for proof-aware font recovery") from error

    font = TTFont(io.BytesIO(font_bytes), lazy=True, recalcBBoxes=False, recalcTimestamp=False)
    try:
        glyph_order = list(font.getGlyphOrder())
        reverse: dict[str, set[str]] = collections.defaultdict(set)
        cmap_table = font.get("cmap")
        if cmap_table is None:
            return glyph_order, {}
        for table in cmap_table.tables:
            if not table.isUnicode():
                continue
            for codepoint, glyph_name in table.cmap.items():
                try:
                    value = chr(int(codepoint))
                except (TypeError, ValueError, OverflowError):
                    continue
                if is_portable_replacement(value):
                    reverse[str(glyph_name)].add(value)
        return glyph_order, dict(reverse)
    finally:
        font.close()


def unique_gid_unicode(
    glyph_order: list[str], reverse_cmap: dict[str, set[str]], gid: int
) -> str | None:
    if gid < 0 or gid >= len(glyph_order):
        return None
    candidates = {
        value for value in reverse_cmap.get(glyph_order[gid], set()) if is_portable_replacement(value)
    }
    if len(candidates) != 1:
        return None
    return next(iter(candidates))


def font_identity(font_dict: Any, embedded: bytes | None) -> dict[str, Any]:
    font = dereference(font_dict) if font_dict else {}
    descendant = descendant_font(font_dict)
    return {
        "baseFont": str(font.get("/BaseFont", "<unknown>")),
        "subtype": str(font.get("/Subtype", "<unknown>")),
        "encoding": str(dereference(font.get("/Encoding"))) if font.get("/Encoding") else None,
        "descendantSubtype": str(descendant.get("/Subtype", "<unknown>")) if descendant else None,
        "hasToUnicode": to_unicode_bytes(font_dict) is not None,
        "fontSha256": hashlib.sha256(embedded).hexdigest() if embedded else None,
    }


def resolve_char(
    font_dict: Any,
    char: str,
    cache: dict[str, tuple[list[str], dict[str, set[str]]]],
) -> dict[str, Any] | None:
    if not is_suspicious(char) or not font_dict:
        return None
    font = dereference(font_dict)
    if str(font.get("/Subtype", "")) != "/Type0":
        return None
    if str(dereference(font.get("/Encoding"))) != "/Identity-H":
        return None
    if to_unicode_bytes(font_dict) is not None:
        # A malformed ToUnicode needs a separate source-code-aware path. Do not
        # assume the decoded suspicious character is the source CID.
        return None

    embedded = embedded_font_bytes(font_dict)
    if not embedded:
        return None
    font_sha = hashlib.sha256(embedded).hexdigest()
    glyph_data = cache.get(font_sha)
    if glyph_data is None:
        try:
            glyph_data = reverse_unicode_cmap(embedded)
        except Exception:  # noqa: BLE001 - unsupported/corrupt font remains unresolved
            return None
        cache[font_sha] = glyph_data

    cid = ord(char)
    gid = cid_to_gid(font_dict, cid)
    if gid is None:
        return None
    replacement = unique_gid_unicode(glyph_data[0], glyph_data[1], gid)
    if replacement is None:
        return None
    identity = font_identity(font_dict, embedded)
    return {
        **identity,
        "sourceCodepoint": f"U+{cid:04X}",
        "cid": cid,
        "gid": gid,
        "replacement": replacement,
        "replacementCodepoint": f"U+{ord(replacement):04X}",
    }


def repair_pdf_pages(pdf_bytes: bytes) -> tuple[list[str], dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except ImportError as error:  # pragma: no cover
        raise RuntimeError("pypdf is required for font-map recovery") from error

    reader = PdfReader(io.BytesIO(pdf_bytes))
    font_cache: dict[str, tuple[list[str], dict[str, set[str]]]] = {}
    pages: list[str] = []
    mapping_counts: collections.Counter[tuple[str, int, int, str]] = collections.Counter()
    unresolved_counts: collections.Counter[tuple[str, str, str]] = collections.Counter()
    resolved = 0
    unresolved = 0

    for page in reader.pages:
        fragments: list[str] = []

        def visitor(text: str, _cm: Any, _tm: Any, font_dict: Any, _font_size: float) -> None:
            nonlocal resolved, unresolved
            if not text:
                return
            output: list[str] = []
            embedded = embedded_font_bytes(font_dict) if font_dict else None
            identity = font_identity(font_dict, embedded)
            for char in text:
                if not is_suspicious(char):
                    output.append(char)
                    continue
                resolution = resolve_char(font_dict, char, font_cache)
                if resolution is None:
                    output.append(char)
                    unresolved += 1
                    unresolved_counts[
                        (
                            f"U+{ord(char):04X}",
                            identity["subtype"],
                            identity["baseFont"],
                        )
                    ] += 1
                    continue
                output.append(str(resolution["replacement"]))
                resolved += 1
                mapping_counts[
                    (
                        str(resolution["fontSha256"]),
                        int(resolution["cid"]),
                        int(resolution["gid"]),
                        str(resolution["replacement"]),
                    )
                ] += 1
            fragments.append("".join(output))

        page.extract_text(visitor_text=visitor)
        pages.append("".join(fragments))

    mappings = [
        {
            "fontSha256": key[0],
            "cid": key[1],
            "gid": key[2],
            "replacement": key[3],
            "replacementCodepoint": f"U+{ord(key[3]):04X}",
            "occurrences": count,
        }
        for key, count in mapping_counts.most_common()
    ]
    unresolved_clusters = [
        {
            "codepoint": key[0],
            "subtype": key[1],
            "baseFont": key[2],
            "occurrences": count,
        }
        for key, count in unresolved_counts.most_common()
    ]
    return pages, {
        "workerVersion": WORKER_VERSION,
        "resolvedOccurrences": resolved,
        "unresolvedOccurrences": unresolved,
        "provenMappings": mappings,
        "unresolvedClusters": unresolved_clusters,
    }


def diagnose_year(year: int, manifest: dict[str, dict[str, Any]]) -> dict[str, Any]:
    entry = manifest[str(year)]
    QUESTIONS["validate_manifest_entry"](entry, year)
    pdf_bytes = QUESTIONS["fetch"](entry["examUrl"])
    pages, report = repair_pdf_pages(pdf_bytes)
    result = {
        "year": year,
        **report,
        "pageCount": len(pages),
        "parserClosed": False,
        "questions": 0,
        "semanticIssues": 0,
    }
    try:
        questions = QUESTIONS["parse_questions"](
            pages,
            int(entry["total"]),
            str(entry.get("canonicalVariant") or ""),
        )
        result["questions"] = len(questions)
        result["semanticIssues"] = len(QUESTIONS["semantic_issues_for_questions"](pages, questions))
    except Exception as error:  # noqa: BLE001
        result["parserClosed"] = True
        result["parserError"] = str(error)
    return result


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


def summarize(results: list[dict[str, Any]], failures: list[dict[str, Any]]) -> dict[str, Any]:
    mappings: collections.Counter[tuple[str, int, int, str]] = collections.Counter()
    for result in results:
        for mapping in result.get("provenMappings", []):
            mappings[
                (
                    mapping["fontSha256"],
                    int(mapping["cid"]),
                    int(mapping["gid"]),
                    mapping["replacement"],
                )
            ] += int(mapping["occurrences"])
    return {
        "workerVersion": WORKER_VERSION,
        "editions": len(results),
        "resolvedOccurrences": sum(int(item["resolvedOccurrences"]) for item in results),
        "unresolvedOccurrences": sum(int(item["unresolvedOccurrences"]) for item in results),
        "parserClosedEditions": sum(bool(item["parserClosed"]) for item in results),
        "provenMappings": [
            {
                "fontSha256": key[0],
                "cid": key[1],
                "gid": key[2],
                "replacement": key[3],
                "replacementCodepoint": f"U+{ord(key[3]):04X}",
                "occurrences": count,
            }
            for key, count in mappings.most_common()
        ],
        "failures": sorted(failures, key=lambda item: int(item["year"])),
        "results": sorted(results, key=lambda item: int(item["year"])),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", default="2014,2015")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    manifest = QUESTIONS["load_manifest"]()
    years = parse_years(args.years, manifest)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for year in years:
        try:
            results.append(diagnose_year(year, manifest))
        except Exception as error:  # noqa: BLE001
            failures.append({"year": year, "error": str(error)})
            print(f"FUVEST {year}: FONT MAP BLOCKED — {error}", file=sys.stderr)

    report = summarize(results, failures)
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
