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
spec = importlib.util.spec_from_file_location("probe_uva_mirror_loader", MIRROR_SCRIPT)
assert spec and spec.loader
mirror = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mirror
spec.loader.exec_module(mirror)
core = mirror.core

SUPPORTED = {".zip", ".pdf", ".rar", ".7z"}
SURROGATE_RE = re.compile(r"[\ud800-\udfff]")
QUESTION_PATTERNS = (
    re.compile(r"^\s*QUEST[ÃA]O\s*0?(\d{1,3})\b\s*(.*)$", re.I),
    re.compile(r"^\s*0?(\d{1,3})\s*[.)-]\s*(\S.*)$", re.I),
    re.compile(r"^\s*0?(\d{1,3})\s{2,}(\S.*)$", re.I),
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


def classify_role(leaf: str) -> str:
    value = core.norm(leaf)
    if "gabarito" in value:
        return "answer-key"
    if "prova" in value:
        return "exam"
    return "unknown"


def classify_track(leaf: str) -> str | None:
    value = core.norm(leaf)
    rules = (
        ("general-english", ("conhecimentos gerais", "ingles")),
        ("general-spanish", ("conhecimentos gerais", "espanhol")),
        ("biology-chemistry", ("biologia", "quimica")),
        ("math-physics", ("matematica", "fisica")),
        ("math-history", ("matematica", "historia")),
        ("math-chemistry", ("matematica", "quimica")),
        ("portuguese-history", ("portugues", "historia")),
        ("geography-history", ("geografia", "historia")),
    )
    for name, markers in rules:
        if all(marker in value for marker in markers):
            return name
    compact = value.replace("-", " ").replace("_", " ")
    aliases = {
        "bio quimica": "biology-chemistry",
        "mat fis": "math-physics",
        "matematica hist": "math-history",
        "matematica quimica": "math-chemistry",
        "port histo": "portuguese-history",
    }
    return next((track for marker, track in aliases.items() if marker in compact), None)


def question_match(line: str):
    for pattern in QUESTION_PATTERNS:
        match = pattern.match(line)
        if match:
            number = int(match.group(1))
            if 1 <= number <= 150:
                return number, match.group(2).strip()
    return None


def text_signals(document) -> dict:
    best = None
    for layout in (False, True):
        try:
            pages = [utf8_safe(page) for page in core.base.pdf_pages(document, layout=layout)]
        except Exception as error:
            if best is None:
                best = {"textFailure": f"{type(error).__name__}: {utf8_safe(str(error))}"}
            continue
        question_numbers: list[int] = []
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
                match = question_match(line)
                if match:
                    number, _ = match
                    question_numbers.append(number)
                    if len(question_samples) < 40:
                        question_samples.append(line[:320])
                pairs = KEY_PAIR.findall(line.upper())
                if pairs:
                    accepted = []
                    for raw_number, token in pairs:
                        number = int(raw_number)
                        if 1 <= number <= 150:
                            key_pairs[number] = token.upper()
                            accepted.append(f"{number}:{token.upper()}")
                    if accepted and len(key_samples) < 30:
                        key_samples.append(" ".join(accepted[:40]))
                if len(marker_samples) < 40 and any(marker in normalized for marker in (
                    "vestibular", "processo seletivo", "gabarito", "questao", "curso", "area",
                    "conhecimentos gerais", "ingles", "espanhol", "biologia", "quimica",
                    "matematica", "fisica", "historia", "geografia", "portugues"
                )):
                    marker_samples.append(line[:320])
        joined = "\n".join(pages)
        payload = {
            "textFailure": None,
            "layout": layout,
            "nativeTextChars": text_chars,
            "nativeTextPages": text_pages,
            "likelyScanned": text_chars < max(500, max(1, document.page_count) * 40),
            "questionSequence": question_numbers,
            "uniqueQuestionNumbers": sorted(set(question_numbers)),
            "questionHeadingSamples": question_samples,
            "answerKeyPairCount": len(key_pairs),
            "answerKeyPairSamples": key_samples,
            "markerLineSamples": marker_samples,
            "headTextSnippet": utf8_safe(joined[:5000]),
            "tailTextSnippet": utf8_safe(joined[-5000:]),
        }
        score = (
            len(set(question_numbers)),
            len(key_pairs),
            text_chars,
        )
        if best is None or score > best.get("_score", (-1, -1, -1)):
            payload["_score"] = score
            best = payload
    if best is None:
        best = {
            "textFailure": "no extraction attempt succeeded",
            "layout": False,
            "nativeTextChars": 0,
            "nativeTextPages": 0,
            "likelyScanned": True,
            "questionSequence": [],
            "uniqueQuestionNumbers": [],
            "questionHeadingSamples": [],
            "answerKeyPairCount": 0,
            "answerKeyPairSamples": [],
            "markerLineSamples": [],
            "headTextSnippet": "",
            "tailTextSnippet": "",
        }
    best.pop("_score", None)
    return best


def inspect_package(path: Path) -> dict:
    meta = sidecar(path)
    documents = mirror.load_documents(path)
    if documents is None:
        return {
            "path": str(path),
            "downloadId": meta.get("downloadId"),
            "title": meta.get("title"),
            "status": "compressed-extractor-unavailable",
            "documents": [],
        }
    core.base.hydrate_pdf_metadata(documents)
    payloads = []
    for document in documents:
        payloads.append({
            "member": document.member,
            "leaf": document.leaf,
            "sha256": document.sha256,
            "bytes": document.size,
            "pages": document.page_count,
            "role": classify_role(document.leaf),
            "track": classify_track(document.leaf),
            **text_signals(document),
        })
    title = str(meta.get("title") or path.stem)
    return {
        "path": str(path),
        "downloadId": meta.get("downloadId"),
        "title": title,
        "year": meta.get("year"),
        "packageSha256": meta.get("sha256"),
        "specialVariant": "ibiapaba" if "ibiapaba" in core.norm(title) else None,
        "downloadUrl": meta.get("downloadUrl"),
        "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
        "format": path.suffix.lower().removeprefix("."),
        "status": "ok",
        "documents": payloads,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe UVA vestibular package structure without emitting corpus questions.")
    parser.add_argument("--input", default=".cache/nordeste-candidate-inbox/universidade-estadual-vale-acarau")
    parser.add_argument("--output", default=".cache/uva-probe.json")
    args = parser.parse_args()

    root = Path(args.input)
    paths = sorted(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED)
    packages = []
    failures = []
    for path in paths:
        try:
            packages.append(inspect_package(path))
        except Exception as error:
            failures.append({
                "path": str(path),
                "exceptionType": type(error).__name__,
                "error": utf8_safe(str(error)),
            })

    role_counts: dict[str, int] = {}
    track_counts: dict[str, int] = {}
    native = 0
    scanned = 0
    question_signal = 0
    key_signal = 0
    for package in packages:
        for document in package.get("documents", []):
            role = document.get("role") or "unknown"
            role_counts[role] = role_counts.get(role, 0) + 1
            track = document.get("track")
            if track:
                track_counts[track] = track_counts.get(track, 0) + 1
            native += int(not document.get("likelyScanned"))
            scanned += int(bool(document.get("likelyScanned")))
            question_signal += len(document.get("uniqueQuestionNumbers", []))
            key_signal += int(document.get("answerKeyPairCount", 0))

    payload = utf8_safe({
        "version": 1,
        "providerId": "brasil-escola",
        "institution": "UVA",
        "purpose": "structural-probe-only",
        "packagesScanned": len(packages),
        "failures": failures,
        "roleCounts": dict(sorted(role_counts.items())),
        "trackCounts": dict(sorted(track_counts.items())),
        "nativeTextDocuments": native,
        "likelyScannedDocuments": scanned,
        "questionNumberSignal": question_signal,
        "answerKeyPairSignal": key_signal,
        "packages": packages,
    })
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: payload[key] for key in (
        "packagesScanned", "failures", "roleCounts", "trackCounts", "nativeTextDocuments",
        "likelyScannedDocuments", "questionNumberSignal", "answerKeyPairSignal"
    )}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
