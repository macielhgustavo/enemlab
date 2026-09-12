#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MIRROR_SCRIPT = SCRIPT_DIR / "ingest-uece-mirror.py"
spec = importlib.util.spec_from_file_location("probe_cederj_mirror_loader", MIRROR_SCRIPT)
assert spec and spec.loader
mirror = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mirror
spec.loader.exec_module(mirror)
core = mirror.core

SUPPORTED = {".zip", ".pdf", ".rar", ".7z"}
SURROGATE_RE = re.compile(r"[\ud800-\udfff]")
EDITION_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})\s*[/.-]\s*([12])(?!\d)")
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
EXPLICIT_QUESTION_RE = re.compile(r"^\s*QUEST[ÃA]O\s*0?(\d{1,3})\b", re.I)
PUNCTUATED_QUESTION_RE = re.compile(r"^\s*0?(\d{1,3})\s*[).:-]\s+\S", re.I)
KEY_PAIR_RE = re.compile(r"(?<!\d)0?(\d{1,3})\s*[-.:=)]?\s*([A-E])(?![A-Z])", re.I)
ALT_RE = re.compile(r"^\s*(?:\(?([A-E])\)?\s*[).:-]|([A-E])\s+)\s*\S", re.I)


def utf8_safe(value):
    if isinstance(value, str):
        return SURROGATE_RE.sub("\ufffd", value)
    if isinstance(value, list):
        return [utf8_safe(item) for item in value]
    if isinstance(value, dict):
        return {utf8_safe(key): utf8_safe(item) for key, item in value.items()}
    return value


def sidecar(path: Path) -> dict:
    meta = path.with_suffix(path.suffix + ".meta.json")
    if not meta.exists():
        return {}
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except Exception:
        return {}


def edition_key(title: str, year: int | None = None) -> str | None:
    value = core.norm(title)
    match = EDITION_RE.search(value)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    year_match = YEAR_RE.search(value)
    if year_match:
        return year_match.group(1)
    return str(year) if year else None


def classify_role(leaf: str, first_text: str = "") -> str:
    value = core.norm(leaf)
    text = core.norm(first_text)
    if "justificativa" in value or "justificativas" in value:
        return "rationale"
    if "gabarito" in value:
        return "answer-key"
    if "prova" in value:
        return "exam"
    if "justificativa" in text[:1800]:
        return "rationale"
    if any(marker in text[:1800] for marker in ("gabarito", "respostas corretas", "grade de respostas")):
        return "answer-key"
    if any(marker in text[:1800] for marker in ("vestibular", "prova", "questoes", "caderno")):
        return "exam"
    return "unknown"


def text_signals(document) -> dict:
    try:
        pages = [utf8_safe(page) for page in core.base.pdf_pages(document)]
    except Exception as error:
        return {
            "textFailure": f"{type(error).__name__}: {utf8_safe(str(error))}",
            "nativeTextChars": 0,
            "nativeTextPages": 0,
            "likelyScanned": True,
            "questionNumbers": [],
            "questionHeadingSamples": [],
            "answerKeyPairCount": 0,
            "answerKeyPairSamples": [],
            "alternativeLineCount": 0,
            "markerLineSamples": [],
            "firstTextSnippet": "",
            "tailTextSnippet": "",
        }

    question_numbers: set[int] = set()
    question_samples: list[str] = []
    key_pairs: dict[int, str] = {}
    key_samples: list[str] = []
    marker_samples: list[str] = []
    alternative_lines = 0
    text_chars = 0
    text_pages = 0

    for page in pages:
        compact_page = core.compact(page)
        text_chars += len(compact_page)
        text_pages += int(bool(compact_page))
        for raw in page.splitlines():
            line = core.compact(raw)
            if not line:
                continue
            normalized = core.norm(line)
            if len(marker_samples) < 40 and any(marker in normalized for marker in (
                "questao", "gabarito", "justificativa", "lingua inglesa", "lingua espanhola",
                "redacao", "vestibular", "alternativa"
            )):
                marker_samples.append(line[:320])
            explicit = EXPLICIT_QUESTION_RE.match(line)
            punctuated = PUNCTUATED_QUESTION_RE.match(line)
            match = explicit or punctuated
            if match:
                number = int(match.group(1))
                if 1 <= number <= 150:
                    question_numbers.add(number)
                    if len(question_samples) < 32:
                        question_samples.append(line[:320])
            if ALT_RE.match(line):
                alternative_lines += 1
            pairs = KEY_PAIR_RE.findall(line.upper())
            accepted = []
            for raw_number, token in pairs:
                number = int(raw_number)
                if 1 <= number <= 150:
                    key_pairs[number] = token.upper()
                    accepted.append(f"{number}:{token.upper()}")
            if accepted and len(key_samples) < 30:
                key_samples.append(" ".join(accepted[:30]))

    joined = "\n".join(pages)
    scanned_threshold = max(500, max(1, document.page_count) * 40)
    return {
        "textFailure": None,
        "nativeTextChars": text_chars,
        "nativeTextPages": text_pages,
        "likelyScanned": text_chars < scanned_threshold,
        "questionNumbers": sorted(question_numbers),
        "questionHeadingSamples": question_samples,
        "answerKeyPairCount": len(key_pairs),
        "answerKeyPairSamples": key_samples,
        "alternativeLineCount": alternative_lines,
        "markerLineSamples": marker_samples,
        "firstTextSnippet": utf8_safe(joined[:5000]),
        "tailTextSnippet": utf8_safe(joined[-5000:]),
    }


