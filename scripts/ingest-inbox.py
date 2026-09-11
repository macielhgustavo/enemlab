#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import re
import sys
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    from pypdf import PdfReader
except ImportError as exc:
    raise SystemExit("ingest-inbox requires pypdf (python -m pip install 'pypdf>=6,<7')") from exc

VERSION = 1
PARSER_VERSION = "inbox-unioeste@0.1.0"
MAX_NESTING = 3
MAX_ENTRY_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
LETTERS = ("A", "B", "C", "D", "E")

QUESTION_RE = re.compile(r"^0?(\d{1,3})\s*[\.\)]\s*(.*)$")
ALTERNATIVE_RE = re.compile(r"^(?:\(([A-Ea-e])\)|([A-Ea-e])\s*[\.\)])\s*(.*)$")
ANSWER_RE = re.compile(
    r"(?<!\d)(\d{1,2})\s*=\s*(\*\*?[A-E]|\*|[A-E])(?:\s+(anulad[ao]))?",
    re.IGNORECASE,
)

SUBJECTS = (
    ("biologia", "Biologia", ("biologia",)),
    ("filosofia", "Filosofia", ("filosofia",)),
    ("fisica", "Física", ("fisica",)),
    ("geografia", "Geografia", ("geografia",)),
    ("historia", "História", ("historia",)),
    ("literatura", "Literatura", ("literatura",)),
    ("matematica", "Matemática", ("matematica",)),
    ("portugues", "Língua Portuguesa", ("lingua portuguesa", "portugues")),
    ("quimica", "Química", ("quimica",)),
    ("sociologia", "Sociologia", ("sociologia",)),
    ("english", "Língua Estrangeira - Inglês", ("ingles",)),
    ("spanish", "Língua Estrangeira - Espanhol", ("espanhol",)),
    ("german", "Língua Estrangeira - Alemão", ("alemao",)),
    ("italian", "Língua Estrangeira - Italiano", ("italiano",)),
)
LANGUAGE_SUBJECTS = {"english", "spanish", "german", "italian"}
ANSWER_ENTRY_CACHE: dict[str, list["AnswerEntry"]] = {}


def deaccent(value: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFD", value)
        if unicodedata.category(char) != "Mn"
    ).lower()


