#!/usr/bin/env python3
"""Diagnóstico temporário: prova se CIDs suspeitos são glifos CFF vazios."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import runpy
from pathlib import Path
from typing import Any

QUESTIONS = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))
FONTMAP = runpy.run_path(str(Path(__file__).with_name("recover-fuvest-font-map.py")))
CID_NAME_RE = re.compile(r"^cid0*(\d+)$", re.IGNORECASE)


def cff_probe(data: bytes, cid: int) -> dict[str, Any]:
    from fontTools.cffLib import CFFFontSet
    from fontTools.pens.recordingPen import RecordingPen

    cff = CFFFontSet()
    cff.decompile(io.BytesIO(data), None, isCFF2=False)
    top = cff[0]
    charset = list(top.charset)
    target_name = None
    target_gid = None
    for gid, name in enumerate(charset):
        match = CID_NAME_RE.match(str(name))
        if match and int(match.group(1)) == cid:
            target_name = str(name)
            target_gid = gid
            break
    if target_name is None and 0 <= cid < len(charset) and not hasattr(top, "ROS"):
        target_name = str(charset[cid])
        target_gid = cid

    commands: list[Any] = []
    width = None
    error = None
    if target_name is not None:
        try:
            charstring = top.CharStrings[target_name]
            pen = RecordingPen()
            charstring.draw(pen)
            commands = list(pen.value)
            width = getattr(charstring, "width", None)
        except Exception as exc:  # noqa: BLE001
            error = f"{type(exc).__name__}: {exc}"

    return {
        "ros": list(top.ROS) if hasattr(top, "ROS") else None,
        "charsetPreview": [str(value) for value in charset[:20]],
        "charsetSize": len(charset),
        "targetName": target_name,
        "targetGid": target_gid,
        "outlineCommands": len(commands),
        "commandPreview": [repr(value) for value in commands[:8]],
        "charstringWidth": width,
        "error": error,
    }


def inspect_year(year: int, cid: int) -> list[dict[str, Any]]:
    from pypdf import PdfReader

    manifest = QUESTIONS["load_manifest"]()
    entry = manifest[str(year)]
    pdf_bytes = QUESTIONS["fetch"](entry["examUrl"])
    reader = PdfReader(io.BytesIO(pdf_bytes))
    output: list[dict[str, Any]] = []
    seen: set[str] = set()

    for page_number, page in enumerate(reader.pages, start=1):
        def visitor(text: str, _cm: Any, _tm: Any, font_dict: Any, _font_size: float) -> None:
            if not font_dict or chr(cid) not in text:
                return
            font = FONTMAP["dereference"](font_dict)
            embedded = FONTMAP["embedded_font_bytes"](font_dict)
            if not embedded:
                return
            sha = hashlib.sha256(embedded).hexdigest()
            if sha in seen:
                return
            seen.add(sha)
            descendant = FONTMAP["descendant_font"](font_dict)
            output.append(
                {
                    "year": year,
                    "page": page_number,
                    "codepoint": f"U+{cid:04X}",
                    "baseFont": str(font.get("/BaseFont", "<unknown>")),
                    "subtype": str(font.get("/Subtype", "<unknown>")),
                    "descendantSubtype": str(descendant.get("/Subtype", "<unknown>")) if descendant else None,
                    "fontSha256": sha,
                    "cff": cff_probe(embedded, cid),
                }
            )
        page.extract_text(visitor_text=visitor)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", default="2014,2015")
    parser.add_argument("--cid", type=int, default=3)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = [
        item
        for value in args.years.split(",")
        if value.strip()
        for item in inspect_year(int(value), args.cid)
    ]
    payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
