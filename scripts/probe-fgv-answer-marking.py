#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ContentStream

SCRIPT_DIR = Path(__file__).resolve().parent
MIRROR_SCRIPT = SCRIPT_DIR / "ingest-uece-mirror.py"
spec = importlib.util.spec_from_file_location("fgv_probe_mirror", MIRROR_SCRIPT)
assert spec and spec.loader
mirror = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mirror
spec.loader.exec_module(mirror)
core = mirror.core

SUPPORTED = {".zip", ".rar", ".7z", ".pdf"}
DENY_RE = re.compile(r"(?:redac|discurs|resol|grade[- _]?de[- _]?correc)", re.I)
OBJECTIVE_RE = re.compile(r"(?:objetiv|1a[- _]?fase|1ª[- _]?fase)", re.I)
MARKER_RE = re.compile(r"(?:^g[- _]?|[- _]?gabarito$|[- _]?gabarito[- _]?)", re.I)
SHORT_GLYPHS = set("oO●○◉◯•·xX✓✔■□▪▫")


def compact(value: str) -> str:
    return core.compact(value)


def normalized_stem(member: str) -> str:
    leaf = Path(member).stem
    value = re.sub(r"^g[- _]+", "", leaf, flags=re.I)
    value = re.sub(r"[- _]+gabarito(?:[- _].*)?$", "", value, flags=re.I)
    value = re.sub(r"[- _]+0$", "", value)
    value = re.sub(r"[^a-z0-9]+", " ", core.deaccent(value).lower()).strip()
    return value


def is_objective(member: str) -> bool:
    leaf = Path(member).name
    return not DENY_RE.search(leaf) and bool(OBJECTIVE_RE.search(leaf))


def is_marked(member: str) -> bool:
    leaf = Path(member).stem
    return bool(re.match(r"^g[- _]", leaf, re.I) or re.search(r"gabarito", leaf, re.I))


def pair_documents(documents):
    groups = defaultdict(lambda: {"base": [], "marked": []})
    for document in documents:
        if not is_objective(document.member):
            continue
        groups[normalized_stem(document.member)]["marked" if is_marked(document.member) else "base"].append(document)
    pairs = []
    for key, group in groups.items():
        if not group["base"] or not group["marked"]:
            continue
        base = max(group["base"], key=lambda d: (d.page_count, d.size))
        marked = max(group["marked"], key=lambda d: (d.page_count, d.size))
        pairs.append((key, base, marked))
    return pairs


def font_name(font_dict) -> str:
    if not font_dict:
        return "<none>"
    value = font_dict.get("/BaseFont") or font_dict.get("/Name") or "<unknown>"
    return str(value)


def pdf_signals(document) -> dict:
    reader = PdfReader(io.BytesIO(document.bytes), strict=False)
    font_counts = Counter()
    short_runs = Counter()
    annotation_counts = Counter()
    page_signals = []
    total_text = 0

    for page_no, page in enumerate(reader.pages, 1):
        runs = []

        def visitor(text, cm, tm, font_dict, font_size):
            nonlocal total_text
            value = compact(text)
            if not value:
                return
            total_text += len(value)
            name = font_name(font_dict)
            size = round(float(font_size or 0), 2)
            font_counts[(name, size)] += len(value)
            if len(value) <= 6 or all(ch in SHORT_GLYPHS or ch.isspace() for ch in value):
                short_runs[(value, name, size)] += 1
            if len(runs) < 240:
                runs.append({
                    "text": value[:80],
                    "font": name,
                    "size": size,
                    "x": round(float(tm[4]), 1) if len(tm) > 4 else None,
                    "y": round(float(tm[5]), 1) if len(tm) > 5 else None,
                })

        try:
            text = page.extract_text(visitor_text=visitor) or ""
        except Exception as error:
            text = ""
            runs.append({"error": f"{type(error).__name__}: {error}"})

        for annotation in page.get("/Annots") or []:
            try:
                obj = annotation.get_object()
                annotation_counts[str(obj.get("/Subtype") or "<none>")] += 1
            except Exception:
                annotation_counts["<error>"] += 1

        operations = Counter()
        try:
            stream = ContentStream(page.get_contents(), reader)
            for operands, operator in stream.operations:
                op = operator.decode("latin-1", "replace") if isinstance(operator, bytes) else str(operator)
                if op in {"rg", "RG", "g", "G", "k", "K", "re", "f", "f*", "S", "s", "B", "B*", "Tj", "TJ", "Tf"}:
                    operations[op] += 1
        except Exception:
            pass

        page_signals.append({
            "page": page_no,
            "textChars": len(compact(text)),
            "operations": dict(operations),
            "runs": runs[:80],
        })

    fonts = [
        {"font": name, "size": size, "chars": chars}
        for (name, size), chars in font_counts.most_common(24)
    ]
    shorts = [
        {"text": text, "font": name, "size": size, "count": count}
        for (text, name, size), count in short_runs.most_common(80)
    ]
    return {
        "pages": len(reader.pages),
        "textChars": total_text,
        "fonts": fonts,
        "shortRuns": shorts,
        "annotations": dict(annotation_counts),
        "pageSignals": page_signals,
    }


