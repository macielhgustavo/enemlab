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
spec = importlib.util.spec_from_file_location("probe_uneb_mirror_loader", MIRROR_SCRIPT)
assert spec and spec.loader
mirror = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mirror
spec.loader.exec_module(mirror)
core = mirror.core

SUPPORTED = {".zip", ".pdf", ".rar", ".7z"}
SURROGATE_RE = re.compile(r"[\ud800-\udfff]")
QUESTION_LINE = re.compile(
    r"^\s*(?:(?:QUEST[ÃA]O)\s*)?0?(\d{1,3})\s*(?:[.:)-]\s*|\s+)(\S.*)$",
    re.I,
)
KEY_PAIR = re.compile(r"(?<!\d)0?(\d{1,3})\s*[-.:=)]?\s*([A-E])(?![A-Z])", re.I)


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


def classify_role(leaf: str, first_text: str = "") -> str:
    value = core.norm(leaf)
    text = core.norm(first_text)
    if "prova-gabarito" in value or ("prova" in value and "gabarito" in value):
        return "combined"
    if "gabarito" in value:
        return "answer-key"
    if "prova" in value:
        return "exam"
    if any(marker in text for marker in ("gabarito", "respostas corretas", "grade de respostas")):
        return "answer-key"
    if any(marker in text for marker in ("prova", "questoes", "vestibular", "processo seletivo")):
        return "exam"
    return "unknown"


def classify_day(leaf: str, text: str = "") -> int | None:
    value = core.norm(f"{leaf} {text}")
    patterns = {
        1: (r"\bdia\s*[-_. ]?\s*1\b", r"\b1\s*[ºo]?\s*dia\b", r"\bprimeiro\s+dia\b"),
        2: (r"\bdia\s*[-_. ]?\s*2\b", r"\b2\s*[ºo]?\s*dia\b", r"\bsegundo\s+dia\b"),
    }
    found = [day for day, expressions in patterns.items() if any(re.search(expr, value) for expr in expressions)]
    return found[0] if len(found) == 1 else None


def classify_language(leaf: str, text: str = "") -> str | None:
    value = core.norm(f"{leaf} {text}")
    for language, markers in {
        "english": ("ingles", "lingua inglesa"),
        "spanish": ("espanhol", "lingua espanhola"),
        "french": ("frances", "lingua francesa"),
    }.items():
        if any(marker in value for marker in markers):
            return language
    return None


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
            "markerLineSamples": [],
            "tailTextSnippet": "",
        }

    question_numbers: set[int] = set()
    question_samples: list[str] = []
    key_pairs: dict[int, str] = {}
    key_samples: list[str] = []
    marker_samples: list[str] = []
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
            if len(marker_samples) < 24 and any(marker in normalized for marker in (
                "questao", "gabarito", "respostas", "lingua inglesa", "lingua espanhola", "lingua francesa"
            )):
                marker_samples.append(line[:260])
            question = QUESTION_LINE.match(line)
            if question:
                number = int(question.group(1))
                if 1 <= number <= 150:
                    question_numbers.add(number)
                    if len(question_samples) < 24:
                        question_samples.append(line[:260])
            pairs = KEY_PAIR.findall(line.upper())
            if pairs:
                accepted = []
                for raw_number, token in pairs:
                    number = int(raw_number)
                    if 1 <= number <= 150:
                        key_pairs[number] = token.upper()
                        accepted.append(f"{number}:{token.upper()}")
                if accepted and len(key_samples) < 20:
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
        "markerLineSamples": marker_samples,
        "tailTextSnippet": utf8_safe(joined[-3500:]),
    }


def inspect_package(path: Path) -> dict:
    meta = sidecar(path)
    title = str(meta.get("title") or path.stem)
    documents = mirror.load_documents(path)
    if documents is None:
        return {
            "path": str(path),
            "downloadId": meta.get("downloadId"),
            "title": title,
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
            "day": classify_day(document.leaf, document.first_text),
            "language": classify_language(document.leaf, document.first_text),
            "firstTextSnippet": utf8_safe(document.first_text[:2200]),
            **signals,
        })
    return {
        "path": str(path),
        "downloadId": meta.get("downloadId"),
        "title": title,
        "year": meta.get("year"),
        "packageSha256": meta.get("sha256"),
        "downloadUrl": meta.get("downloadUrl"),
        "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
        "format": path.suffix.lower().removeprefix("."),
        "status": "ok",
        "documents": payloads,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe UNEB native-text structure without emitting corpus questions.")
    parser.add_argument("--input", default=".ingestion-inbox/brasil-escola/nordeste/universidade-estado-bahia")
    parser.add_argument("--output", default=".ingestion-cache/brasil-escola/nordeste/uneb-probe.json")
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
    scanned_documents = 0
    native_documents = 0
    combined_documents = 0
    question_signal = 0
    key_signal = 0
    for package in packages:
        for document in package.get("documents", []):
            role = document.get("role") or "unknown"
            role_counts[role] = role_counts.get(role, 0) + 1
            scanned_documents += int(bool(document.get("likelyScanned")))
            native_documents += int(not document.get("likelyScanned"))
            combined_documents += int(role == "combined")
            question_signal += len(document.get("questionNumbers", []))
            key_signal += int(document.get("answerKeyPairCount", 0))

    payload = utf8_safe({
        "version": 1,
        "providerId": "brasil-escola",
        "institution": "UNEB",
        "purpose": "structural-probe-only",
        "packagesScanned": len(packages),
        "failures": failures,
        "roleCounts": dict(sorted(role_counts.items())),
        "nativeTextDocuments": native_documents,
        "likelyScannedDocuments": scanned_documents,
        "combinedDocuments": combined_documents,
        "questionNumberSignal": question_signal,
        "answerKeyPairSignal": key_signal,
        "packages": packages,
    })
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: payload[key] for key in (
        "packagesScanned", "failures", "roleCounts", "nativeTextDocuments",
        "likelyScannedDocuments", "combinedDocuments", "questionNumberSignal", "answerKeyPairSignal"
    )}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
