#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROBE_SCRIPT = SCRIPT_DIR / "probe-upe-safe.py"
URCA_SCRIPT = SCRIPT_DIR / "ingest-urca-safe-v2.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


probe = load_module("ingest_upe_probe", PROBE_SCRIPT)
urca = load_module("ingest_upe_question_core", URCA_SCRIPT)
core = urca.core
base = core.base

PARSER_VERSION = "inbox-upe-ssa@0.1.0"
PROVIDER_ID = "brasil-escola"
RIGHTS_STATUS = "third-party-mirror-reference"
UPE_SLUG = "universidade-pernambuco"
YEAR_RE = re.compile(r"(?<!\d)((?:20)\d{2})(?!\d)")
VISUAL_RE = core.VISUAL_RE
ANSWER_TOKEN_RE = r"(?:[A-E]|X|NULA|NULO|ANULADA|ANULADO)"


def compact(value: str) -> str:
    return core.compact(probe.utf8_safe(value))


def norm(value: str) -> str:
    return core.norm(probe.utf8_safe(value))


def sidecar(path: Path) -> dict:
    return probe.sidecar(path)


def inputs(values: list[str]) -> list[Path]:
    output: list[Path] = []
    for raw in values or [f".ingestion-inbox/brasil-escola/nordeste/{UPE_SLUG}"]:
        path = Path(raw)
        if path.is_dir():
            output.extend(sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in probe.SUPPORTED))
        elif path.is_file() and path.suffix.lower() in probe.SUPPORTED:
            output.append(path)
        elif not path.exists():
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(output))


