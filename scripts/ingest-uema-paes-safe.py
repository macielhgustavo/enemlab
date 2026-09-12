#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROBE_SCRIPT = SCRIPT_DIR / "probe-uema-safe.py"
UPE_SCRIPT = SCRIPT_DIR / "ingest-upe-ssa-safe.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


probe = load_module("ingest_uema_probe", PROBE_SCRIPT)
upe = load_module("ingest_uema_upe_core", UPE_SCRIPT)
core = upe.core
base = upe.base

PARSER_VERSION = "inbox-uema-paes@0.1.0"
PROVIDER_ID = "brasil-escola"
RIGHTS_STATUS = "third-party-mirror-reference"
UEMA_SLUG = "universidade-estadual-maranhao"
VISUAL_RE = upe.VISUAL_RE
ANSWER_TOKEN_RE = r"(?:[A-E]|X|NULA|NULO|ANULADA|ANULADO)"
ANSWER_PAIR_RE = re.compile(
    rf"(?<!\d)(\d{{1,3}})\s*[-.:=)]?\s*({ANSWER_TOKEN_RE})(?![A-Z])",
    re.I,
)


def compact(value: str) -> str:
    return core.compact(probe.utf8_safe(value))


def inputs(values: list[str]) -> list[Path]:
    output: list[Path] = []
    for raw in values or [f".ingestion-inbox/brasil-escola/nordeste/{UEMA_SLUG}"]:
        path = Path(raw)
        if path.is_dir():
            output.extend(sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in probe.SUPPORTED))
        elif path.is_file() and path.suffix.lower() in probe.SUPPORTED:
            output.append(path)
        elif not path.exists():
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(output))


def answer_value(token: str) -> str | None:
    value = base.deaccent(token).upper()
    return value if value in {"A", "B", "C", "D", "E"} else None


def parse_key_text(text: str) -> tuple[dict[int, str | None], set[int]]:
    values: dict[int, set[str]] = defaultdict(set)
    for raw in text.splitlines():
        line = base.deaccent(compact(raw)).upper()
        for number_text, token in ANSWER_PAIR_RE.findall(line):
            number = int(number_text)
            if 1 <= number <= 150:
                normalized = base.deaccent(token).upper()
                values[number].add(normalized)

    answers: dict[int, str | None] = {}
    conflicts: set[int] = set()
    for number, tokens in values.items():
        semantic = {answer_value(token) for token in tokens}
        # Different language variants often repeat the same question identity
        # with different answers. Never choose one silently.
        if len(semantic) != 1:
            conflicts.add(number)
            continue
        answers[number] = next(iter(semantic))
    return answers, conflicts


def parse_key(document) -> tuple[dict[int, str | None], set[int]]:
    best_answers: dict[int, str | None] = {}
    best_conflicts: set[int] = set()
    best_score = (-1, -1)
    for layout in (True, False):
        try:
            text = "\n".join(base.pdf_pages(document, layout=layout))
        except Exception:
            continue
        answers, conflicts = parse_key_text(text)
        score = (len(answers) + len(conflicts), len(answers))
        if score > best_score:
            best_answers, best_conflicts, best_score = answers, conflicts, score
    return best_answers, best_conflicts


def document_day(document, year: int) -> int:
    leaf = base.deaccent(document.leaf).lower()
    if re.search(r"(?:^|[/\\])(?:1|01)[-_ .]", leaf) or re.search(r"\b(?:prova|gab)[-_ ]*(?:1|01)[-_ ]", leaf):
        return 1
    if re.search(r"(?:^|[/\\])(?:2|02)[-_ .]", leaf) or re.search(r"\b(?:prova|gab)[-_ ]*(?:2|02)[-_ ]", leaf):
        return 2
    if year == 2021:
        if "04_07_2021" in leaf or "04-07-2021" in leaf:
            return 1
        if "05_07_2021" in leaf or "05-07-2021" in leaf:
            return 2
    return 1


