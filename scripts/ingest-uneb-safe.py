#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROBE_SCRIPT = SCRIPT_DIR / "probe-uneb-safe.py"
UPE_SCRIPT = SCRIPT_DIR / "ingest-upe-ssa-safe.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


probe = load_module("ingest_uneb_probe", PROBE_SCRIPT)
upe = load_module("ingest_uneb_upe_core", UPE_SCRIPT)
core = upe.core
base = upe.base

PARSER_VERSION = "inbox-uneb@0.1.0"
PROVIDER_ID = "brasil-escola"
RIGHTS_STATUS = "third-party-mirror-reference"
UNEB_SLUG = "universidade-estado-bahia"
VISUAL_RE = upe.VISUAL_RE
SUPPORTED = probe.SUPPORTED

QUESTION_RE = re.compile(r"^\s*QUESTAO\s+0?(\d{1,3})\s*(?:[.:)-])?\s*$", re.I)
CORRECT_RE = re.compile(
    r"^\s*\(?\s*(?:CORRETA|RESPOSTA\s+CORRETA)\s*:\s*([A-E])\s*\)?\s*$",
    re.I,
)
ALTERNATIVE_RE = re.compile(r"^\s*(?:\(([A-E])\)|([A-E])\s*[.)-])\s*(.*)$", re.I)
EXPECTED_RE = re.compile(r"\b(\d{2,3})\s*\([^)]*\)\s*QUESTOES\s+OBJETIVAS\b", re.I)
YEAR_RE = re.compile(r"(?<!\d)(20\d{2})(?!\d)")
FOOTER_RE = re.compile(
    r"^(?:VESTIBULAR\s*[-–]|PROVA\s+MATRIZ\s*[-–]|DIA\s*[12]\s*[-–]).*\d+\s*$",
    re.I,
)


@dataclass
class Candidate:
    number: int
    statement: str
    alternatives: dict[str, str]
    correct: str | None
    page: int

    @property
    def complete(self) -> bool:
        return bool(self.statement) and set(self.alternatives) == {"A", "B", "C", "D", "E"}

    @property
    def score(self) -> tuple[int, int, int]:
        return (
            int(self.complete),
            int(self.correct in self.alternatives if self.correct else False),
            len(self.statement) + sum(len(value) for value in self.alternatives.values()),
        )


def compact(value: str) -> str:
    return core.compact(probe.utf8_safe(value))


def inputs(values: list[str]) -> list[Path]:
    output: list[Path] = []
    for raw in values or [f".ingestion-inbox/brasil-escola/nordeste/{UNEB_SLUG}"]:
        path = Path(raw)
        if path.is_dir():
            output.extend(sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in SUPPORTED))
        elif path.is_file() and path.suffix.lower() in SUPPORTED:
            output.append(path)
        elif not path.exists():
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(output))


def package_year(meta: dict, path: Path) -> int | None:
    try:
        year = int(meta.get("year"))
        if 2000 <= year <= 2100:
            return year
    except (TypeError, ValueError):
        pass
    match = YEAR_RE.search(str(meta.get("title") or path.stem))
    return int(match.group(1)) if match else None


def document_day(document) -> int | None:
    raw = base.deaccent(document.leaf).lower()
    if re.search(r"\bdia[-_. ]*0?1\b", raw) or "primeiro-dia" in raw or "primeiro dia" in raw:
        return 1
    if re.search(r"\bdia[-_. ]*0?2\b", raw) or "segundo-dia" in raw or "segundo dia" in raw:
        return 2
    text = core.norm(document.first_text[:1600])
    if re.search(r"\bprimeiro dia\b|\b1\s*(?:o)?\s*dia\b", text):
        return 1
    if re.search(r"\bsegundo dia\b|\b2\s*(?:o)?\s*dia\b", text):
        return 2
    return None


def document_language(document) -> str | None:
    raw = base.deaccent(document.leaf).lower()
    if "ingles" in raw:
        return "english"
    if "espanhol" in raw:
        return "spanish"
    if "frances" in raw:
        return "french"
    return None


