#!/usr/bin/env python3
"""Diagnóstico temporário dos estágios de prova do font-map FUVEST."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import runpy
from collections import Counter
from pathlib import Path
from typing import Any

QUESTIONS = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))
RECOVERY = runpy.run_path(str(Path(__file__).with_name("recover-fuvest-font-map.py")))


def inspect_year(year: int) -> dict[str, Any]:
    from pypdf import PdfReader

    manifest = QUESTIONS["load_manifest"]()
    entry = manifest[str(year)]
    pdf_bytes = QUESTIONS["fetch"](entry["examUrl"])
    reader = PdfReader(io.BytesIO(pdf_bytes))
    seen: set[tuple[str, str]] = set()
    samples: list[dict[str, Any]] = []
    reasons: Counter[str] = Counter()

    for page_number, page in enumerate(reader.pages, start=1):
        def visitor(text: str, _cm: Any, _tm: Any, font_dict: Any, _font_size: float) -> None:
            if not text or not font_dict:
                return
            font = RECOVERY["dereference"](font_dict)
            for char in text:
                if not RECOVERY["is_suspicious"](char):
                    continue
                embedded = RECOVERY["embedded_font_bytes"](font_dict)
                sha = hashlib.sha256(embedded).hexdigest() if embedded else "none"
                key = (sha, f"U+{ord(char):04X}")
                if key in seen:
                    continue
                seen.add(key)

                subtype = str(font.get("/Subtype", ""))
                encoding = str(RECOVERY["dereference"](font.get("/Encoding"))) if font.get("/Encoding") else None
                descendant = RECOVERY["descendant_font"](font_dict)
                descendant_subtype = str(descendant.get("/Subtype", "")) if descendant else None
                cid_map = descendant.get("/CIDToGIDMap") if descendant else None
                cid_map_value = str(RECOVERY["dereference"](cid_map)) if cid_map is not None else None
                has_tounicode = RECOVERY["to_unicode_bytes"](font_dict) is not None
                cid = ord(char)
                gid = RECOVERY["cid_to_gid"](font_dict, cid)
                glyph_name = None
                candidates: list[str] = []
                font_error = None
                if embedded:
                    try:
                        glyph_order, reverse = RECOVERY["reverse_unicode_cmap"](embedded)
                        if gid is not None and 0 <= gid < len(glyph_order):
                            glyph_name = glyph_order[gid]
                            candidates = sorted(reverse.get(glyph_name, set()))
                    except Exception as error:  # noqa: BLE001
                        font_error = f"{type(error).__name__}: {error}"

                if subtype != "/Type0":
                    reason = "not-type0"
                elif encoding != "/Identity-H":
                    reason = "not-identity-h"
                elif has_tounicode:
                    reason = "has-tounicode-needs-source-aware-path"
                elif not embedded:
                    reason = "no-embedded-font"
                elif gid is None:
                    reason = "cid-to-gid-unresolved"
                elif font_error:
                    reason = "fonttools-parse-error"
                elif len(candidates) != 1:
                    reason = "unicode-candidate-not-unique"
                elif not RECOVERY["is_portable_replacement"](candidates[0]):
                    reason = "unicode-candidate-not-portable"
                else:
                    reason = "provable"
                reasons[reason] += 1
                samples.append(
                    {
                        "year": year,
                        "page": page_number,
                        "codepoint": f"U+{cid:04X}",
                        "baseFont": str(font.get("/BaseFont", "<unknown>")),
                        "subtype": subtype,
                        "encoding": encoding,
                        "descendantSubtype": descendant_subtype,
                        "cidToGidMap": cid_map_value,
                        "hasToUnicode": has_tounicode,
                        "fontSha256": None if sha == "none" else sha,
                        "cid": cid,
                        "gid": gid,
                        "glyphName": glyph_name,
                        "unicodeCandidates": candidates,
                        "fontError": font_error,
                        "reason": reason,
                    }
                )
        page.extract_text(visitor_text=visitor)

    return {"year": year, "reasons": dict(reasons), "samples": samples}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", default="2014,2015")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = [inspect_year(int(value)) for value in args.years.split(",") if value.strip()]
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