def package_sha(path: Path, meta: dict) -> str:
    value = str(meta.get("sha256") or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{64}", value):
        return value
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def derive_package_year(meta: dict, documents) -> tuple[int | None, str]:
    # The mirror has at least one package whose catalogue year disagrees with
    # the bytes it serves. Prefer strong year evidence embedded in member names.
    leaf_years: list[int] = []
    for document in documents:
        leaf_years.extend(int(value) for value in YEAR_RE.findall(document.leaf))
    if leaf_years:
        counts = {year: leaf_years.count(year) for year in sorted(set(leaf_years))}
        winner = max(counts, key=lambda year: (counts[year], year))
        if counts[winner] >= 1 and len(counts) == 1:
            return winner, "member-name"

    header_years: list[int] = []
    for document in documents:
        header = norm(document.first_text[:1800])
        for match in re.finditer(r"(?:\bssa\b|sistema seriado de avaliacao).{0,80}?\b(20\d{2})\b", header):
            header_years.append(int(match.group(1)))
        for match in re.finditer(r"\b(20\d{2})\b.{0,80}?(?:\bssa\b|sistema seriado de avaliacao)", header):
            header_years.append(int(match.group(1)))
    if header_years:
        counts = {year: header_years.count(year) for year in sorted(set(header_years))}
        winner = max(counts, key=lambda year: (counts[year], year))
        return winner, "pdf-header"

    try:
        return int(meta.get("year")), "catalogue"
    except (TypeError, ValueError):
        title = str(meta.get("title") or "")
        match = YEAR_RE.search(title)
        return (int(match.group(1)), "catalogue-title") if match else (None, "missing")


def day(document) -> int | None:
    leaf = norm(document.leaf)
    text = norm(document.first_text[:1200])
    patterns = (
        (1, (r"\b1\s*(?:o|a)?\s*dia\b", r"\bprimeiro\s+dia\b", r"\bdia\s*1\b")),
        (2, (r"\b2\s*(?:o|a)?\s*dia\b", r"\bsegundo\s+dia\b", r"\bdia\s*2\b")),
    )
    for number, variants in patterns:
        if any(re.search(pattern, leaf) for pattern in variants):
            return number
    for number, variants in patterns:
        if any(re.search(pattern, text) for pattern in variants):
            return number
    return None


def answer_value(token: str) -> str | None:
    value = base.deaccent(token).upper()
    return value if value in {"A", "B", "C", "D", "E"} else None


def parse_key(document) -> dict[int, str | None]:
    best: dict[int, str | None] = {}
    token_pattern = re.compile(
        rf"(?<!\d)(\d{{1,3}})\s*[-.:=)]?\s*({ANSWER_TOKEN_RE})(?![A-Z])",
        re.I,
    )
    token_only = re.compile(rf"(?<![A-Z])({ANSWER_TOKEN_RE})(?![A-Z])", re.I)
    for layout in (True, False):
        try:
            text = "\n".join(base.pdf_pages(document, layout=layout))
        except Exception:
            continue
        answers: dict[int, str | None] = {}
        lines = [compact(line) for line in text.splitlines() if compact(line)]
        for line in lines:
            deaccented = base.deaccent(line).upper()
            for number, token in token_pattern.findall(deaccented):
                value = int(number)
                if 1 <= value <= 150:
                    answers[value] = answer_value(token)
        # Handle two-line/table keys where one row contains question numbers and
        # a following row contains only the corresponding answer tokens.
        for index, line in enumerate(lines):
            numbers = [int(value) for value in re.findall(r"(?<!\d)(\d{1,3})(?!\d)", line) if 1 <= int(value) <= 150]
            if len(numbers) < 4:
                continue
            tokens: list[str] = []
            for following in lines[index + 1 : index + 4]:
                next_numbers = [int(value) for value in re.findall(r"(?<!\d)(\d{1,3})(?!\d)", following) if 1 <= int(value) <= 150]
                if len(next_numbers) >= 4 and not tokens:
                    break
                tokens.extend(token_only.findall(base.deaccent(following).upper()))
                if len(tokens) >= len(numbers):
                    break
            if len(tokens) >= len(numbers):
                for number, token in zip(numbers, tokens):
                    answers[number] = answer_value(token)
        if len(answers) > len(best):
            best = answers
    return best


def expected_numbers(answer_map: dict[int, str | None]) -> list[int]:
    if not answer_map:
        return []
    numbers = sorted(number for number in answer_map if 1 <= number <= 150)
    maximum = max(numbers)
    density = len(numbers) / maximum if maximum else 0
    if numbers[0] <= 2 and maximum <= 100 and density >= 0.75:
        return list(range(1, maximum + 1))
    return numbers


def descriptor(document, record: dict) -> dict:
    return {
        "archive": record["archive"],
        "packageSha256": record["packageSha256"],
        "downloadId": record["downloadId"],
        "title": record["title"],
        "downloadUrl": record["downloadUrl"],
        "resolvedDownloadUrl": record["resolvedDownloadUrl"],
        "member": document.member,
        "sha256": document.sha256,
        "bytes": document.size,
        "pages": document.page_count,
    }


def choose_exam(items: list[dict]) -> dict | None:
    return max(items, default=None, key=lambda item: (len(item["questions"]), item["document"].page_count))


def choose_key(items: list[dict]) -> dict | None:
    status_score = {"definitive": 2, "preliminary": 1, "unknown": 0}
    return max(items, default=None, key=lambda item: (len(item["answers"]), status_score[item["status"]]))


def build_unit(year: int, stage: int, day_no: int, bucket: dict) -> dict:
    exam = choose_exam(bucket.get("exams", []))
    key = choose_key(bucket.get("keys", []))
    qmap = exam["questions"] if exam else {}
    amap = key["answers"] if key else {}
    identities = expected_numbers(amap)
    questions = []
    missing_questions = []
    missing_answers = []
    incompatible_answers = []
    review = 0

    for number in identities:
        candidate = qmap.get(number)
        if candidate is None:
            missing_questions.append(number)
            continue
        if number not in amap:
            missing_answers.append(number)
            continue
        correct = amap[number]
        if correct is not None and correct not in candidate.alternatives:
            incompatible_answers.append(number)
            continue
        visual = bool(VISUAL_RE.search(candidate.statement))
        review += int(visual)
        letters = sorted(candidate.alternatives)
        questions.append({
            "number": number,
            "subject": "Conhecimentos gerais",
            "statement": candidate.statement,
            "alternatives": [{"id": letter, "text": candidate.alternatives[letter]} for letter in letters],
            "correctAlternative": correct,
            "annulled": correct is None,
            "page": candidate.page,
            "flags": ["likely-visual-dependency"] if visual else [],
        })

    issues = []
    if exam is None:
        issues.append("exam-document-not-found")
    if key is None:
        issues.append("answer-key-document-not-found")
    if missing_questions:
        issues.append("missing-questions:" + ",".join(map(str, missing_questions)))
    if missing_answers:
        issues.append("missing-answers:" + ",".join(map(str, missing_answers)))
    if incompatible_answers:
        issues.append("answer-not-in-alternatives:" + ",".join(map(str, incompatible_answers)))
    if key and key["status"] != "definitive":
        issues.append(f"answer-key-status:{key['status']}")

    expected = len(identities)
    return {
        "id": f"day-{day_no}",
        "label": f"{day_no}º dia",
        "year": year,
        "stage": stage,
        "expectedQuestions": expected,
        "extractedQuestions": len(questions),
        "missingIdentities": max(0, expected - len(questions)),
        "structurallyComplete": expected > 0 and len(questions) == expected,
        "answerKeyStatus": key["status"] if key else "missing",
        "questionsNeedingReview": review,
        "visualDependencies": review,
        "examDocument": descriptor(exam["document"], exam) if exam else None,
        "answerKeyDocument": descriptor(key["document"], key) if key else None,
        "issues": issues,
        "questions": questions,
    }


def json_text(payload: dict) -> str:
    text = json.dumps(probe.utf8_safe(payload), ensure_ascii=False, indent=2) + "\n"
    text.encode("utf-8")
    return text


def process(paths: list[Path]) -> tuple[list[dict], dict]:
    groups: dict[tuple[int, int, int], dict] = defaultdict(lambda: {"exams": [], "keys": []})
    failures = []
    duplicates = []
    ambiguous = []
    seen_packages: dict[str, str] = {}
    seen_documents: dict[str, str] = {}

    for path in paths:
        meta = sidecar(path)
        try:
            fingerprint = package_sha(path, meta)
            if fingerprint in seen_packages:
                duplicates.append({"archive": path.name, "packageSha256": fingerprint, "duplicateOf": seen_packages[fingerprint]})
                continue
            seen_packages[fingerprint] = path.name
            documents = probe.mirror.load_documents(path)
            if documents is None:
                failures.append({"archive": path.name, "exceptionType": "ExtractorUnavailable", "error": "compressed-extractor-unavailable"})
                continue
            base.hydrate_pdf_metadata(documents)
            year, year_evidence = derive_package_year(meta, documents)
            for document in documents:
                if document.sha256 in seen_documents:
                    duplicates.append({"archive": path.name, "member": document.member, "sha256": document.sha256, "duplicateOf": seen_documents[document.sha256]})
                    continue
                seen_documents[document.sha256] = f"{path.name}:{document.member}"
                variant = probe.classify_variant(str(meta.get("title") or ""), document.leaf, document.first_text)
                stage = variant.get("stage")
                day_no = day(document)
                role = probe.role(document)
                if variant.get("modality") != "ssa" or year is None or stage not in (1, 2, 3) or day_no not in (1, 2) or role not in {"exam", "answer-key"}:
                    ambiguous.append({
                        "archive": path.name,
                        "member": document.member,
                        "sha256": document.sha256,
                        "year": year,
                        "yearEvidence": year_evidence,
                        "modality": variant.get("modality"),
                        "stage": stage,
                        "stageCandidates": variant.get("stageCandidates"),
                        "day": day_no,
                        "role": role,
                    })
                    continue
                record = {
                    "archive": path.name,
                    "packageSha256": fingerprint,
                    "downloadId": meta.get("downloadId"),
                    "title": meta.get("title"),
                    "downloadUrl": meta.get("downloadUrl"),
                    "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
                    "yearEvidence": year_evidence,
                    "document": document,
                }
                bucket = groups[(year, stage, day_no)]
                if role == "exam":
                    record["questions"] = core.parse_questions(document)
                    bucket["exams"].append(record)
                else:
                    record["answers"] = parse_key(document)
                    record["status"] = core.key_status(document)
                    bucket["keys"].append(record)
        except Exception as error:
            failures.append({"archive": path.name, "exceptionType": type(error).__name__, "error": probe.utf8_safe(str(error))})

    editions = []
    edition_keys = sorted({(year, stage) for year, stage, _ in groups})
    for year, stage in edition_keys:
        units = [build_unit(year, stage, day_no, groups.get((year, stage, day_no), {})) for day_no in (1, 2)]
        expected = sum(unit["expectedQuestions"] for unit in units)
        extracted = sum(unit["extractedQuestions"] for unit in units)
        editions.append({
            "providerId": PROVIDER_ID,
            "institution": "UPE",
            "modality": "SSA",
            "editionId": f"upe-ssa-{year}-stage-{stage}",
            "year": year,
            "stage": stage,
            "parserVersion": PARSER_VERSION,
            "rightsStatus": RIGHTS_STATUS,
            "units": units,
            "summary": {
                "expectedQuestions": expected,
                "extractedQuestions": extracted,
                "completeUnits": sum(int(unit["structurallyComplete"]) for unit in units),
                "missingIdentities": max(0, expected - extracted),
                "visualDependencies": sum(unit["visualDependencies"] for unit in units),
            },
        })

    diagnostics = {
        "archivesScanned": len(paths),
        "uniquePackages": len(seen_packages),
        "duplicateSources": duplicates,
        "ambiguousDocuments": ambiguous,
        "failures": failures,
    }
    return editions, diagnostics


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract deterministic UPE SSA corpus by year, stage and day.")
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--output", default=".ingestion-cache/inbox")
    args = parser.parse_args()
    try:
        paths = inputs(args.input)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    if not paths:
        print("no UPE packages found", file=sys.stderr)
        return 2

    editions, diagnostics = process(paths)
    output = Path(args.output)
    persisted = []
    failures = list(diagnostics["failures"])
    for payload in editions:
        try:
            destination = output / "upe-ssa" / str(payload["year"]) / f"stage-{payload['stage']}"
            destination.mkdir(parents=True, exist_ok=True)
            (destination / "bundle.json").write_text(json_text(payload), encoding="utf-8")
            persisted.append(payload)
        except Exception as error:
            failures.append({"editionId": payload.get("editionId"), "exceptionType": type(error).__name__, "error": probe.utf8_safe(str(error))})

    expected = sum(item["summary"]["expectedQuestions"] for item in persisted)
    extracted = sum(item["summary"]["extractedQuestions"] for item in persisted)
    summary = {
        "version": 1,
        "parserVersion": PARSER_VERSION,
        "providerId": PROVIDER_ID,
        "institution": "UPE",
        "modality": "SSA",
        "archivesScanned": diagnostics["archivesScanned"],
        "uniquePackages": diagnostics["uniquePackages"],
        "duplicateSources": diagnostics["duplicateSources"],
        "ambiguousDocuments": diagnostics["ambiguousDocuments"],
        "editions": len(persisted),
        "expectedQuestions": expected,
        "extractedQuestions": extracted,
        "completeUnits": sum(item["summary"]["completeUnits"] for item in persisted),
        "missingIdentities": max(0, expected - extracted),
        "visualDependencies": sum(item["summary"]["visualDependencies"] for item in persisted),
        "cycles": [
            {
                "editionId": item["editionId"],
                "year": item["year"],
                "stage": item["stage"],
                **item["summary"],
                "unitCoverage": [f"{unit['extractedQuestions']}/{unit['expectedQuestions']}" for unit in item["units"]],
            }
            for item in persisted
        ],
        "failures": failures,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "upe-summary.json").write_text(json_text(summary), encoding="utf-8")
    print(json.dumps(probe.utf8_safe(summary), ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
