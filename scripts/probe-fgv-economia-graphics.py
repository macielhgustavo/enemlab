#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ContentStream

SCRIPT_DIR = Path(__file__).resolve().parent
MIRROR_SCRIPT = SCRIPT_DIR / "ingest-uece-mirror.py"
spec = importlib.util.spec_from_file_location("fgv_graphics_mirror", MIRROR_SCRIPT)
assert spec and spec.loader
mirror = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mirror
spec.loader.exec_module(mirror)
core = mirror.core

SUPPORTED = {".zip", ".rar", ".7z", ".pdf"}
QUESTION_RE = re.compile(r"^0?(\d{1,2})[.)]$")


def sidecar(path: Path) -> dict:
    meta = path.with_suffix(path.suffix + ".meta.json")
    if not meta.exists():
        return {}
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except Exception:
        return {}


def stem(member: str) -> str:
    value = Path(member).stem
    value = re.sub(r"[- _]+GABARITO$", "", value, flags=re.I)
    return re.sub(r"[^a-z0-9]+", " ", core.deaccent(value).lower()).strip()


def is_marked(member: str) -> bool:
    return "gabarito" in Path(member).stem.lower()


def runs_for_page(page):
    runs = []
    def visitor(text, cm, tm, font_dict, font_size):
        value = core.compact(text)
        if not value:
            return
        font = str((font_dict or {}).get("/BaseFont") or "")
        runs.append({
            "text": value[:120],
            "font": font,
            "size": round(float(font_size or 0), 2),
            "x": round(float(tm[4]), 2),
            "y": round(float(tm[5]), 2),
        })
    try:
        page.extract_text(visitor_text=visitor)
    except Exception:
        pass
    return runs


def graphics_for_page(page, reader):
    filled = []
    current_rects = []
    gray = None
    rgb = None
    cmyk = None
    try:
        stream = ContentStream(page.get_contents(), reader)
    except Exception:
        return []
    for operands, operator in stream.operations:
        op = operator.decode("latin-1", "replace") if isinstance(operator, bytes) else str(operator)
        if op == "re" and len(operands) >= 4:
            try:
                current_rects.append(tuple(round(float(v), 3) for v in operands[:4]))
            except Exception:
                pass
        elif op == "g" and operands:
            try: gray = round(float(operands[0]), 3)
            except Exception: pass
        elif op == "rg" and len(operands) >= 3:
            try: rgb = tuple(round(float(v), 3) for v in operands[:3])
            except Exception: pass
        elif op == "k" and len(operands) >= 4:
            try: cmyk = tuple(round(float(v), 3) for v in operands[:4])
            except Exception: pass
        elif op in {"f", "f*", "B", "B*"}:
            for rect in current_rects:
                filled.append({"rect": rect, "fillOp": op, "gray": gray, "rgb": rgb, "cmyk": cmyk})
            current_rects = []
        elif op in {"S", "s", "n"}:
            current_rects = []
    return filled


def page_payload(page, reader):
    runs = runs_for_page(page)
    return {
        "bullets": [r for r in runs if r["text"] in {"o", "O", "●", "○", "•", "\uf0a1", "\uf0a3"}],
        "questionRuns": [r for r in runs if QUESTION_RE.match(r["text"])],
        "filledRects": graphics_for_page(page, reader),
    }


def doc_payload(document):
    reader = PdfReader(io.BytesIO(document.bytes), strict=False)
    return [page_payload(page, reader) for page in reader.pages]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.input)
    packages = []
    failures = []
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED):
        meta = sidecar(path)
        if meta.get("downloadId") != 47285:
            continue
        try:
            documents = mirror.load_documents(path)
            if documents is None:
                raise ValueError("archive extractor unavailable")
            core.base.hydrate_pdf_metadata(documents)
            grouped = {}
            for doc in documents:
                if "1a-Fase" not in doc.member and "1ª-Fase" not in doc.member:
                    continue
                key = stem(doc.member)
                grouped.setdefault(key, {})["marked" if is_marked(doc.member) else "base"] = doc
            pairs = []
            for key, pair in grouped.items():
                if set(pair) != {"base", "marked"}:
                    continue
                pairs.append({
                    "pairKey": key,
                    "baseMember": pair["base"].member,
                    "markedMember": pair["marked"].member,
                    "basePages": doc_payload(pair["base"]),
                    "markedPages": doc_payload(pair["marked"]),
                })
            packages.append({"downloadId": 47285, "title": meta.get("title"), "pairs": pairs})
        except Exception as error:
            failures.append({"path": str(path), "type": type(error).__name__, "error": str(error)[:500]})
    payload = {"version": 1, "institution": "FGV", "packageCount": len(packages), "packages": packages, "failures": failures}
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"packageCount": len(packages), "pairs": sum(len(p["pairs"]) for p in packages), "failures": failures}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
