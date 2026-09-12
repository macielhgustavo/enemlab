#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROBE_SCRIPT = SCRIPT_DIR / "probe-cederj-safe.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


probe = load_module("ingest_cederj_probe", PROBE_SCRIPT)
mirror = probe.mirror
core = probe.core
base = core.base

PARSER_VERSION = "inbox-cederj@0.1.0"
PROVIDER_ID = "brasil-escola"
RIGHTS_STATUS = "third-party-mirror-reference"
CEDERJ_SLUG = "centro-ciencias-educacao-superior-distancia-estado-"
SUPPORTED = probe.SUPPORTED
LETTERS = ("A", "B", "C", "D")
VISUAL_RE = re.compile(r"\b(figura|imagem|gr[aá]fico|mapa|charge|fotografia|foto|diagrama|esquema|tabela|ilustra[cç][aã]o|quadro)\b", re.I)
QUESTION_START_RE = re.compile(r"^\s*0?(\d{1,3})\s*[.)]?\s+(\S.*)$")
ALTERNATIVE_RE = re.compile(r"^\s*(?:\(([A-Da-d])\)|([A-Da-d])\s*[).:-])\s*(.*)$")
ANSWER_PAIR_RE = re.compile(r"(?<!\d)0?(\d{1,3})\s*(?:[-–—.:=)]\s*)?([A-DX])(?![A-Z])", re.I)
NUMBER_RE = re.compile(r"(?<!\d)0?(\d{1,3})(?!\d)")
TERM_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})\s*[/.-]\s*([12])(?!\d)")
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")


@dataclass
class Candidate:
    number: int
    statement: str
    alternatives: dict[str, str]
    page: int
    language: str | None = None

    @property
    def complete(self) -> bool:
        return bool(self.statement) and set(self.alternatives) == set(LETTERS)

    @property
    def score(self):
        return (len(self.alternatives), len(self.statement) + sum(len(value) for value in self.alternatives.values()))


def compact(value: str) -> str:
    return base.compact_space(probe.utf8_safe(value))


def norm(value: str) -> str:
    return compact(re.sub(r"[^a-z0-9]+", " ", base.deaccent(compact(value)))).lower()


def package_sha(path: Path, meta: dict) -> str:
    value = meta.get("sha256")
    if isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value):
        return value.lower()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs(values: list[str]) -> list[Path]:
    output: list[Path] = []
    defaults = [f".ingestion-inbox/brasil-escola/sudeste/{CEDERJ_SLUG}"]
    for raw in values or defaults:
        path = Path(raw)
        if path.is_dir():
            output.extend(sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in SUPPORTED))
        elif path.is_file() and path.suffix.lower() in SUPPORTED:
            output.append(path)
        elif not path.exists():
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(output))


def role(document) -> str:
    return probe.classify_role(document.leaf, document.first_text)


def language_marker(line: str) -> str | None:
    value = norm(line)
    has_english = "lingua inglesa" in value or bool(re.search(r"\bingles\b", value))
    has_spanish = "lingua espanhola" in value or bool(re.search(r"\bespanhol\b", value))
    if has_english and not has_spanish:
        return "english"
    if has_spanish and not has_english:
        return "spanish"
    return None


def edition_from_text(value: str) -> tuple[int, int] | None:
    match = TERM_RE.search(value)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None


def effective_edition(meta: dict, path: Path, documents) -> tuple[int | None, int | None]:
    strong = []
    for document in documents:
        for value in (document.leaf, document.first_text[:2600]):
            found = edition_from_text(value)
            if found:
                strong.append(found)
    if strong:
        counts = defaultdict(int)
        for item in strong:
            counts[item] += 1
        return max(counts, key=lambda item: (counts[item], item[0], item[1]))
    title = str(meta.get("title") or path.stem)
    found = edition_from_text(title)
    if found:
        return found
    match = YEAR_RE.search(title)
    if match:
        return int(match.group(1)), 1
    try:
        year = int(meta.get("year"))
        return year, 1
    except (TypeError, ValueError):
        return None, None