def diff_pair(base: dict, marked: dict) -> dict:
    base_fonts = {(x["font"], x["size"]): x["chars"] for x in base["fonts"]}
    marked_fonts = {(x["font"], x["size"]): x["chars"] for x in marked["fonts"]}
    font_delta = []
    for key in sorted(set(base_fonts) | set(marked_fonts)):
        delta = marked_fonts.get(key, 0) - base_fonts.get(key, 0)
        if delta:
            font_delta.append({"font": key[0], "size": key[1], "deltaChars": delta})
    base_short = {(x["text"], x["font"], x["size"]): x["count"] for x in base["shortRuns"]}
    marked_short = {(x["text"], x["font"], x["size"]): x["count"] for x in marked["shortRuns"]}
    short_delta = []
    for key in sorted(set(base_short) | set(marked_short)):
        delta = marked_short.get(key, 0) - base_short.get(key, 0)
        if delta:
            short_delta.append({"text": key[0], "font": key[1], "size": key[2], "delta": delta})
    return {
        "fontDelta": sorted(font_delta, key=lambda x: -abs(x["deltaChars"]))[:40],
        "shortRunDelta": sorted(short_delta, key=lambda x: -abs(x["delta"]))[:80],
    }


def sidecar(path: Path) -> dict:
    meta = path.with_suffix(path.suffix + ".meta.json")
    if not meta.exists():
        return {}
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except Exception:
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare native FGV objective PDFs with answer-marked copies.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    root = Path(args.input)
    packages = []
    failures = []
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED):
        meta = sidecar(path)
        try:
            documents = mirror.load_documents(path)
            if documents is None:
                raise ValueError("archive extractor unavailable")
            core.base.hydrate_pdf_metadata(documents)
            pairs = []
            for key, base_doc, marked_doc in pair_documents(documents):
                base = pdf_signals(base_doc)
                marked = pdf_signals(marked_doc)
                pairs.append({
                    "pairKey": key,
                    "base": {"member": base_doc.member, "sha256": base_doc.sha256, **base},
                    "marked": {"member": marked_doc.member, "sha256": marked_doc.sha256, **marked},
                    "delta": diff_pair(base, marked),
                })
            packages.append({
                "downloadId": meta.get("downloadId"),
                "title": meta.get("title") or path.stem,
                "packageSha256": meta.get("sha256"),
                "pairs": pairs,
            })
        except Exception as error:
            failures.append({"path": str(path), "exceptionType": type(error).__name__, "error": str(error)[:500]})

    payload = {
        "version": 1,
        "providerId": "brasil-escola",
        "institution": "FGV",
        "purpose": "answer-marking-diff-probe",
        "packages": packages,
        "pairCount": sum(len(p["pairs"]) for p in packages),
        "failures": failures,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "packages": len(packages),
        "pairCount": payload["pairCount"],
        "failures": failures,
        "pairs": [
            {"downloadId": p["downloadId"], "title": p["title"], "pairKeys": [x["pairKey"] for x in p["pairs"]]}
            for p in packages if p["pairs"]
        ],
    }, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
