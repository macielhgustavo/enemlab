#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MIRROR_SCRIPT = SCRIPT_DIR / "ingest-uece-mirror.py"
spec = importlib.util.spec_from_file_location("ufu_probe_mirror", MIRROR_SCRIPT)
assert spec and spec.loader
mirror = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mirror
spec.loader.exec_module(mirror)
core = mirror.core

SUPPORTED = {".zip", ".rar", ".7z", ".pdf"}
QUESTION_PATTERNS = [
    re.compile(r"(?m)^\s*(?:QUEST(?:ÃO|AO)\s*)?0?(\d{1,3})\s*[.)-]?\s+\S", re.I),
    re.compile(r"(?m)^\s*0?(\d{1,3})\s+[–—-]\s+\S"),
]
KEY_PAIR = re.compile(r"(?<!\d)(\d{1,3})\s*[-.:)]?\s*([A-E])\b", re.I)
ALT_LINE = re.compile(r"(?m)^\s*([A-E])\s*[).:-]\s+\S", re.I)
DENY_PACKAGE = re.compile(r"\b(?:especial|escolar|pontal|ead|vagas?\s+remanescentes?)\b", re.I)


def utf8_safe(value) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return value.encode("utf-8", errors="replace").decode("utf-8")


def compact(text: str) -> str:
    return core.base.compact_space(utf8_safe(text))


def sidecar(path: Path) -> dict:
    meta = path.with_suffix(path.suffix + ".meta.json")
    if not meta.exists():
        return {}
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _page_score(pp: list[str]) -> tuple[int, int, int]:
    text = "\n".join(pp)
    qnums = set()
    for pattern in QUESTION_PATTERNS:
        qnums.update(int(x) for x in pattern.findall(text) if 1 <= int(x) <= 150)
    key_pairs = {(int(n), a.upper()) for n, a in KEY_PAIR.findall(text) if 1 <= int(n) <= 150}
    return (len(compact(text)), len(qnums), len(key_pairs))


def pages(document) -> tuple[list[str], str]:
    candidates: list[tuple[list[str], str]] = []
    for layout, mode in ((False, "plain"), (True, "layout")):
        try:
            pp = [utf8_safe(x) for x in core.base.pdf_pages(document, layout=layout)]
            candidates.append((pp, mode))
        except Exception:
            continue
    if not candidates:
        fallback = utf8_safe(getattr(document, "first_text", ""))
        return ([fallback] if fallback else []), "first-page-fallback"
    best_pages, best_mode = max(candidates, key=lambda item: _page_score(item[0]))
    return best_pages, best_mode


def role(document, text: str) -> str:
    value = core.norm(f"{document.leaf} {text[:5000]} {getattr(document, 'first_text', '')[:3000]}")
    if any(x in value for x in ("gabarito", "respostas corretas", "grade de respostas")) and document.page_count <= 12:
        return "answer-key"
    if any(x in value for x in ("processo seletivo", "vestibular", "prova", "questoes", "situacional")) and document.page_count >= 4:
        return "exam"
    return "unknown"


def inspect_document(document) -> dict:
    pp, extraction_mode = pages(document)
    text = "\n".join(pp)
    first_text = utf8_safe(getattr(document, "first_text", ""))
    effective_text = text if len(compact(text)) >= len(compact(first_text)) else first_text
    qnums = set()
    for pattern in QUESTION_PATTERNS:
        qnums.update(int(x) for x in pattern.findall(effective_text) if 1 <= int(x) <= 150)
    key_pairs = [(int(n), a.upper()) for n, a in KEY_PAIR.findall(effective_text) if 1 <= int(n) <= 150]
    key_numbers = {n for n, _ in key_pairs}
    alts = Counter(x.upper() for x in ALT_LINE.findall(effective_text))
    samples = []
    for page_no, page in enumerate(pp[:8], 1):
        lines = [compact(x) for x in page.splitlines() if compact(x)]
        if lines:
            samples.append({"page": page_no, "head": lines[:24], "tail": lines[-10:]})
    if not samples and first_text:
        lines = [compact(x) for x in first_text.splitlines() if compact(x)]
        samples.append({"page": 1, "head": lines[:24], "tail": lines[-10:]})
    return {
        "member": document.member,
        "leaf": document.leaf,
        "sha256": document.sha256,
        "bytes": document.size,
        "pages": document.page_count,
        "textExtractionMode": extraction_mode,
        "nativeTextChars": len(compact(effective_text)),
        "role": role(document, effective_text),
        "questionNumbers": sorted(qnums),
        "questionNumberSignal": len(qnums),
        "answerKeyNumbers": sorted(key_numbers),
        "answerKeyPairSignal": len(key_pairs),
        "alternativeLineSignal": sum(alts.values()),
        "samples": samples,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.input)
    packages = []
    failures = []
    excluded_packages = []
    seen_sha = set()
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED):
        meta = sidecar(path)
        title = str(meta.get("title") or path.stem)
        if DENY_PACKAGE.search(title):
            excluded_packages.append({"archive": path.name, "downloadId": meta.get("downloadId"), "title": title, "reason": "package-filter"})
            continue
        package_sha = str(meta.get("sha256") or "")
        if package_sha and package_sha in seen_sha:
            continue
        if package_sha:
            seen_sha.add(package_sha)
        try:
            documents = mirror.load_documents(path)
            if documents is None:
                raise ValueError("compressed-extractor-unavailable")
            core.base.hydrate_pdf_metadata(documents)
            docs = [inspect_document(d) for d in documents]
            packages.append({
                "archive": path.name,
                "downloadId": meta.get("downloadId"),
                "title": title,
                "year": meta.get("year"),
                "packageSha256": package_sha or None,
                "documents": docs,
            })
        except Exception as error:
            failures.append({"archive": path.name, "exceptionType": type(error).__name__, "error": str(error)[:500]})
    docs = [d for p in packages for d in p["documents"]]
    mode_counts = Counter(d["textExtractionMode"] for d in docs)
    payload = {
        "version": 3,
        "institution": "UFU",
        "excludedPackages": excluded_packages,
        "packages": packages,
        "summary": {
            "packages": len(packages),
            "excludedPackages": len(excluded_packages),
            "documents": len(docs),
            "examDocuments": sum(d["role"] == "exam" for d in docs),
            "answerKeyDocuments": sum(d["role"] == "answer-key" for d in docs),
            "unknownDocuments": sum(d["role"] == "unknown" for d in docs),
            "nativeTextDocuments": sum(d["nativeTextChars"] >= 200 for d in docs),
            "likelyScannedDocuments": sum(d["nativeTextChars"] < 200 for d in docs),
            "questionNumberSignal": sum(d["questionNumberSignal"] for d in docs),
            "answerKeyPairSignal": sum(d["answerKeyPairSignal"] for d in docs),
            "textExtractionModes": dict(mode_counts),
            "failures": failures,
        },
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
