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
MIRROR_SCRIPT = SCRIPT_DIR / "ingest-uece-mirror.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


mirror = load_module("ingest_urca_mirror_loader", MIRROR_SCRIPT)
core = mirror.core
base = core.base

PARSER_VERSION = "inbox-urca@0.1.0"
PROVIDER_ID = "brasil-escola"
RIGHTS_STATUS = "third-party-mirror-reference"
URCA_SLUG = "universidade-regional-cariri"
LETTERS = ("A", "B", "C", "D", "E")
Q_RE = re.compile(r"^\s*0?(\d{1,3})\s*[.)-]\s*(.*)$")
A_RE = re.compile(r"^\s*(?:\(([A-Ea-e])\)|([A-Ea-e])\s*[.)-])\s*(.*)$")
TERM_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})\s*[/.-]\s*([12])(?!\d)")
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
VISUAL_RE = re.compile(r"\b(figura|imagem|gr[aá]fico|mapa|charge|fotografia|foto|diagrama|esquema|tabela|ilustra[cç][aã]o)\b", re.I)


@dataclass
class Candidate:
    number: int
    statement: str
    alternatives: dict[str, str]
    page: int
    context: str = ""

    @property
    def complete(self) -> bool:
        keys = set(self.alternatives)
        return bool(self.statement) and keys in ({"A", "B", "C", "D"}, {"A", "B", "C", "D", "E"})

    @property
    def score(self):
        return (len(self.alternatives), len(self.statement) + sum(len(v) for v in self.alternatives.values()))


def compact(value: str) -> str:
    return base.compact_space(value)


def norm(value: str) -> str:
    return compact(re.sub(r"[^a-z0-9]+", " ", base.deaccent(compact(value))))


def sidecar(path: Path) -> dict:
    meta = path.with_suffix(path.suffix + ".meta.json")
    try:
        return json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else {}
    except Exception:
        return {}


def inputs(values: list[str]) -> list[Path]:
    output = []
    for raw in values or [f".ingestion-inbox/brasil-escola/nordeste/{URCA_SLUG}"]:
        path = Path(raw)
        if path.is_dir():
            output.extend(sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in mirror.SUPPORTED))
        elif path.is_file() and path.suffix.lower() in mirror.SUPPORTED:
            output.append(path)
        elif not path.exists():
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(output))


def cycle(meta: dict, path: Path) -> tuple[int | None, int]:
    title = str(meta.get("title") or path.stem)
    match = TERM_RE.search(title)
    if match:
        return int(match.group(1)), int(match.group(2))
    try:
        year = int(meta.get("year"))
    except (TypeError, ValueError):
        match = YEAR_RE.search(title)
        year = int(match.group(1)) if match else None
    return year, 1


def day(document) -> int | None:
    value = norm(f"{document.leaf} {document.first_text[:1600]}")
    patterns = (
        (1, (r"\b1\s*(?:o|a)?\s*dia\b", r"\bprimeiro\s+dia\b", r"\bprova\s+i\b")),
        (2, (r"\b2\s*(?:o|a)?\s*dia\b", r"\bsegundo\s+dia\b", r"\bprova\s+ii\b")),
    )
    for number, variants in patterns:
        if any(re.search(pattern, value) for pattern in variants):
            return number
    return None


def language(document) -> str | None:
    value = norm(document.leaf)
    if re.search(r"\bing(?:les|lesa)?\b", value):
        return "english"
    if re.search(r"\besp(?:anhol|anhola)?\b", value):
        return "spanish"
    return None


def is_key(document) -> bool:
    value = norm(f"{document.leaf} {document.first_text}")
    return "gabarito" in value and document.page_count <= 6


def is_exam(document) -> bool:
    if is_key(document) or document.page_count < 8:
        return False
    value = norm(f"{document.leaf} {document.first_text}")
    return any(marker in value for marker in ("prova", "caderno de prova", "processo seletivo", "vestibular", "psu"))