def parse_question_pages(pages: list[str]) -> list[Candidate]:
    current = None
    current_language = None
    reset_language = False
    expected = 1
    candidates: list[Candidate] = []

    def finish():
        nonlocal current
        if not current:
            return
        candidate = Candidate(
            number=current["number"],
            statement=compact(" ".join(current["statement"])),
            alternatives={key: compact(" ".join(parts)) for key, parts in current["alternatives"].items()},
            page=current["page"],
            language=current["language"],
        )
        candidates.append(candidate)
        current = None

    for page_no, page in enumerate(pages, 1):
        for raw in page.splitlines():
            line = compact(raw)
            if not line:
                continue
            normalized = norm(line)

            # Instruction lists at the start are also numbered. A real subject/exam
            # heading resets the sequence, so only the objective body survives.
            if "questoes de multipla escolha" in normalized or (
                "lingua portuguesa" in normalized and expected > 1 and expected <= 20
            ):
                finish()
                expected = 1
                current_language = None
                reset_language = False
                continue

            marker = language_marker(line)
            if marker:
                if current and current["number"] >= 40:
                    finish()
                current_language = marker
                reset_language = True
                continue

            match = QUESTION_START_RE.match(line)
            if match:
                number = int(match.group(1))
                stem = match.group(2)
                can_start = 1 <= number <= 150 and (
                    number == expected
                    or (reset_language and 40 <= number <= 60)
                )
                if can_start:
                    finish()
                    current = {
                        "number": number,
                        "statement": [stem],
                        "alternatives": {},
                        "active": None,
                        "page": page_no,
                        "language": current_language if number >= 40 else None,
                    }
                    expected = number + 1
                    reset_language = False
                    continue

            if current is None:
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
    return [item for item in candidates if item.complete]


def parse_question_candidates(document) -> list[Candidate]:
    all_candidates: list[Candidate] = []
    for layout in (False, True):
        try:
            pages = [probe.utf8_safe(page) for page in base.pdf_pages(document, layout=layout)]
        except Exception:
            continue
        candidates = parse_question_pages(pages)
        all_candidates.extend(candidates)
        if len(candidates) >= 42:
            break
    return all_candidates


def select_questions(candidates: list[Candidate]) -> dict[int, Candidate]:
    grouped: dict[int, list[Candidate]] = defaultdict(list)
    for candidate in candidates:
        grouped[candidate.number].append(candidate)
    output = {}
    preference = {"english": 3, None: 2, "spanish": 1}
    for number, items in grouped.items():
        output[number] = max(items, key=lambda item: (preference.get(item.language, 0), item.score))
    return output


def key_status(document) -> str:
    value = norm(f"{document.leaf} {document.first_text}")
    if any(marker in value for marker in ("definitivo", "definitiva", "final", "oficial")):
        return "definitive"
    if "preliminar" in value:
        return "preliminary"
    return "unknown"


def foreign_start(expected_max: int) -> int:
    return 57 if expected_max >= 60 else 43