def package_year(meta: dict, path: Path) -> int | None:
    try:
        value = int(meta.get("year"))
        if 2000 <= value <= 2100:
            return value
    except (TypeError, ValueError):
        pass
    title = str(meta.get("title") or path.stem)
    match = re.search(r"(?<!\d)(20\d{2})(?!\d)", title)
    return int(match.group(1)) if match else None


def descriptor(document, record: dict) -> dict:
    return {
        "archive": record["archive"],
        "packageSha256": record["packageSha256"],
        "downloadId": record.get("downloadId"),
        "title": record.get("title"),
        "downloadUrl": record.get("downloadUrl"),
        "resolvedDownloadUrl": record.get("resolvedDownloadUrl"),
        "member": document.member,
        "sha256": document.sha256,
        "bytes": document.size,
        "pages": document.page_count,
    }


def choose_exam(items: list[dict]) -> dict | None:
    return max(items, default=None, key=lambda item: (len(item["questions"]), item["document"].page_count))


def choose_key(items: list[dict]) -> dict | None:
    status_score = {"definitive": 2, "preliminary": 1, "unknown": 0}
    return max(
        items,
        default=None,
        key=lambda item: (len(item["answers"]) + len(item["conflicts"]), status_score[item["status"]]),
    )


def build_unit(year: int, day_no: int, bucket: dict) -> dict:
    exam = choose_exam(bucket.get("exams", []))
    key = choose_key(bucket.get("keys", []))
    qmap = exam["questions"] if exam else {}
    amap = key["answers"] if key else {}
    conflicts = key["conflicts"] if key else set()
    identities = sorted(set(amap) | set(conflicts))

    questions = []
    missing_questions = []
    ambiguous_language_answers = []
    incompatible_answers = []
    review = 0
    for number in identities:
        if number in conflicts:
            ambiguous_language_answers.append(number)
            continue
        candidate = qmap.get(number)
        if candidate is None:
            missing_questions.append(number)
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
    if ambiguous_language_answers:
        issues.append("ambiguous-language-answer:" + ",".join(map(str, ambiguous_language_answers)))
    if incompatible_answers:
        issues.append("answer-not-in-alternatives:" + ",".join(map(str, incompatible_answers)))
    if key and key["status"] != "definitive":
        issues.append(f"answer-key-status:{key['status']}")

    expected = len(identities)
    return {
        "id": f"day-{day_no}",
        "label": f"{day_no}º dia" if year == 2021 else "Prova objetiva",
        "year": year,
        "expectedQuestions": expected,
        "extractedQuestions": len(questions),
        "missingIdentities": max(0, expected - len(questions)),
        "structurallyComplete": expected > 0 and len(questions) == expected,
        "answerKeyStatus": key["status"] if key else "missing",
        "ambiguousLanguageAnswers": sorted(ambiguous_language_answers),
        "questionsNeedingReview": review,
        "visualDependencies": review,
        "examDocument": descriptor(exam["document"], exam) if exam else None,
        "answerKeyDocument": descriptor(key["document"], key) if key else None,
        "issues": issues,
        "questions": questions,
    }


