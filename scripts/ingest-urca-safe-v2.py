#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

CORE_SCRIPT = Path(__file__).resolve().with_name("ingest-urca-safe.py")
spec = importlib.util.spec_from_file_location("ingest_urca_safe_core", CORE_SCRIPT)
assert spec and spec.loader
core = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = core
spec.loader.exec_module(core)

core.PARSER_VERSION = "inbox-urca@0.3.0"
# URCA booklets use headings such as "QUESTÃO 01" followed by lowercase a.–e.
# The legacy numeric form is accepted only when it carries question punctuation,
# preventing arbitrary year/page-number lines from becoming question boundaries.
core.Q_RE = re.compile(
    r"^\s*(?:(?:QUEST[ÃA]O)\s+|(?=0?\d{1,3}\s*[.)-]))0?(\d{1,3})\s*[.:)-]?\s*(.*)$",
    re.I,
)

SURROGATE_RE = re.compile(r"[\ud800-\udfff]")


def utf8_safe(value):
    """Replace invalid lone Unicode surrogates without hiding structural failures."""
    if isinstance(value, str):
        return SURROGATE_RE.sub("\ufffd", value)
    if isinstance(value, list):
        return [utf8_safe(item) for item in value]
    if isinstance(value, tuple):
        return [utf8_safe(item) for item in value]
    if isinstance(value, dict):
        return {utf8_safe(key): utf8_safe(item) for key, item in value.items()}
    return value


_original_compact = core.compact


def safe_compact(value: str) -> str:
    return _original_compact(utf8_safe(value))


core.compact = safe_compact
_original_process_package = core.process_package


def decorate_payload(payload: dict) -> dict:
    payload = utf8_safe(payload)
    if payload.get("status") == "staged":
        return payload
    for unit in payload.get("units", []):
        expected = int(unit.get("expectedQuestions", 0))
        extracted = int(unit.get("extractedQuestions", 0))
        visual = int(unit.get("questionsNeedingReview", 0))
        unit["missingIdentities"] = max(0, expected - extracted)
        unit["visualDependencies"] = visual
    summary = payload.setdefault("summary", {})
    expected = int(summary.get("expectedQuestions", 0))
    extracted = int(summary.get("extractedQuestions", 0))
    summary["missingIdentities"] = max(0, expected - extracted)
    summary["visualDependencies"] = sum(int(unit.get("visualDependencies", 0)) for unit in payload.get("units", []))
    return payload


def process_package(path: Path) -> dict:
    return decorate_payload(_original_process_package(path))


core.process_package = process_package


def json_text(payload: dict) -> str:
    text = json.dumps(utf8_safe(payload), ensure_ascii=False, indent=2) + "\n"
    # Fail here, before accounting the edition, if future extraction emits invalid UTF-8.
    text.encode("utf-8")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description="URCA deterministic two-day extraction fast lane.")
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--output", default=".ingestion-cache/inbox")
    args = parser.parse_args()
    try:
        paths = core.inputs(args.input)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    if not paths:
        print("no URCA packages found", file=sys.stderr)
        return 2

    output = Path(args.output)
    editions = []
    failures = []
    for path in paths:
        try:
            payload = process_package(path)
            if payload.get("status") == "staged":
                continue
            destination = output / "urca" / payload["editionId"].removeprefix("urca-")
            destination.mkdir(parents=True, exist_ok=True)
            (destination / "bundle.json").write_text(json_text(payload), encoding="utf-8")
            # Only persisted, UTF-8-valid bundles participate in corpus accounting.
            editions.append(payload)
        except Exception as error:
            failures.append({
                "archive": path.name,
                "exceptionType": type(error).__name__,
                "error": utf8_safe(str(error)),
            })

    expected_questions = sum(item["summary"]["expectedQuestions"] for item in editions)
    extracted_questions = sum(item["summary"]["extractedQuestions"] for item in editions)
    visual_dependencies = sum(item["summary"]["visualDependencies"] for item in editions)
    summary = {
        "version": 1,
        "parserVersion": core.PARSER_VERSION,
        "providerId": core.PROVIDER_ID,
        "institution": "URCA",
        "archivesScanned": len(paths),
        "editions": len(editions),
        "expectedQuestions": expected_questions,
        "extractedQuestions": extracted_questions,
        "completeUnits": sum(item["summary"]["completeUnits"] for item in editions),
        "missingIdentities": max(0, expected_questions - extracted_questions),
        "visualDependencies": visual_dependencies,
        "questionsNeedingReview": visual_dependencies,
        "cycles": [
            {
                "editionId": item["editionId"],
                "year": item["year"],
                "term": item["term"],
                **item["summary"],
                "unitCoverage": [f"{unit['extractedQuestions']}/{unit['expectedQuestions']}" for unit in item["units"]],
            }
            for item in editions
        ],
        "failures": failures,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "urca-summary.json").write_text(json_text(summary), encoding="utf-8")
    print(json.dumps(utf8_safe(summary), ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