def parse_key_text(text: str, *, preferred_language: str = "english") -> dict:
    lines = [compact(line) for line in probe.utf8_safe(text).splitlines() if compact(line)]
    seen_numbers = {
        int(value)
        for line in lines
        for value in NUMBER_RE.findall(line)
        if 1 <= int(value) <= 150
    }
    expected_max = max(seen_numbers, default=0)
    fstart = foreign_start(expected_max)
    common_values: dict[int, set[str | None]] = defaultdict(set)
    variants: dict[str, dict[int, str | None]] = {"english": {}, "spanish": {}}
    active_language = None

    for line in lines:
        marker = language_marker(line)
        if marker:
            active_language = marker
        for number_text, token in ANSWER_PAIR_RE.findall(line.upper()):
            number = int(number_text)
            if not 1 <= number <= 150:
                continue
            answer = None if token.upper() == "X" else token.upper()
            if number >= fstart and active_language in variants:
                variants[active_language][number] = answer
            else:
                common_values[number].add(answer)

    common: dict[int, str | None] = {}
    conflicts = []
    for number, values in common_values.items():
        if len(values) == 1:
            common[number] = next(iter(values))
        elif len(values) > 1:
            conflicts.append(number)

    answers = dict(common)
    selected_variant = variants.get(preferred_language) or {}
    alternate_variant = variants.get("spanish") or {}
    if selected_variant:
        answers.update(selected_variant)
    elif alternate_variant:
        answers.update(alternate_variant)

    return {
        "answers": answers,
        "expectedMax": expected_max,
        "foreignStart": fstart,
        "variants": variants,
        "conflicts": sorted(conflicts),
        "score": (expected_max, len(answers), int(bool(selected_variant)), len(common)),
    }


def parse_key_document(document, *, preferred_language: str = "english") -> dict:
    best = None
    for layout in (True, False):
        try:
            text = "\n".join(base.pdf_pages(document, layout=layout))
        except Exception:
            continue
        payload = parse_key_text(text, preferred_language=preferred_language)
        payload["status"] = key_status(document)
        if best is None or payload["score"] > best["score"]:
            best = payload
    return best or {
        "answers": {},
        "expectedMax": 0,
        "foreignStart": 43,
        "variants": {"english": {}, "spanish": {}},
        "conflicts": [],
        "status": "unknown",
        "score": (0, 0, 0, 0),
    }


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
        key=lambda item: (
            item["key"]["expectedMax"],
            len(item["key"]["answers"]),
            status_score[item["key"]["status"]],
        ),
    )


