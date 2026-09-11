#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

CORE_SCRIPT = Path(__file__).resolve().with_name("ingest-uece-inbox.py")
spec = importlib.util.spec_from_file_location("ingest_uece_inbox_core", CORE_SCRIPT)
assert spec and spec.loader
core = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = core
spec.loader.exec_module(core)

core.PARSER_VERSION = "inbox-uece@0.2.0"
SUPPORTED = {".zip", ".pdf", ".rar", ".7z"}


def inputs(values):
    output = []
    for raw in values or [f".ingestion-inbox/brasil-escola/nordeste/{core.UECE_SLUG}"]:
        path = Path(raw)
        if path.is_dir():
            output.extend(sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in SUPPORTED))
        elif path.is_file() and path.suffix.lower() in SUPPORTED:
            output.append(path)
        elif not path.exists():
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(output))


def is_exam(document):
    text = core.norm(document.first_text)
    leaf = core.norm(document.leaf)
    if core.phase(document.first_text, 2) and not core.phase(document.first_text, 1):
        return False
    key_only = (
        "gabarito" in leaf
        or "grade definitiva de respostas" in text
        or "grade preliminar de respostas" in text
        or (
            document.page_count <= 5
            and "gabarito" in text
            and "prova de conhecimentos gerais" not in text
            and "caderno de prova" not in text
        )
    )
    positive = core.phase(document.first_text, 1) and any(
        marker in text
        for marker in (
            "prova de conhecimentos gerais",
            "conhecimentos gerais",
            "caderno de prova",
        )
    )
    return positive and not key_only


def load_documents(path: Path):
    suffix = path.suffix.lower()
    if suffix == ".zip":
        return core.base.load_documents([path])
    if suffix == ".pdf":
        data = path.read_bytes()
        return [
            core.base.PdfDocument(
                archive=path.name,
                member=path.name,
                leaf=path.name,
                bytes=data,
                sha256=core.base.sha256(data),
                size=len(data),
            )
        ]
    return []


def source_info(source, *, reason: str | None = None):
    data = source.path.read_bytes()
    payload = {
        "name": source.path.name,
        "sha256": core.base.sha256(data),
        "bytes": len(data),
        "downloadId": source.meta.get("downloadId"),
        "title": source.title,
        "downloadUrl": source.meta.get("downloadUrl"),
        "resolvedDownloadUrl": source.meta.get("resolvedDownloadUrl"),
        "detectedFormat": source.meta.get("detectedFormat") or source.path.suffix.lower().removeprefix("."),
    }
    if reason:
        payload["reason"] = reason
    return payload


def scan(source):
    if not core.is_uece(source):
        return [], {"archive": source.path.name, "reason": "not-uece"}, None
    if source.path.suffix.lower() in {".rar", ".7z"}:
        return [], source_info(source, reason="compressed-format-staged-for-later-extractor"), None
    try:
        documents = load_documents(source.path)
        core.base.hydrate_pdf_metadata(documents)
    except Exception as error:
        return [], {}, str(error)

    relevant = []
    for document in documents:
        if core.is_exam(document) or core.is_key(document):
            detected_cycle = core.cycle(document.first_text, source)
            if all(detected_cycle):
                relevant.append((detected_cycle, document))
    if not relevant:
        return [], source_info(source, reason="no-first-phase-objective-documents"), None
    info = source_info(source)
    return relevant, info, None


core.inputs = inputs
core.is_exam = is_exam
core.scan = scan

if __name__ == "__main__":
    raise SystemExit(core.main())
