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
spec = importlib.util.spec_from_file_location("probe_upe_mirror_loader", MIRROR_SCRIPT)
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
    return json.loads(meta.read_text(encoding="utf-8"))


def _stage_markers(text: str) -> set[int]:
    value = core.norm(text)
    output: set[int] = set()

    # Preserve package-level ambiguity such as "SSA 1 e 2" instead of
    # prematurely collapsing it to the first stage. Document evidence can
    # then narrow the identity safely.
    for match in re.finditer(
        r"\bssa\s*([123])(?:\s*(?:e|/|,|-)\s*(?:ssa\s*)?([123]))?\b",
        value,
    ):
        output.add(int(match.group(1)))
        if match.group(2):
            output.add(int(match.group(2)))
    for match in re.finditer(
        r"\b([123])\s*[aªoº]?\s*(?:e|/|,|-)\s*([123])\s*[aªoº]?\s*(?:etapas?|fases?|anos?)\b",
        value,
    ):
        output.update((int(match.group(1)), int(match.group(2))))

    patterns = {
        1: (r"\bssa\s*1\b", r"\b1\s*[aªoº]?\s*etapa\b", r"\bprimeira\s+etapa\b", r"\b1\s*[oº]?\s*ano\b"),
        2: (r"\bssa\s*2\b", r"\b2\s*[aªoº]?\s*etapa\b", r"\bsegunda\s+etapa\b", r"\b2\s*[oº]?\s*ano\b"),
        3: (r"\bssa\s*3\b", r"\b3\s*[aªoº]?\s*etapa\b", r"\bterceira\s+etapa\b", r"\b3\s*[oº]?\s*ano\b"),
    }
    for stage, expressions in patterns.items():
        if any(re.search(expression, value) for expression in expressions):
            output.add(stage)
    return output


def classify_variant(title: str, leaf: str = "", first_text: str = "") -> dict:
    document_text = " ".join((leaf, first_text))
    package_text = title or ""
    all_text = core.norm(" ".join((package_text, document_text)))
    if re.search(r"\bead\b|educacao\s+a\s+distancia", all_text):
        modality = "ead"
    elif re.search(r"\bssa\b|sistema\s+seriado", all_text):
        modality = "ssa"
    else:
        modality = "regular"

    document_stages = _stage_markers(document_text)
    package_stages = _stage_markers(package_text)
    stages = document_stages or package_stages
    return {
        "modality": modality,
        "stage": next(iter(stages)) if len(stages) == 1 else None,
        "stageCandidates": sorted(stages),
        "stageEvidence": "document" if document_stages else ("package" if package_stages else None),
    }


def role(document) -> str:
    text = core.norm(document.first_text)
    leaf = core.norm(document.leaf)
    key_markers = ("gabarito", "respostas corretas", "grade de respostas", "padrao de respostas")
    if "gabarito" in leaf or (document.page_count <= 8 and any(marker in text for marker in key_markers)):
        return "answer-key"
    exam_markers = ("prova", "questoes", "caderno", "ssa", "processo de ingresso", "vestibular")
    if document.page_count >= 4 and any(marker in text for marker in exam_markers):
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
                if 1 <= number <= 150:
                    question_numbers.add(number)
                    if len(question_samples) < 16:
                        question_samples.append(line[:220])
            pairs = KEY_PAIR.findall(line.upper())
            if pairs:
                accepted = []
                for raw_number, token in pairs:
                    number = int(raw_number)
                    if 1 <= number <= 150:
                        key_pairs[number] = token.upper()
                        accepted.append(f"{number}:{token.upper()}")
                if accepted and len(key_samples) < 12:
                    key_samples.append(" ".join(accepted[:20]))
    return {
        "textFailure": None,
        "questionNumbers": sorted(question_numbers),
        "questionHeadingSamples": question_samples,
        "answerKeyPairCount": len(key_pairs),
        "answerKeyPairSamples": key_samples,
    }


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
    package_variant = classify_variant(meta.get("title") or "")
    payloads = []
    for document in documents:
        detected_role = role(document)
        variant = classify_variant(meta.get("title") or "", document.leaf, document.first_text)
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
            **variant,
            **signals,
        })
    return {
        "path": str(path),
        "downloadId": meta.get("downloadId"),
        "title": meta.get("title"),
        "year": meta.get("year"),
        "packageSha256": meta.get("sha256"),
        "downloadUrl": meta.get("downloadUrl"),
        "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
        "format": path.suffix.lower().removeprefix("."),
        "status": "ok",
        "packageVariant": package_variant,
        "documents": payloads,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe UPE/SSA native-text structure without emitting corpus questions.")
    parser.add_argument("--input", default=".ingestion-inbox/brasil-escola/nordeste/universidade-pernambuco")
    parser.add_argument("--output", default=".ingestion-cache/brasil-escola/nordeste/upe-probe.json")
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

    modality_counts: dict[str, int] = {}
    stage_counts: dict[str, int] = {}
    role_counts: dict[str, int] = {}
    for package in packages:
        for document in package.get("documents", []):
            role_counts[document["role"]] = role_counts.get(document["role"], 0) + 1
            modality_counts[document["modality"]] = modality_counts.get(document["modality"], 0) + 1
            stage_key = str(document["stage"]) if document["stage"] is not None else "ambiguous-or-none"
            stage_counts[stage_key] = stage_counts.get(stage_key, 0) + 1

    payload = utf8_safe({
        "version": 1,
        "providerId": "brasil-escola",
        "institution": "UPE",
        "purpose": "structural-probe-only",
        "packagesScanned": len(packages),
        "failures": failures,
        "roleCounts": dict(sorted(role_counts.items())),
        "modalityCounts": dict(sorted(modality_counts.items())),
        "stageCounts": dict(sorted(stage_counts.items())),
        "packages": packages,
    })
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: payload[key] for key in (
        "packagesScanned", "failures", "roleCounts", "modalityCounts", "stageCounts"
    )}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