def process(paths: list[Path]) -> tuple[list[dict], dict]:
    groups: dict[tuple[int, int], dict] = defaultdict(lambda: {"exams": [], "keys": []})
    failures = []
    excluded = []
    seen_packages: dict[str, str] = {}
    regular_packages = 0

    for path in paths:
        meta = probe.sidecar(path)
        title = str(meta.get("title") or path.stem)
        modality = probe.classify_modality(title)
        fingerprint = upe.package_sha(path, meta)
        if fingerprint in seen_packages:
            excluded.append({"archive": path.name, "reason": "duplicate-package", "duplicateOf": seen_packages[fingerprint], "packageSha256": fingerprint})
            continue
        seen_packages[fingerprint] = path.name
        if modality != "regular":
            excluded.append({"archive": path.name, "title": title, "reason": f"excluded-modality:{modality}", "packageSha256": fingerprint})
            continue
        regular_packages += 1
        year = package_year(meta, path)
        if year is None:
            failures.append({"archive": path.name, "exceptionType": "YearMissing", "error": "could not determine PAES edition year"})
            continue
        try:
            documents = probe.mirror.load_documents(path)
            if documents is None:
                failures.append({"archive": path.name, "exceptionType": "ExtractorUnavailable", "error": "compressed-extractor-unavailable"})
                continue
            base.hydrate_pdf_metadata(documents)
            for document in documents:
                doc_modality = probe.classify_modality(title, document.leaf, document.first_text)
                if doc_modality != "regular":
                    excluded.append({"archive": path.name, "member": document.member, "sha256": document.sha256, "reason": f"excluded-document-modality:{doc_modality}"})
                    continue
                role = probe.role(document)
                if role not in {"exam", "answer-key"}:
                    continue
                day_no = document_day(document, year)
                record = {
                    "archive": path.name,
                    "packageSha256": fingerprint,
                    "downloadId": meta.get("downloadId"),
                    "title": meta.get("title"),
                    "downloadUrl": meta.get("downloadUrl"),
                    "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
                    "document": document,
                }
                if role == "exam":
                    record["questions"] = core.parse_questions(document)
                    groups[(year, day_no)]["exams"].append(record)
                else:
                    answers, conflicts = parse_key(document)
                    record["answers"] = answers
                    record["conflicts"] = conflicts
                    record["status"] = core.key_status(document)
                    groups[(year, day_no)]["keys"].append(record)
        except Exception as error:
            failures.append({"archive": path.name, "exceptionType": type(error).__name__, "error": probe.utf8_safe(str(error))})

    editions = []
    years = sorted({year for year, _ in groups})
    for year in years:
        days = (1, 2) if year == 2021 else (1,)
        units = [build_unit(year, day_no, groups.get((year, day_no), {})) for day_no in days]
        expected = sum(unit["expectedQuestions"] for unit in units)
        extracted = sum(unit["extractedQuestions"] for unit in units)
        editions.append({
            "providerId": PROVIDER_ID,
            "institution": "UEMA",
            "modality": "PAES regular",
            "editionId": f"uema-paes-{year}",
            "year": year,
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

    summary = {
        "version": 1,
        "parserVersion": PARSER_VERSION,
        "providerId": PROVIDER_ID,
        "institution": "UEMA",
        "modality": "PAES regular",
        "archivesScanned": len(paths),
        "regularPackages": regular_packages,
        "editions": len(editions),
        "expectedQuestions": sum(item["summary"]["expectedQuestions"] for item in editions),
        "extractedQuestions": sum(item["summary"]["extractedQuestions"] for item in editions),
        "completeUnits": sum(item["summary"]["completeUnits"] for item in editions),
        "missingIdentities": sum(item["summary"]["missingIdentities"] for item in editions),
        "visualDependencies": sum(item["summary"]["visualDependencies"] for item in editions),
        "excludedSources": excluded,
        "cycles": [
            {
                "editionId": item["editionId"],
                "year": item["year"],
                **item["summary"],
                "unitCoverage": [f"{unit['extractedQuestions']}/{unit['expectedQuestions']}" for unit in item["units"]],
            }
            for item in editions
        ],
        "failures": failures,
    }
    return editions, summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely ingest regular UEMA PAES objective exams from mirrored packages.")
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--output", default=".ingestion-cache/brasil-escola/nordeste/uema-extracted")
    args = parser.parse_args()

    paths = inputs(args.input)
    editions, summary = process(paths)
    output = Path(args.output)
    for edition in editions:
        target = output / "uema-paes" / str(edition["year"]) / "bundle.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(upe.json_text(edition), encoding="utf-8")
    output.mkdir(parents=True, exist_ok=True)
    (output / "uema-summary.json").write_text(upe.json_text(summary), encoding="utf-8")
    print(json.dumps(probe.utf8_safe(summary), ensure_ascii=False, indent=2))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