def inspect_package(path: Path) -> dict:
    meta = sidecar(path)
    title = str(meta.get("title") or path.stem)
    year = meta.get("year")
    documents = mirror.load_documents(path)
    if documents is None:
        return {
            "path": str(path),
            "downloadId": meta.get("downloadId"),
            "title": title,
            "editionKey": edition_key(title, year),
            "status": "compressed-extractor-unavailable",
            "documents": [],
        }
    core.base.hydrate_pdf_metadata(documents)
    payloads = []
    for document in documents:
        signals = text_signals(document)
        payloads.append({
            "member": document.member,
            "leaf": document.leaf,
            "sha256": document.sha256,
            "bytes": document.size,
            "pages": document.page_count,
            "role": classify_role(document.leaf, document.first_text),
            **signals,
        })
    return {
        "path": str(path),
        "downloadId": meta.get("downloadId"),
        "title": title,
        "year": year,
        "editionKey": edition_key(title, year),
        "packageSha256": meta.get("sha256"),
        "downloadUrl": meta.get("downloadUrl"),
        "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
        "format": path.suffix.lower().removeprefix("."),
        "status": "ok",
        "documents": payloads,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe CEDERJ package structure without emitting corpus questions.")
    parser.add_argument("--input", default=".ingestion-inbox/brasil-escola/sudeste/centro-ciencias-educacao-superior-distancia-estado-")
    parser.add_argument("--output", default=".ingestion-cache/brasil-escola/sudeste/cederj-probe.json")
    args = parser.parse_args()

    root = Path(args.input)
    paths = sorted(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED)
    packages = []
    failures = []
    for path in paths:
        try:
            packages.append(inspect_package(path))
        except Exception as error:
            failures.append({"path": str(path), "exceptionType": type(error).__name__, "error": utf8_safe(str(error))})

    role_counts: dict[str, int] = {}
    native_documents = 0
    scanned_documents = 0
    question_signal = 0
    key_signal = 0
    for package in packages:
        for document in package.get("documents", []):
            role = document.get("role") or "unknown"
            role_counts[role] = role_counts.get(role, 0) + 1
            scanned_documents += int(bool(document.get("likelyScanned")))
            native_documents += int(not document.get("likelyScanned"))
            question_signal += len(document.get("questionNumbers", []))
            key_signal += int(document.get("answerKeyPairCount", 0))

    payload = utf8_safe({
        "version": 1,
        "providerId": "brasil-escola",
        "institution": "CEDERJ",
        "purpose": "structural-probe-only",
        "packagesScanned": len(packages),
        "failures": failures,
        "roleCounts": dict(sorted(role_counts.items())),
        "nativeTextDocuments": native_documents,
        "likelyScannedDocuments": scanned_documents,
        "questionNumberSignal": question_signal,
        "answerKeyPairSignal": key_signal,
        "packages": packages,
    })
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: payload[key] for key in (
        "packagesScanned", "failures", "roleCounts", "nativeTextDocuments",
        "likelyScannedDocuments", "questionNumberSignal", "answerKeyPairSignal"
    )}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