def parse_questions(document) -> dict[int, Candidate]:
    candidates = []
    for layout in (False, True):
        try:
            pages = base.pdf_pages(document, layout=layout)
        except Exception:
            continue
        current = None
        output = []

        def finish():
            nonlocal current
            if not current:
                return
            candidate = Candidate(
                number=current["number"],
                statement=compact(" ".join(current["statement"])),
                alternatives={key: compact(" ".join(value)) for key, value in current["alternatives"].items()},
                page=current["page"],
            )
            output.append(candidate)
            current = None

        for page_no, page in enumerate(pages, 1):
            for raw in page.splitlines():
                line = compact(raw)
                if not line:
                    continue
                question = Q_RE.match(line)
                if question:
                    number = int(question.group(1))
                    if 1 <= number <= 150:
                        finish()
                        current = {
                            "number": number,
                            "statement": [question.group(2)] if question.group(2) else [],
                            "alternatives": {},
                            "active": None,
                            "page": page_no,
                        }
                        continue
                if current is None:
                    continue
                alternative = A_RE.match(line)
                if alternative:
                    letter = (alternative.group(1) or alternative.group(2)).upper()
                    current["alternatives"].setdefault(letter, []).append(alternative.group(3))
                    current["active"] = letter
                elif current["active"]:
                    current["alternatives"].setdefault(current["active"], []).append(line)
                else:
                    current["statement"].append(line)
        finish()
        candidates.extend(output)
        if sum(item.complete for item in output) >= 55:
            break

    chosen: dict[int, Candidate] = {}
    for candidate in candidates:
        if not candidate.complete:
            continue
        previous = chosen.get(candidate.number)
        if previous is None or candidate.score > previous.score:
            chosen[candidate.number] = candidate
    return chosen


def key_status(document) -> str:
    value = norm(f"{document.leaf} {document.first_text}")
    if "final" in value or "definitiv" in value or "oficial" in value:
        return "definitive"
    if "preliminar" in value or "provisor" in value:
        return "preliminary"
    return "unknown"


def parse_key(document) -> dict[int, str | None]:
    best: dict[int, str | None] = {}
    for layout in (True, False):
        try:
            text = "\n".join(base.pdf_pages(document, layout=layout))
        except Exception:
            continue
        answers: dict[int, str | None] = {}
        lines = [compact(line) for line in text.splitlines() if compact(line)]
        for line in lines:
            for number, token in re.findall(r"(?<!\d)(\d{1,3})\s*[-.:=)]?\s*([A-EX])(?![A-Z])", line.upper()):
                value = int(number)
                if 1 <= value <= 150:
                    answers[value] = None if token == "X" else token
        for index, line in enumerate(lines):
            numbers = [int(value) for value in re.findall(r"(?<!\d)(\d{1,3})(?!\d)", line) if 1 <= int(value) <= 150]
            if len(numbers) < 4:
                continue
            tokens = []
            for following in lines[index + 1 : index + 4]:
                if len([int(value) for value in re.findall(r"(?<!\d)(\d{1,3})(?!\d)", following) if 1 <= int(value) <= 150]) >= 4 and not tokens:
                    break
                tokens.extend(re.findall(r"(?<![A-Z])([A-EX])(?![A-Z])", following.upper()))
                if len(tokens) >= len(numbers):
                    break
            if len(tokens) >= len(numbers):
                for number, token in zip(numbers, tokens):
                    answers[number] = None if token == "X" else token
        if len(answers) > len(best):
            best = answers
    return best


def normalize_day_questions(question_map: dict[int, Candidate]) -> dict[int, Candidate]:
    if not question_map:
        return {}
    numbers = sorted(question_map)
    if min(numbers) >= 61:
        return {number - 60: candidate for number, candidate in question_map.items() if 61 <= number <= 120}
    return {number: candidate for number, candidate in question_map.items() if 1 <= number <= 60}


def normalize_day_answers(answer_map: dict[int, str | None], day_no: int) -> dict[int, str | None]:
    if not answer_map:
        return {}
    if day_no == 2 and any(number >= 61 for number in answer_map):
        return {number - 60: value for number, value in answer_map.items() if 61 <= number <= 120}
    return {number: value for number, value in answer_map.items() if 1 <= number <= 60}


def choose_exam(documents, day_no: int):
    scored = []
    for document in documents:
        if not is_exam(document) or day(document) not in (day_no, None):
            continue
        lang = language(document)
        if day_no == 2 and lang == "spanish":
            language_score = 0
        elif day_no == 2 and lang == "english":
            language_score = 2
        else:
            language_score = 1
        questions = normalize_day_questions(parse_questions(document))
        scored.append((len(questions), language_score, document.page_count, document, questions))
    return max(scored, default=None, key=lambda item: item[:3])


