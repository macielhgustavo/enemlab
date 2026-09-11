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


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


mirror = load_module("inspect_bulk_mirror_loader", MIRROR_SCRIPT)
core = mirror.core
SUPPORTED = {".zip", ".pdf", ".rar", ".7z"}
QUESTION_LINE = re.compile(r"(?m)^\s*0?(\d{1,3})\s*[.)-]\s+\S")


def role(document) -> str:
    text = core.norm(document.first_text)
    leaf = core.norm(document.leaf)
    if document.page_count <= 6 and any(marker in text or marker in leaf for marker in (
        "gabarito", "grade de respostas", "respostas corretas", "padrao de respostas"
    )):
        return "answer-key"
    if document.page_count >= 5 and any(marker in text for marker in (
        "prova", "questoes", "caderno", "processo seletivo", "vestibular", "paes", "ssa"
    )):
        return "exam"
    if "gabarito" in leaf and document.page_count <= 10:
        return "answer-key"
    return "unknown"


def question_signal(document) -> int:
    try:
        pages = core.base.pdf_pages(document)
    except Exception:
        return 0
    numbers = {int(match.group(1)) for page in pages for match in QUESTION_LINE.finditer(page)}
    return len({number for number in numbers if 1 <= number <= 150})


def sidecar(path: Path) -> dict:
    meta = path.with_suffix(path.suffix + ".meta.json")
    if not meta.exists():
        return {}
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except Exception:
        return {}


def inspect_file(path: Path) -> dict:
    meta = sidecar(path)
    documents = mirror.load_documents(path)
    if documents is None:
        return {
            "path": str(path),
            "title": meta.get("title"),
            "institution": meta.get("institution"),
            "institutionSlug": meta.get("institutionSlug"),
            "downloadId": meta.get("downloadId"),
            "format": path.suffix.lower().removeprefix("."),
            "status": "compressed-extractor-unavailable",
            "documents": [],
        }
    core.base.hydrate_pdf_metadata(documents)
    document_payloads = []
    for document in documents:
        detected_role = role(document)
        signal = question_signal(document) if detected_role == "exam" else 0
        document_payloads.append({
            "member": document.member,
            "leaf": document.leaf,
            "sha256": document.sha256,
            "bytes": document.size,
            "pages": document.page_count,
            "role": detected_role,
            "questionNumberSignal": signal,
            "firstPageSignals": sorted({
                marker
                for marker in ("prova", "gabarito", "paes", "ssa", "vestibular", "processo seletivo", "questoes")
                if marker in core.norm(document.first_text)
            }),
        })
    return {
        "path": str(path),
        "title": meta.get("title"),
        "institution": meta.get("institution"),
        "institutionSlug": meta.get("institutionSlug"),
        "downloadId": meta.get("downloadId"),
        "year": meta.get("year"),
        "format": path.suffix.lower().removeprefix("."),
        "status": "ok",
        "documentCount": len(document_payloads),
        "examCandidates": sum(item["role"] == "exam" for item in document_payloads),
        "answerKeyCandidates": sum(item["role"] == "answer-key" for item in document_payloads),
        "unknownDocuments": sum(item["role"] == "unknown" for item in document_payloads),
        "documents": document_payloads,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect acquired Brasil Escola package families without OCR/AI.")
    parser.add_argument("--input", default=".ingestion-inbox/brasil-escola/nordeste")
    parser.add_argument("--output", default=".ingestion-cache/brasil-escola/nordeste/bulk-inspection.json")
    args = parser.parse_args()

    root = Path(args.input)
    paths = sorted(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED)
    packages = []
    failures = []
    for path in paths:
        try:
            packages.append(inspect_file(path))
        except Exception as error:
            failures.append({"path": str(path), "error": str(error)})

    institutions = {}
    for package in packages:
        slug = package.get("institutionSlug") or "unknown"
        item = institutions.setdefault(slug, {
            "institution": package.get("institution"),
            "packages": 0,
            "documents": 0,
            "examCandidates": 0,
            "answerKeyCandidates": 0,
            "unknownDocuments": 0,
            "questionNumberSignal": 0,
        })
        item["packages"] += 1
        item["documents"] += package.get("documentCount", 0)
        item["examCandidates"] += package.get("examCandidates", 0)
        item["answerKeyCandidates"] += package.get("answerKeyCandidates", 0)
        item["unknownDocuments"] += package.get("unknownDocuments", 0)
        item["questionNumberSignal"] += sum(doc.get("questionNumberSignal", 0) for doc in package.get("documents", []))

    payload = {
        "version": 1,
        "packagesScanned": len(packages),
        "failures": failures,
        "institutions": institutions,
        "packages": packages,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "packagesScanned": payload["packagesScanned"],
        "failures": len(failures),
        "institutions": institutions,
    }, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