def is_combined(document) -> bool:
    leaf = base.deaccent(document.leaf).lower()
    return "prova" in leaf and "gabarito" in leaf


def is_key(document) -> bool:
    leaf = base.deaccent(document.leaf).lower()
    return "gabarito" in leaf and not is_combined(document)


def expected_from_text(pages: list[str], fallback_numbers: set[int]) -> int:
    head = base.deaccent("\n".join(pages[:2])).upper()
    values = [int(value) for value in EXPECTED_RE.findall(head) if 1 <= int(value) <= 150]
    if values:
        return max(values)
    numbers = sorted(number for number in fallback_numbers if 1 <= number <= 150)
    if numbers:
        maximum = max(numbers)
        if maximum <= 100 and len(numbers) / maximum >= 0.70:
            return maximum
    return 0


def parse_inline_text(pages: list[str]) -> tuple[dict[int, Candidate], int]:
    output: list[Candidate] = []
    current = None

    def finish():
        nonlocal current
        if not current:
            return
        output.append(Candidate(
            number=current["number"],
            statement=compact(" ".join(current["statement"])),
            alternatives={key: compact(" ".join(value)) for key, value in current["alternatives"].items()},
            correct=current["correct"],
            page=current["page"],
        ))
        current = None

    for page_no, page in enumerate(pages, 1):
        for raw in page.splitlines():
            line = compact(raw)
            if not line:
                continue
            deaccented = base.deaccent(line).upper()
            question = QUESTION_RE.match(deaccented)
            if question:
                number = int(question.group(1))
                if 1 <= number <= 150:
                    finish()
                    current = {
                        "number": number,
                        "statement": [],
                        "alternatives": {},
                        "active": None,
                        "correct": None,
                        "page": page_no,
                    }
                    continue
            if current is None:
                continue
            correct = CORRECT_RE.match(deaccented)
            if correct:
                current["correct"] = correct.group(1).upper()
                continue
            if FOOTER_RE.match(deaccented):
                continue
            alternative = ALTERNATIVE_RE.match(line)
            if alternative:
                letter = (alternative.group(1) or alternative.group(2)).upper()
                current["alternatives"].setdefault(letter, []).append(alternative.group(3))
                current["active"] = letter
            elif current["active"]:
                current["alternatives"].setdefault(current["active"], []).append(line)
            else:
                current["statement"].append(line)
    finish()

    chosen: dict[int, Candidate] = {}
    for candidate in output:
        previous = chosen.get(candidate.number)
        if previous is None or candidate.score > previous.score:
            chosen[candidate.number] = candidate
    expected = expected_from_text(pages, set(chosen))
    return chosen, expected


def parse_inline_document(document) -> tuple[dict[int, Candidate], int]:
    best_map: dict[int, Candidate] = {}
    best_expected = 0
    best_score = (-1, -1, -1)
    for layout in (False, True):
        try:
            pages = [probe.utf8_safe(page) for page in base.pdf_pages(document, layout=layout)]
        except Exception:
            continue
        candidates, expected = parse_inline_text(pages)
        paired = sum(
            candidate.complete and candidate.correct in candidate.alternatives
            for candidate in candidates.values()
        )
        score = (paired, sum(candidate.complete for candidate in candidates.values()), len(candidates))
        if score > best_score:
            best_map, best_expected, best_score = candidates, expected, score
    return best_map, best_expected


def key_identity_numbers(document) -> set[int]:
    best: set[int] = set()
    for layout in (True, False):
        try:
            text = "\n".join(base.pdf_pages(document, layout=layout))
        except Exception:
            continue
        numbers: set[int] = set()
        for raw in text.splitlines():
            line = base.deaccent(compact(raw)).upper()
            for number, _token in probe.KEY_PAIR.findall(line):
                value = int(number)
                if 1 <= value <= 150:
                    numbers.add(value)
        if len(numbers) > len(best):
            best = numbers
    return best


def key_status(document) -> str:
    value = core.norm(f"{document.leaf} {document.first_text}")
    if any(marker in value for marker in ("pos recursos", "definitiv", "final", "oficial")):
        return "definitive"
    if "preliminar" in value:
        return "preliminary"
    return "unknown"


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