def choose_key(documents, day_no: int):
    scored = []
    for document in documents:
        if not is_key(document) or day(document) not in (day_no, None):
            continue
        answers = normalize_day_answers(parse_key(document), day_no)
        status = key_status(document)
        status_score = {"definitive": 2, "preliminary": 1, "unknown": 0}[status]
        scored.append((len(answers), status_score, document, answers, status))
    return max(scored, default=None, key=lambda item: item[:2])


def descriptor(document):
    return {
        "archive": document.archive,
        "member": document.member,
        "sha256": document.sha256,
        "bytes": document.size,
        "pages": document.page_count,
    }


def process_package(path: Path) -> dict:
    meta = sidecar(path)
    year, term = cycle(meta, path)
    documents = mirror.load_documents(path)
    if documents is None:
        return {"archive": path.name, "status": "staged", "reason": "compressed-extractor-unavailable", "units": []}
    base.hydrate_pdf_metadata(documents)
    units = []
    for day_no in (1, 2):
        exam = choose_exam(documents, day_no)
        key = choose_key(documents, day_no)
        qmap = exam[4] if exam else {}
        amap = key[3] if key else {}
        questions = []
        review = 0
        missing_questions = []
        missing_answers = []
        for number in range(1, 61):
            candidate = qmap.get(number)
            if candidate is None:
                missing_questions.append(number)
                continue
            if number not in amap:
                missing_answers.append(number)
                continue
            visual = bool(VISUAL_RE.search(candidate.statement))
            review += int(visual)
            correct = amap[number]
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
        if len(qmap) != 60:
            issues.append(f"question-coverage:{len(qmap)}/60")
        if len(amap) != 60:
            issues.append(f"answer-key-coverage:{len(amap)}/60")
        if missing_questions:
            issues.append("missing-questions:" + ",".join(map(str, missing_questions)))
        if missing_answers:
            issues.append("missing-answers:" + ",".join(map(str, missing_answers)))
        if key and key[4] != "definitive":
            issues.append(f"answer-key-status:{key[4]}")
        units.append({
            "id": f"day-{day_no}",
            "label": f"{day_no}º dia",
            "expectedQuestions": 60,
            "extractedQuestions": len(questions),
            "structurallyComplete": len(questions) == 60 and len(qmap) == 60 and len(amap) == 60,
            "answerKeyStatus": key[4] if key else "missing",
            "questionsNeedingReview": review,
            "examDocument": descriptor(exam[3]) if exam else None,
            "answerKeyDocument": descriptor(key[2]) if key else None,
            "issues": issues,
            "questions": questions,
        })
    return {
        "providerId": PROVIDER_ID,
        "institution": "URCA",
        "editionId": f"urca-{year}.{term}" if year else f"urca-{path.stem}",
        "year": year,
        "term": term,
        "parserVersion": PARSER_VERSION,
        "rightsStatus": RIGHTS_STATUS,
        "source": {
            "archive": path.name,
            "downloadId": meta.get("downloadId"),
            "title": meta.get("title"),
            "downloadUrl": meta.get("downloadUrl"),
            "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
        },
        "units": units,
        "summary": {
            "expectedQuestions": 120,
            "extractedQuestions": sum(unit["extractedQuestions"] for unit in units),
            "completeUnits": sum(int(unit["structurallyComplete"]) for unit in units),
            "units": 2,
            "questionsNeedingReview": sum(unit["questionsNeedingReview"] for unit in units),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="URCA deterministic two-day extraction fast lane.")
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--output", default=".ingestion-cache/inbox")
    args = parser.parse_args()
    try:
        paths = inputs(args.input)
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
            editions.append(payload)
            destination = output / "urca" / payload["editionId"].removeprefix("urca-")
            destination.mkdir(parents=True, exist_ok=True)
            (destination / "bundle.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except Exception as error:
            failures.append({"archive": path.name, "error": str(error)})
    summary = {
        "version": 1,
        "parserVersion": PARSER_VERSION,
        "providerId": PROVIDER_ID,
        "institution": "URCA",
        "archivesScanned": len(paths),
        "editions": len(editions),
        "expectedQuestions": sum(item["summary"]["expectedQuestions"] for item in editions),
        "extractedQuestions": sum(item["summary"]["extractedQuestions"] for item in editions),
        "completeUnits": sum(item["summary"]["completeUnits"] for item in editions),
        "questionsNeedingReview": sum(item["summary"]["questionsNeedingReview"] for item in editions),
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
    (output / "urca-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