def compact_space(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class PdfDocument:
    archive: str
    member: str
    leaf: str
    bytes: bytes
    sha256: str
    size: int
    first_text: str = ""
    page_count: int = 0
    role: str | None = None

    @property
    def leaf_norm(self) -> str:
        return deaccent(self.leaf)


@dataclass
class AnswerEntry:
    phase: str | None
    subject: str | None
    subject_label: str | None
    number: int
    answer: str | None
    annulled: bool


@dataclass
class Unit:
    id: str
    label: str
    expected: int
    exam: PdfDocument | None
    key_docs: list[PdfDocument]
    language: str | None
    allowed_subjects: set[str]
    key_phase: str | None
    answer_key_status: str
    issues: list[str] = field(default_factory=list)


def read_zip(data: bytes, archive_name: str, depth: int = 0, prefix: str = "") -> list[PdfDocument]:
    if depth > MAX_NESTING:
        raise ValueError(f"{archive_name}: nested archive depth exceeds {MAX_NESTING}")
    documents: list[PdfDocument] = []
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            if info.file_size > MAX_ENTRY_BYTES:
                raise ValueError(
                    f"{archive_name}: entry {info.filename!r} exceeds {MAX_ENTRY_BYTES} bytes"
                )
            total += info.file_size
            if total > MAX_ARCHIVE_BYTES:
                raise ValueError(f"{archive_name}: expanded archive exceeds {MAX_ARCHIVE_BYTES} bytes")
            raw = archive.read(info)
            logical = f"{prefix}{info.filename}"
            if info.filename.lower().endswith(".zip"):
                documents.extend(
                    read_zip(raw, archive_name, depth + 1, prefix=f"{logical}::")
                )
                continue
            if not info.filename.lower().endswith(".pdf"):
                continue
            leaf = info.filename.rsplit("/", 1)[-1]
            documents.append(
                PdfDocument(
                    archive=archive_name,
                    member=logical,
                    leaf=leaf,
                    bytes=raw,
                    sha256=sha256(raw),
                    size=len(raw),
                )
            )
    return documents


def load_documents(paths: Iterable[Path]) -> list[PdfDocument]:
    by_sha: dict[str, PdfDocument] = {}
    for path in paths:
        data = path.read_bytes()
        docs = read_zip(data, path.name) if path.suffix.lower() == ".zip" else []
        for doc in docs:
            existing = by_sha.get(doc.sha256)
            if existing is None or (doc.member.count("::"), len(doc.member)) < (
                existing.member.count("::"),
                len(existing.member),
            ):
                by_sha[doc.sha256] = doc
    return list(by_sha.values())


def pdf_pages(document: PdfDocument, layout: bool = False) -> list[str]:
    reader = PdfReader(io.BytesIO(document.bytes))
    document.page_count = len(reader.pages)
    kwargs = {"extraction_mode": "layout"} if layout else {}
    return [(page.extract_text(**kwargs) or "") for page in reader.pages]


def hydrate_pdf_metadata(documents: list[PdfDocument]) -> None:
    for document in documents:
        reader = PdfReader(io.BytesIO(document.bytes))
        document.page_count = len(reader.pages)
        first_pages = []
        for page in reader.pages[:2]:
            first_pages.append(page.extract_text() or "")
        document.first_text = "\n".join(first_pages)


def detect_subject(line: str) -> tuple[str, str] | None:
    normalized = deaccent(line)
    if len(line) > 110 and "lingua estrangeira" not in normalized:
        return None
    for subject_id, label, aliases in SUBJECTS:
        if any(re.search(rf"\b{re.escape(alias)}\b", normalized) for alias in aliases):
            return subject_id, label
    return None


def parse_answer_text(text: str) -> list[AnswerEntry]:
    phase: str | None = None
    subject_id: str | None = None
    subject_label: str | None = None
    output: list[AnswerEntry] = []
    for raw_line in text.splitlines():
        line = compact_space(raw_line)
        if not line:
            continue
        normalized = deaccent(line)
        if re.search(r"1[ªa]?\s*etapa|primeir[ao]\s+(?:etapa|dia)", normalized):
            phase = "first"
        elif re.search(r"2[ªa]?\s*etapa|segund[ao]\s+(?:etapa|dia)", normalized):
            phase = "second"
        heading = detect_subject(line)
        if heading:
            subject_id, subject_label = heading
        for match in ANSWER_RE.finditer(line):
            token = match.group(2).upper()
            annulled = token == "*" or bool(match.group(3))
            answer = None if annulled else token.replace("*", "")
            output.append(
                AnswerEntry(
                    phase=phase,
                    subject=subject_id,
                    subject_label=subject_label,
                    number=int(match.group(1)),
                    answer=answer,
                    annulled=annulled,
                )
            )
    return output


def parse_answer_entries(document: PdfDocument) -> list[AnswerEntry]:
    cached = ANSWER_ENTRY_CACHE.get(document.sha256)
    if cached is not None:
        return list(cached)
    text = "\n".join(pdf_pages(document, layout=True))
    output = parse_answer_text(text)
    ANSWER_ENTRY_CACHE[document.sha256] = list(output)
    return output


def is_key(document: PdfDocument) -> bool:
    return "gabar" in document.leaf_norm


def is_amendment(document: PdfDocument) -> bool:
    return "retifica" in document.leaf_norm


def is_supplement(document: PdfDocument) -> bool:
    return "quest" in document.leaf_norm and "prova" not in document.leaf_norm


def text_has(document: PdfDocument, pattern: str) -> bool:
    return bool(re.search(pattern, document.first_text, re.IGNORECASE))


def answer_status(key_docs: list[PdfDocument]) -> str:
    corpus = " ".join([doc.leaf_norm + " " + deaccent(doc.first_text) for doc in key_docs])
    if "definitiv" in corpus:
        return "definitive"
    if "provisor" in corpus:
        return "provisional"
    return "unknown"


def unioeste_units(year: int, documents: list[PdfDocument]) -> list[Unit]:
    key_docs = [doc for doc in documents if is_key(doc)]
    exam_docs = [
        doc
        for doc in documents
        if not is_key(doc)
        and not is_amendment(doc)
        and not is_supplement(doc)
        and re.search(r"caderno de prov|concurso vestibular", doc.first_text, re.IGNORECASE)
    ]
    status = answer_status(key_docs)

    if year <= 2013:
        english = [
            doc
            for doc in exam_docs
            if text_has(doc, r"ingl[eê]s") or text_has(doc, r"grupo\s*3")
        ]
        return [
            Unit(
                id="first",
                label="Conhecimentos gerais",
                expected=71,
                exam=english[0] if english else None,
                key_docs=key_docs,
                language="english",
                allowed_subjects={
                    "biologia",
                    "filosofia",
                    "fisica",
                    "geografia",
                    "historia",
                    "english",
                    "literatura",
                    "matematica",
                    "portugues",
                    "quimica",
                    "sociologia",
                },
                key_phase="first",
                answer_key_status=status,
            )
        ]

    if year <= 2016:
        day1 = [doc for doc in exam_docs if text_has(doc, r"primeiro dia|1.? dia")]
        day2 = [doc for doc in exam_docs if text_has(doc, r"segundo dia|2.? dia")]
        day2_english = [doc for doc in day2 if text_has(doc, r"ingl[eê]s")]
        return [
            Unit(
                id="day1",
                label="Primeiro dia",
                expected=49,
                exam=day1[0] if day1 else None,
                key_docs=key_docs,
                language=None,
                allowed_subjects={
                    "biologia",
                    "filosofia",
                    "fisica",
                    "geografia",
                    "historia",
                    "quimica",
                    "sociologia",
                },
                key_phase="first",
                answer_key_status=status,
            ),
            Unit(
                id="day2",
                label="Segundo dia",
                expected=28,
                exam=(day2_english or day2)[0] if (day2_english or day2) else None,
                key_docs=key_docs,
                language="english",
                allowed_subjects={"english", "literatura", "matematica", "portugues"},
                key_phase="second",
                answer_key_status=status,
            ),
        ]

    morning = [doc for doc in exam_docs if text_has(doc, r"manh[aã]|matutin")]
    afternoon = [doc for doc in exam_docs if text_has(doc, r"tarde|vespertin")]
    morning_english = [doc for doc in morning if text_has(doc, r"ingl[eê]s")]
    morning_spanish = [doc for doc in morning if text_has(doc, r"espanhol")]
    afternoon_named = [doc for doc in afternoon if "tarde" in doc.leaf_norm]
    selected_morning = (morning_english or morning_spanish or morning)
    language = None
    if selected_morning:
        language = "english" if text_has(selected_morning[0], r"ingl[eê]s") else "spanish"

    return [
        Unit(
            id="morning",
            label="Manhã",
            expected=21,
            exam=selected_morning[0] if selected_morning else None,
            key_docs=key_docs,
            language=language,
            allowed_subjects={
                language or "english",
                "portugues",
                "literatura",
            },
            key_phase="first",
            answer_key_status=status,
        ),
        Unit(
            id="afternoon",
            label="Tarde",
            expected=56,
            exam=(afternoon_named or afternoon)[0] if (afternoon_named or afternoon) else None,
            key_docs=key_docs,
            language=None,
            allowed_subjects={
                "biologia",
                "filosofia",
                "fisica",
                "geografia",
                "historia",
                "matematica",
                "quimica",
                "sociologia",
            },
            key_phase="second",
            answer_key_status=status,
        ),
    ]


def choose_key_entries(unit: Unit) -> dict[int, AnswerEntry]:
    entries: list[AnswerEntry] = []
    for document in unit.key_docs:
        entries.extend(parse_answer_entries(document))
    candidates = [
        entry
        for entry in entries
        if entry.subject in unit.allowed_subjects
        and (entry.phase in {None, unit.key_phase})
    ]
    # Old one-day keys are sometimes labelled first; phase is not useful there.
    if not candidates and unit.id == "first":
        candidates = [entry for entry in entries if entry.subject in unit.allowed_subjects]

    output: dict[int, AnswerEntry] = {}
    duplicates: dict[int, list[AnswerEntry]] = {}
    for entry in candidates:
        duplicates.setdefault(entry.number, []).append(entry)
    for number, items in duplicates.items():
        unique = {(item.answer, item.annulled, item.subject) for item in items}
        if len(unique) == 1:
            output[number] = items[0]
            continue
        # If duplicate identities exist because several key documents repeat the same
        # definitive table, accept only if answer/annulment agrees.
        answer_shapes = {(item.answer, item.annulled) for item in items}
        if len(answer_shapes) == 1:
            output[number] = items[0]
    return output


@dataclass
class QuestionCandidate:
    number: int
    statement: str
    alternatives: dict[str, str]
    page: int | None
    mode: str

    @property
    def complete(self) -> bool:
        return set(self.alternatives) == set(LETTERS) and bool(self.statement.strip())

    @property
    def score(self) -> tuple[int, int, int]:
        return (
            1 if self.complete else 0,
            1 if self.mode == "plain" else 0,
            len(self.statement) + sum(len(value) for value in self.alternatives.values()),
        )


def question_candidates_from_pages(
    pages: list[str],
    mode: str = "plain",
) -> list[QuestionCandidate]:
    lines: list[tuple[int, str]] = []
    for page_number, page in enumerate(pages, start=1):
        for raw in page.splitlines():
            line = compact_space(raw)
            if line:
                lines.append((page_number, line))
    starts: list[tuple[int, int, str]] = []
    for index, (_, line) in enumerate(lines):
        match = QUESTION_RE.match(line)
        if not match:
            continue
        number = int(match.group(1))
        if 1 <= number <= 200:
            starts.append((index, number, match.group(2)))
    output: list[QuestionCandidate] = []
    for offset, (index, number, rest) in enumerate(starts):
        end = starts[offset + 1][0] if offset + 1 < len(starts) else len(lines)
        page = lines[index][0]
        statement = [rest] if rest else []
        alternatives: dict[str, list[str]] = {}
        current: str | None = None
        for _, line in lines[index + 1 : end]:
            alt = ALTERNATIVE_RE.match(line)
            if alt:
                current = (alt.group(1) or alt.group(2)).upper()
                alternatives.setdefault(current, []).append(alt.group(3))
            elif current:
                alternatives[current].append(line)
            else:
                statement.append(line)
        output.append(
            QuestionCandidate(
                number=number,
                statement=compact_space(" ".join(statement)),
                alternatives={
                    letter: compact_space(" ".join(parts))
                    for letter, parts in alternatives.items()
                },
                page=page,
                mode=mode,
            )
        )
    return output


def question_candidates(document: PdfDocument, layout: bool) -> list[QuestionCandidate]:
    return question_candidates_from_pages(
        pdf_pages(document, layout=layout),
        mode="layout" if layout else "plain",
    )


def extract_questions(unit: Unit, answers: dict[int, AnswerEntry]) -> tuple[list[dict], list[int]]:
    if unit.exam is None:
        return [], list(range(1, unit.expected + 1))
    all_candidates = question_candidates(unit.exam, False) + question_candidates(unit.exam, True)
    questions: list[dict] = []
    missing: list[int] = []
    for number in range(1, unit.expected + 1):
        viable = [
            candidate
            for candidate in all_candidates
            if candidate.number == number and candidate.complete
        ]
        answer = answers.get(number)
        if not viable or answer is None:
            missing.append(number)
            continue
        candidate = max(viable, key=lambda item: item.score)
        subject = answer.subject_label or answer.subject or "Conhecimentos gerais"
        questions.append(
            {
                "number": number,
                "subject": subject,
                "statement": candidate.statement,
                "alternatives": [
                    {"id": letter, "text": candidate.alternatives[letter]}
                    for letter in LETTERS
                ],
                "correctAlternative": answer.answer,
                "annulled": answer.annulled,
                "page": candidate.page,
            }
        )
    return questions, missing


def write_blob(root: Path, document: PdfDocument) -> str:
    target = root / "blobs" / "sha256" / document.sha256[:2] / f"{document.sha256}.pdf"
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(document.bytes)
    return str(target)


def process_unioeste_archive(path: Path, output: Path) -> dict:
    match = re.search(r"(?i)unioeste[_ -]+(20\d{2}|19\d{2})", path.stem)
    if not match:
        raise ValueError(f"{path.name}: expected UNIOESTE_<year>.zip naming")
    year = int(match.group(1))
    documents = load_documents([path])
    hydrate_pdf_metadata(documents)
    units = unioeste_units(year, documents)
    amendments = [doc for doc in documents if is_amendment(doc)]
    key_documents = [doc for doc in documents if is_key(doc)]

    edition = {
        "providerId": "unioeste",
        "institution": "UNIOESTE",
        "year": year,
        "parserVersion": PARSER_VERSION,
        "rightsStatus": "private-local",
        "archive": {
            "name": path.name,
            "sha256": sha256(path.read_bytes()),
            "bytes": path.stat().st_size,
        },
        "amendments": [
            {"member": doc.member, "sha256": doc.sha256, "bytes": doc.size}
            for doc in amendments
        ],
        "units": [],
    }

    total_questions = 0
    total_expected = 0
    for unit in units:
        answers = choose_key_entries(unit)
        questions, missing = extract_questions(unit, answers)
        total_questions += len(questions)
        total_expected += unit.expected
        issues = list(unit.issues)
        if unit.exam is None:
            issues.append("exam-document-not-found")
        if len(answers) != unit.expected:
            issues.append(f"answer-key-coverage:{len(answers)}/{unit.expected}")
        if missing:
            issues.append("question-extraction-missing:" + ",".join(map(str, missing)))
        if unit.answer_key_status != "definitive":
            issues.append(f"answer-key-status:{unit.answer_key_status}")

        selected_docs = ([unit.exam] if unit.exam else []) + unit.key_docs
        blob_paths = {}
        for document in selected_docs:
            if document is not None:
                blob_paths[document.sha256] = write_blob(output, document)

        edition["units"].append(
            {
                "id": unit.id,
                "label": unit.label,
                "language": unit.language,
                "expectedQuestions": unit.expected,
                "extractedQuestions": len(questions),
                "complete": len(questions) == unit.expected and len(answers) == unit.expected,
                "answerKeyStatus": unit.answer_key_status,
                "examDocument": (
                    {
                        "member": unit.exam.member,
                        "sha256": unit.exam.sha256,
                        "bytes": unit.exam.size,
                        "pages": unit.exam.page_count,
                        "blob": blob_paths[unit.exam.sha256],
                    }
                    if unit.exam
                    else None
                ),
                "answerKeyDocuments": [
                    {
                        "member": document.member,
                        "sha256": document.sha256,
                        "bytes": document.size,
                        "pages": document.page_count,
                        "blob": blob_paths[document.sha256],
                    }
                    for document in key_documents
                ],
                "issues": issues,
                "questions": questions,
            }
        )

    edition["summary"] = {
        "expectedQuestions": total_expected,
        "extractedQuestions": total_questions,
        "completeUnits": sum(1 for unit in edition["units"] if unit["complete"]),
        "units": len(edition["units"]),
    }
    year_dir = output / "unioeste" / str(year)
    year_dir.mkdir(parents=True, exist_ok=True)
    (year_dir / "bundle.json").write_text(
        json.dumps(edition, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return edition


def collect_inputs(values: list[str]) -> list[Path]:
    paths: list[Path] = []
    for value in values or [".ingestion-inbox"]:
        path = Path(value)
        if path.is_dir():
            paths.extend(sorted(path.glob("*.zip")))
        elif path.is_file():
            paths.append(path)
        else:
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(paths))


def summary_payload(editions: list[dict]) -> dict:
    return {
        "version": VERSION,
        "parserVersion": PARSER_VERSION,
        "archives": len(editions),
        "editions": len(editions),
        "expectedQuestions": sum(e["summary"]["expectedQuestions"] for e in editions),
        "extractedQuestions": sum(e["summary"]["extractedQuestions"] for e in editions),
        "completeUnits": sum(e["summary"]["completeUnits"] for e in editions),
        "units": sum(e["summary"]["units"] for e in editions),
        "years": [
            {
                "year": e["year"],
                **e["summary"],
                "issues": [
                    {"unit": unit["id"], "issues": unit["issues"]}
                    for unit in e["units"]
                    if unit["issues"]
                ],
            }
            for e in sorted(editions, key=lambda item: item["year"])
        ],
    }



def process_path(path_value: str, output_value: str) -> tuple[dict | None, dict | None]:
    path = Path(path_value)
    output = Path(output_value)
    try:
        if re.search(r"(?i)unioeste", path.name):
            return process_unioeste_archive(path, output), None
        return None, {"archive": path.name, "error": "unsupported-provider"}
    except Exception as error:
        return None, {"archive": path.name, "error": str(error)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fast local ZIP inbox for vestibular ingestion (UNIOESTE profile first)."
    )
    parser.add_argument("--input", action="append", default=[], help="ZIP file or directory; repeatable")
    parser.add_argument("--output", default=".ingestion-cache/inbox")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    inputs = collect_inputs(args.input)
    if not inputs:
        print("no ZIP files found", file=sys.stderr)
        return 2

    editions: list[dict] = []
    failures: list[dict] = []
    workers = max(1, min(args.workers, 8))
    if workers == 1 or len(inputs) == 1:
        results = [process_path(str(path), str(output)) for path in inputs]
    else:
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
            results = list(
                pool.map(
                    process_path,
                    [str(path) for path in inputs],
                    [str(output)] * len(inputs),
                )
            )
    for edition, failure in results:
        if edition is not None:
            editions.append(edition)
        if failure is not None:
            failures.append(failure)

    summary = summary_payload(editions)
    summary["failures"] = failures
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
