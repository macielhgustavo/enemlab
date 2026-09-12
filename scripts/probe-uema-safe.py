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
spec = importlib.util.spec_from_file_location("probe_uema_mirror_loader", MIRROR_SCRIPT)
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
KEY_PAIR = re.compile(r"(?<!\d)(\d{1,3})\s*[-.:=)]?\s*([A-EX])(?![A-Z])", re.I)


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


def classify_modality(title: str, leaf: str = "", first_text: str = "") -> str:
    raw = " ".join((title or "", leaf or "", first_text or ""))
    value = core.norm(raw)
    if re.search(r"\bead\b|educacao\s+a\s+distancia", value):
        return "ead"
    if re.search(r"60\s*\+", raw) or re.search(r"\b60\s*(?:mais|anos?)\b", value):
        return "sixty-plus"
    return "regular"


def phase_markers(title: str, leaf: str = "", first_text: str = "") -> list[int]:
    value = core.norm(" ".join((title or "", leaf or "", first_text or "")))
    phases: set[int] = set()
    patterns = {
        1: (r"\b1\s*[aªoº]?\s*fase\b", r"\bprimeira\s+fase\b"),
        2: (r"\b2\s*[aªoº]?\s*fase\b", r"\bsegunda\s+fase\b"),
    }
    for phase, expressions in patterns.items():
        if any(re.search(expression, value) for expression in expressions):
            phases.add(phase)
    return sorted(phases)


def role(document) -> str:
    text = core.norm(document.first_text)
    leaf = core.norm(document.leaf)
    key_markers = ("gabarito", "respostas corretas", "grade de respostas", "padrao de respostas")
    if "gabarito" in leaf or (document.page_count <= 12 and any(marker in text for marker in key_markers)):
        return "answer-key"
    exam_markers = ("prova", "questoes", "caderno", "paes", "processo seletivo", "vestibular", "uema")
    if document.page_count >= 3 and any(marker in text for marker in exam_markers):
        return "exam"
    return "unknown"


def text_signals(document) -> dict:
    try:
        pages = core.base.pdf_pages(document)
    except Exception as error:
        return {
            "textFailure": f"{type(error).__name__}: {error}",
            "questionNumbers": [],
            "questionHeadingSamples": [],
            "answerKeyPairCount": 0,
            "answerKeyPairSamples": [],
        }

    question_numbers: set[int] = set()
    question_samples: list[str] = []
    key_pairs: dict[int, str] = {}
    key_samples: list[str] = []
    for page in pages:
        for raw in page.splitlines():
            line = core.compact(utf8_safe(raw))
            if not line:
                continue
            question = QUESTION_LINE.match(line)
            if question:
                number = int(question.group(1))
                if 1 <= number <= 200:
                    question_numbers.add(number)
                    if len(question_samples) < 20:
                        question_samples.append(line[:240])
            pairs = KEY_PAIR.findall(line.upper())
            if pairs:
                accepted = []
                for raw_number, token in pairs:
                    number = int(raw_number)
                    if 1 <= number <= 200:
                        key_pairs[number] = token.upper()
                        accepted.append(f"{number}:{token.upper()}")
                if accepted and len(key_samples) < 16:
                    key_samples.append(" ".join(accepted[:24]))
    return {
        "textFailure": None,
        "questionNumbers": sorted(question_numbers),
        "questionHeadingSamples": question_samples,
        "answerKeyPairCount": len(key_pairs),
        "answerKeyPairSamples": key_samples,
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
    package_modality = classify_modality(title)
    package_phases = phase_markers(title)
    payloads = []
    for document in documents:
        detected_role = role(document)
        modality = classify_modality(title, document.leaf, document.first_text)
        phases = phase_markers(title, document.leaf, document.first_text)
        signals = text_signals(document) if detected_role in {"exam", "answer-key"} else {
            "textFailure": None,
            "questionNumbers": [],
            "questionHeadingSamples": [],
            "answerKeyPairCount": 0,
            "answerKeyPairSamples": [],
        }
        payloads.append({
            "member": document.member,
            "leaf": document.leaf,
            "sha256": document.sha256,
            "bytes": document.size,
            "pages": document.page_count,
            "role": detected_role,
            "modality": modality,
            "phase": phases[0] if len(phases) == 1 else None,
            "phaseCandidates": phases,
            "firstTextSnippet": utf8_safe(document.first_text[:1800]),
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
        "packageModality": package_modality,
        "packagePhase": package_phases[0] if len(package_phases) == 1 else None,
        "packagePhaseCandidates": package_phases,
        "documents": payloads,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe UEMA PAES native-text structure without emitting corpus questions.")
    parser.add_argument("--input", default=".ingestion-inbox/brasil-escola/nordeste/universidade-estadual-maranhao")
    parser.add_argument("--output", default=".ingestion-cache/brasil-escola/nordeste/uema-probe.json")
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
    modality_counts: dict[str, int] = {}
    phase_counts: dict[str, int] = {}
    regular_packages = 0
    for package in packages:
        regular_packages += int(package.get("packageModality") == "regular")
        for document in package.get("documents", []):
            role_counts[document["role"]] = role_counts.get(document["role"], 0) + 1
            modality_counts[document["modality"]] = modality_counts.get(document["modality"], 0) + 1
            key = str(document["phase"]) if document["phase"] is not None else "none-or-ambiguous"
            phase_counts[key] = phase_counts.get(key, 0) + 1

    payload = utf8_safe({
        "version": 1,
        "providerId": "brasil-escola",
        "institution": "UEMA",
        "purpose": "structural-probe-only",
        "packagesScanned": len(packages),
        "regularPackages": regular_packages,
        "failures": failures,
        "roleCounts": dict(sorted(role_counts.items())),
        "modalityCounts": dict(sorted(modality_counts.items())),
        "phaseCounts": dict(sorted(phase_counts.items())),
        "packages": packages,
    })
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: payload[key] for key in (
        "packagesScanned", "regularPackages", "failures", "roleCounts", "modalityCounts", "phaseCounts"
    )}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