def choose_combined(items: list[dict]) -> dict | None:
    language_score = {"english": 3, "spanish": 2, "french": 1, None: 0}
    return max(
        items,
        default=None,
        key=lambda item: (
            item["pairedCount"],
            item["completeCount"],
            item["expected"],
            language_score.get(item["language"], 0),
            item["document"].page_count,
        ),
    )


def choose_key(items: list[dict]) -> dict | None:
    status_score = {"definitive": 2, "preliminary": 1, "unknown": 0}
    return max(items, default=None, key=lambda item: (len(item["identities"]), status_score[item["status"]]))


def build_unit(year: int, day_no: int, bucket: dict) -> dict:
    combined = choose_combined(bucket.get("combined", []))
    key = choose_key(bucket.get("keys", []))
    qmap = combined["questions"] if combined else {}
    expected = combined["expected"] if combined else 0
    if expected <= 0 and key:
        identities = sorted(key["identities"])
        if identities:
            maximum = max(identities)
            expected = maximum if maximum <= 100 and len(identities) / maximum >= 0.70 else len(identities)
    if expected <= 0:
        expected = max(qmap, default=0)

    questions = []
    missing = []
    incompatible = []
    missing_answers = []
    visual_dependencies = 0
    for number in range(1, expected + 1):
        candidate = qmap.get(number)
        if candidate is None or not candidate.complete:
            missing.append(number)
            continue
        if candidate.correct is None:
            missing_answers.append(number)
            continue
        if candidate.correct not in candidate.alternatives:
            incompatible.append(number)
            continue
        visual = bool(VISUAL_RE.search(candidate.statement + " " + " ".join(candidate.alternatives.values())))
        visual_dependencies += int(visual)
        questions.append({
            "number": number,
            "subject": "Conhecimentos gerais",
            "statement": candidate.statement,
            "alternatives": [
                {"id": letter, "text": candidate.alternatives[letter]}
                for letter in ("A", "B", "C", "D", "E")
            ],
            "correctAlternative": candidate.correct,
            "annulled": False,
            "page": candidate.page,
            "flags": ["likely-visual-dependency"] if visual else [],
        })

    issues = []
    if combined is None:
        issues.append("exam-document-not-found")
    if combined is None and key is not None:
        issues.append(f"answer-key-only:{key['status']}")
    if missing:
        issues.append("missing-questions:" + ",".join(map(str, missing)))
    if missing_answers:
        issues.append("missing-inline-answers:" + ",".join(map(str, missing_answers)))
    if incompatible:
        issues.append("answer-not-in-alternatives:" + ",".join(map(str, incompatible)))

    alternate_variants = []
    if combined:
        for item in bucket.get("combined", []):
            if item is combined:
                continue
            alternate_variants.append({
                "reason": "alternate-language-booklet",
                "language": item["language"],
                "document": descriptor(item["document"], item),
            })

    extracted = len(questions)
    return {
        "id": f"day-{day_no}",
        "label": f"{day_no}º dia",
        "year": year,
        "expectedQuestions": expected,
        "extractedQuestions": extracted,
        "missingIdentities": max(0, expected - extracted),
        "structurallyComplete": expected > 0 and extracted == expected,
        "answerKeyStatus": "embedded-corrected" if combined else (key["status"] if key else "missing"),
        "canonicalLanguage": combined["language"] if combined else None,
        "visualDependencies": visual_dependencies,
        "examDocument": descriptor(combined["document"], combined) if combined else None,
        "answerKeyDocument": descriptor(combined["document"], combined) if combined else (descriptor(key["document"], key) if key else None),
        "alternateVariants": alternate_variants,
        "issues": issues,
        "questions": questions,
    }