def process(paths: list[Path]) -> tuple[list[dict], dict]:
    editions = []
    failures = []
    seen_packages = {}
    for path in paths:
        meta = probe.sidecar(path)
        fingerprint = package_sha(path, meta)
        if fingerprint in seen_packages:
            continue
        seen_packages[fingerprint] = path.name
        try:
            documents = mirror.load_documents(path)
            if documents is None:
                failures.append({"archive": path.name, "exceptionType": "ExtractorUnavailable", "error": "compressed-extractor-unavailable"})
                continue
            base.hydrate_pdf_metadata(documents)
            year, term = effective_edition(meta, path, documents)
            if year is None:
                failures.append({"archive": path.name, "exceptionType": "EditionMissing", "error": "could not determine edition"})
                continue
            exam_items = []
            key_items = []
            excluded_documents = []
            for document in documents:
                doc_role = role(document)
                record = {
                    "archive": path.name,
                    "packageSha256": fingerprint,
                    "downloadId": meta.get("downloadId"),
                    "title": meta.get("title"),
                    "downloadUrl": meta.get("downloadUrl"),
                    "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
                    "document": document,
                }
                if doc_role == "exam":
                    candidates = parse_question_candidates(document)
                    record["questions"] = select_questions(candidates)
                    record["candidateCount"] = len(candidates)
                    exam_items.append(record)
                elif doc_role == "answer-key":
                    record["key"] = parse_key_document(document)
                    key_items.append(record)
                else:
                    excluded_documents.append({
                        "member": document.member,
                        "sha256": document.sha256,
                        "role": doc_role,
                    })

            exam = choose_exam(exam_items)
            key = choose_key(key_items)
            qmap = exam["questions"] if exam else {}
            key_payload = key["key"] if key else {
                "answers": {},
                "expectedMax": 0,
                "foreignStart": 43,
                "variants": {},
                "conflicts": [],
                "status": "missing",
            }
            amap = key_payload["answers"]
            expected = key_payload["expectedMax"]
            identities = list(range(1, expected + 1)) if expected else sorted(amap)

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
                questions.append({
                    "number": number,
                    "subject": "Conhecimentos gerais",
                    "language": candidate.language,
                    "statement": candidate.statement,
                    "alternatives": [{"id": letter, "text": candidate.alternatives[letter]} for letter in LETTERS],
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
            if key_payload.get("conflicts"):
                issues.append("ambiguous-common-answer:" + ",".join(map(str, key_payload["conflicts"])))
            if missing_questions:
                issues.append("missing-questions:" + ",".join(map(str, missing_questions)))
            if missing_answers:
                issues.append("missing-answers:" + ",".join(map(str, missing_answers)))
            if incompatible_answers:
                issues.append("answer-not-in-alternatives:" + ",".join(map(str, incompatible_answers)))
            if key and key_payload["status"] != "definitive":
                issues.append(f"answer-key-status:{key_payload['status']}")

            edition_id = f"cederj-{year}-{term}" if term else f"cederj-{year}"
            unit = {
                "id": "objective",
                "label": "Prova objetiva",
                "expectedQuestions": expected,
                "extractedQuestions": len(questions),
                "missingIdentities": max(0, expected - len(questions)),
                "structurallyComplete": expected > 0 and len(questions) == expected,
                "answerKeyStatus": key_payload["status"] if key else "missing",
                "canonicalForeignLanguage": "english",
                "questionsNeedingReview": review,
                "visualDependencies": review,
                "examDocument": descriptor(exam["document"], exam) if exam else None,
                "answerKeyDocument": descriptor(key["document"], key) if key else None,
                "excludedDocuments": excluded_documents,
                "issues": issues,
                "questions": questions,
            }
            editions.append({
                "providerId": PROVIDER_ID,
                "institution": "CEDERJ",
                "modality": "Vestibular regular",
                "editionId": edition_id,
                "year": year,
                "term": term,
                "parserVersion": PARSER_VERSION,
                "rightsStatus": RIGHTS_STATUS,
                "source": {
                    "archive": path.name,
                    "packageSha256": fingerprint,
                    "downloadId": meta.get("downloadId"),
                    "title": meta.get("title"),
                    "downloadUrl": meta.get("downloadUrl"),
                    "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
                },
                "units": [unit],
                "summary": {
                    "expectedQuestions": expected,
                    "extractedQuestions": len(questions),
                    "completeUnits": int(unit["structurallyComplete"]),
                    "missingIdentities": max(0, expected - len(questions)),
                    "visualDependencies": review,
                },
            })
        except Exception as error:
            failures.append({
                "archive": path.name,
                "exceptionType": type(error).__name__,
                "error": probe.utf8_safe(str(error)),
            })

    editions.sort(key=lambda item: (item["year"], item.get("term") or 0))
    summary = {
        "version": 1,
        "parserVersion": PARSER_VERSION,
        "providerId": PROVIDER_ID,
        "institution": "CEDERJ",
        "modality": "Vestibular regular",
        "archivesScanned": len(paths),
        "uniquePackages": len(seen_packages),
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
                "term": item.get("term"),
                **item["summary"],
                "unitCoverage": [f"{unit['extractedQuestions']}/{unit['expectedQuestions']}" for unit in item["units"]],
            }
            for item in editions
        ],
        "failures": failures,
    }
    return editions, summary


def json_text(value) -> str:
    text = json.dumps(probe.utf8_safe(value), ensure_ascii=False, indent=2) + "\n"
    text.encode("utf-8")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely ingest deterministic CEDERJ objective exams from mirrored packages.")
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--output", default=".ingestion-cache/brasil-escola/sudeste/cederj-extracted")
    args = parser.parse_args()

    paths = inputs(args.input)
    editions, summary = process(paths)
    output = Path(args.output)
    for edition in editions:
        target = output / "cederj" / edition["editionId"].removeprefix("cederj-") / "bundle.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json_text(edition), encoding="utf-8")
    output.mkdir(parents=True, exist_ok=True)
    (output / "cederj-summary.json").write_text(json_text(summary), encoding="utf-8")
    print(json.dumps(probe.utf8_safe(summary), ensure_ascii=False, indent=2))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