def process(paths: list[Path]) -> tuple[list[dict], dict]:
    groups: dict[tuple[int, int], dict] = {}
    failures = []
    seen_packages: dict[str, str] = {}
    duplicate_sources = []

    def bucket(year: int, day_no: int):
        return groups.setdefault((year, day_no), {"combined": [], "keys": []})

    for path in paths:
        meta = probe.sidecar(path)
        fingerprint = upe.package_sha(path, meta)
        if fingerprint in seen_packages:
            duplicate_sources.append({
                "archive": path.name,
                "packageSha256": fingerprint,
                "duplicateOf": seen_packages[fingerprint],
            })
            continue
        seen_packages[fingerprint] = path.name
        year = package_year(meta, path)
        if year is None:
            failures.append({"archive": path.name, "exceptionType": "YearMissing", "error": "could not determine UNEB edition year"})
            continue
        try:
            documents = probe.mirror.load_documents(path)
            if documents is None:
                failures.append({"archive": path.name, "exceptionType": "ExtractorUnavailable", "error": "compressed-extractor-unavailable"})
                continue
            base.hydrate_pdf_metadata(documents)
            for document in documents:
                day_no = document_day(document)
                if day_no not in (1, 2):
                    continue
                record = {
                    "archive": path.name,
                    "packageSha256": fingerprint,
                    "downloadId": meta.get("downloadId"),
                    "title": meta.get("title"),
                    "downloadUrl": meta.get("downloadUrl"),
                    "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
                    "document": document,
                }
                if is_combined(document):
                    questions, expected = parse_inline_document(document)
                    record.update({
                        "questions": questions,
                        "expected": expected,
                        "language": document_language(document),
                        "completeCount": sum(candidate.complete for candidate in questions.values()),
                        "pairedCount": sum(
                            candidate.complete and candidate.correct in candidate.alternatives
                            for candidate in questions.values()
                        ),
                    })
                    bucket(year, day_no)["combined"].append(record)
                elif is_key(document):
                    record.update({
                        "identities": key_identity_numbers(document),
                        "status": key_status(document),
                    })
                    bucket(year, day_no)["keys"].append(record)
        except Exception as error:
            failures.append({
                "archive": path.name,
                "exceptionType": type(error).__name__,
                "error": probe.utf8_safe(str(error)),
            })

    years = sorted({year for year, _day in groups})
    editions = []
    for year in years:
        units = [build_unit(year, day_no, groups.get((year, day_no), {})) for day_no in (1, 2)]
        expected = sum(unit["expectedQuestions"] for unit in units)
        extracted = sum(unit["extractedQuestions"] for unit in units)
        editions.append({
            "providerId": PROVIDER_ID,
            "institution": "UNEB",
            "modality": "Vestibular regular",
            "editionId": f"uneb-{year}",
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
        "institution": "UNEB",
        "modality": "Vestibular regular",
        "archivesScanned": len(paths),
        "uniquePackages": len(seen_packages),
        "duplicateSources": duplicate_sources,
        "editions": len(editions),
        "expectedQuestions": sum(item["summary"]["expectedQuestions"] for item in editions),
        "extractedQuestions": sum(item["summary"]["extractedQuestions"] for item in editions),
        "completeUnits": sum(item["summary"]["completeUnits"] for item in editions),
        "missingIdentities": sum(item["summary"]["missingIdentities"] for item in editions),
        "visualDependencies": sum(item["summary"]["visualDependencies"] for item in editions),
        "cycles": [
            {
                "editionId": item["editionId"],
                "year": item["year"],
                **item["summary"],
                "unitCoverage": [
                    f"{unit['extractedQuestions']}/{unit['expectedQuestions']}"
                    for unit in item["units"]
                ],
            }
            for item in editions
        ],
        "failures": failures,
    }
    return editions, summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely ingest UNEB regular vestibular objective exams from mirrored packages.")
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--output", default=".ingestion-cache/brasil-escola/nordeste/uneb-extracted")
    args = parser.parse_args()

    paths = inputs(args.input)
    editions, summary = process(paths)
    output = Path(args.output)
    for edition in editions:
        target = output / "uneb" / str(edition["year"]) / "bundle.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(upe.json_text(edition), encoding="utf-8")
    output.mkdir(parents=True, exist_ok=True)
    (output / "uneb-summary.json").write_text(upe.json_text(summary), encoding="utf-8")
    print(json.dumps(probe.utf8_safe(summary), ensure_ascii=False, indent=2))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
