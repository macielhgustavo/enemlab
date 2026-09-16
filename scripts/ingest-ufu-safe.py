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
PROBE_SCRIPT = SCRIPT_DIR / "probe-ufu-layout.py"
spec = importlib.util.spec_from_file_location("ufu_probe_for_ingest", PROBE_SCRIPT)
assert spec and spec.loader
probe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)
mirror = probe.mirror
core = probe.core

PARSER_VERSION = "inbox-ufu@0.2.0"
PROVIDER_ID = "brasil-escola"
RIGHTS_STATUS = "third-party-mirror-reference"
LETTERS = "ABCD"
SUPPORTED = {".zip", ".rar", ".7z", ".pdf"}
YEAR_TERM_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})\s*[/.-]\s*([12])(?!\d)")
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
QUESTION_RE = re.compile(
    r"^\s*QUEST(?:ÃO|AO)\s*0*(\d{1,3})(?:\s*[.):\-–—]\s*)?(.*)$",
    re.I,
)
ALT_RE = re.compile(
    r"^\s*(?:\(([A-D])\)|([A-D])\s*[).:\-–—])\s*(.*)$",
    re.I,
)
KEY_PAIR_RE = re.compile(r"(?<!\d)(\d{1,3})\s+([A-E]|N|X|ANULADA?)\b", re.I)
EXPECTED_RE = re.compile(r"(?:composta|composto)\s+(?:de|por)\s+(\d{2,3})\s+quest", re.I)
VISUAL_RE = re.compile(
    r"\b(figura|imagem|gr[aá]fico|mapa|charge|fotografia|foto|diagrama|esquema|tabela|ilustra[cç][aã]o|quadro)\b",
    re.I,
)
PACKAGE_DENY_RE = re.compile(
    r"\b(?:ead|pontal|especial|escolar)\b|(?:2[ªa°º _-]*fase|segunda[ _-]*fase)",
    re.I,
)
DOC_DENY_RE = re.compile(
    r"(?:2[ªa°º _-]*fase|segunda[ _-]*fase|dia[ _-]*2|segundo[ _-]*dia|discursiv|franc[eê]s|redac|resposta[ _-]*esperada)",
    re.I,
)

SUBJECTS = {
    "biologia": "Biologia",
    "filosofia": "Filosofia",
    "fisica": "Física",
    "geografia": "Geografia",
    "historia": "História",
    "ingles": "Inglês",
    "lingua inglesa": "Inglês",
    "espanhol": "Espanhol",
    "lingua espanhola": "Espanhol",
    "literatura": "Literatura",
    "lingua portuguesa": "Língua Portuguesa",
    "portugues": "Língua Portuguesa",
    "matematica": "Matemática",
    "quimica": "Química",
    "sociologia": "Sociologia",
}


def norm(value: str) -> str:
    return core.norm(probe.utf8_safe(value))


def compact(value: str) -> str:
    return core.base.compact_space(probe.utf8_safe(value))


def sidecar(path: Path) -> dict:
    meta = path.with_suffix(path.suffix + ".meta.json")
    if not meta.exists():
        return {}
    try:
        return json.loads(meta.read_text(encoding="utf-8"))
    except Exception:
        return {}


def package_sha(path: Path, meta: dict) -> str:
    value = meta.get("sha256")
    if isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value):
        return value.lower()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def edition(meta: dict, path: Path, documents) -> tuple[int | None, int | None]:
    texts = [str(meta.get("title") or path.stem)]
    texts.extend(probe.utf8_safe(getattr(d, "first_text", ""))[:2500] for d in documents)
    for text in texts:
        match = YEAR_TERM_RE.search(text)
        if match:
            return int(match.group(1)), int(match.group(2))
    for text in texts:
        match = YEAR_RE.search(text)
        if match:
            return int(match.group(1)), 2
    return None, None


def subject_from_line(line: str) -> str | None:
    value = norm(line)
    for key, label in SUBJECTS.items():
        if value == key or value.startswith(key + " "):
            return label
    return None


def doc_text(document) -> tuple[str, str]:
    pages, mode = probe.pages(document)
    return "\n".join(pages), mode


def document_denied(document, text: str) -> bool:
    value = f"{document.member} {text[:3000]}"
    normalized = norm(value)
    if DOC_DENY_RE.search(value):
        return True
    if "medicina" in normalized and "exceto medicina" not in normalized:
        return True
    return False


def eligible_exam(document, text: str) -> bool:
    if document_denied(document, text):
        return False
    value = norm(f"{document.member} {text[:3000]}")
    if "prova objetiva" not in value and "primeiro dia" not in value and "1 fase" not in value:
        return False
    if not re.search(r"\btipo\s*0?1\b", value):
        return False
    return document.page_count >= 20


def eligible_key(document, text: str) -> bool:
    if document_denied(document, text):
        return False
    value = norm(f"{document.member} {text[:3000]}")
    return "gabarito" in value and document.page_count <= 5


def clean_body_line(line: str) -> str:
    value = compact(line)
    if re.match(r"^Processo Seletivo UFU/", value, re.I):
        return ""
    return value


def parse_exam_text(text: str) -> tuple[dict[int, dict], int]:
    expected_match = EXPECTED_RE.search(text)
    expected = int(expected_match.group(1)) if expected_match else 0
    candidates: list[dict] = []
    current = None
    active_alt = None
    subject = None
    page_no = 1

    def finish():
        nonlocal current
        if not current:
            return
        statement = compact(" ".join(current["statement"]))
        alternatives = {key: compact(" ".join(parts)) for key, parts in current["alternatives"].items()}
        if statement and set(alternatives) == set(LETTERS) and all(alternatives.values()):
            candidates.append({
                "number": current["number"],
                "subject": current["subject"] or "Conhecimentos gerais",
                "statement": statement,
                "alternatives": alternatives,
                "page": current["page"],
            })
        current = None

    for raw in text.splitlines():
        raw_compact = compact(raw)
        if re.fullmatch(r"P[aá]gina\s+\d+", raw_compact, re.I):
            page_no += 1
            continue
        line = clean_body_line(raw)
        if not line:
            continue
        heading = subject_from_line(line)
        qmatch = QUESTION_RE.match(line)
        if heading and not qmatch:
            if current and current["alternatives"]:
                finish()
            subject = heading
            active_alt = None
            continue
        if qmatch:
            finish()
            remainder = compact(qmatch.group(2) or "")
            current = {
                "number": int(qmatch.group(1)),
                "subject": subject,
                "statement": [remainder] if remainder else [],
                "alternatives": defaultdict(list),
                "page": page_no,
            }
            active_alt = None
            continue
        if current is None:
            continue
        amatch = ALT_RE.match(line)
        if amatch:
            active_alt = (amatch.group(1) or amatch.group(2)).upper()
            current["alternatives"][active_alt].append(amatch.group(3))
        elif active_alt:
            current["alternatives"][active_alt].append(line)
        else:
            current["statement"].append(line)
    finish()

    grouped: dict[int, list[dict]] = defaultdict(list)
    for item in candidates:
        grouped[item["number"]].append(item)

    chosen = {}
    for number, items in grouped.items():
        english = [item for item in items if item["subject"] == "Inglês"]
        non_spanish = [item for item in items if item["subject"] != "Espanhol"]
        pool = english or non_spanish or items
        chosen[number] = max(
            pool,
            key=lambda item: len(item["statement"]) + sum(len(value) for value in item["alternatives"].values()),
        )
    return chosen, expected


def parse_key_text(text: str) -> dict[int, str | None]:
    by_number: dict[int, list[tuple[str | None, str | None]]] = defaultdict(list)
    subject = None
    for raw in text.splitlines():
        line = compact(raw)
        if not line:
            continue
        heading = subject_from_line(line)
        if heading:
            subject = heading
        pairs = KEY_PAIR_RE.findall(line.upper())
        if not pairs:
            continue
        number_text, answer_text = pairs[0]
        number = int(number_text)
        if not 1 <= number <= 150:
            continue
        token = answer_text.upper()
        answer = None if token in {"N", "X"} or token.startswith("ANUL") else token
        by_number[number].append((subject, answer))

    answers: dict[int, str | None] = {}
    for number, values in by_number.items():
        english = [answer for language, answer in values if language == "Inglês"]
        non_spanish = [answer for language, answer in values if language != "Espanhol"]
        pool = english or non_spanish or [answer for _, answer in values]
        unique = set(pool)
        if len(unique) == 1:
            answers[number] = pool[-1]
            continue
        counts = defaultdict(int)
        for answer in pool:
            counts[answer] += 1
        winner = max(counts, key=counts.get)
        if list(counts.values()).count(counts[winner]) == 1:
            answers[number] = winner
    return answers


def key_status(document, text: str) -> str:
    value = norm(f"{document.leaf} {text[:2500]}")
    if "definitiv" in value:
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


def process(paths: list[Path]) -> tuple[list[dict], dict]:
    editions = []
    failures = []
    excluded_packages = []
    seen_packages = set()

    for path in paths:
        meta = sidecar(path)
        title = str(meta.get("title") or path.stem)
        if PACKAGE_DENY_RE.search(title):
            excluded_packages.append({"archive": path.name, "title": title, "reason": "package-filter"})
            continue
        fingerprint = package_sha(path, meta)
        if fingerprint in seen_packages:
            continue
        seen_packages.add(fingerprint)
        try:
            documents = mirror.load_documents(path)
            if documents is None:
                raise ValueError("compressed-extractor-unavailable")
            core.base.hydrate_pdf_metadata(documents)
            year, term = edition(meta, path, documents)
            if year is None:
                raise ValueError("could not determine UFU edition")
            record = {
                "archive": path.name,
                "packageSha256": fingerprint,
                "downloadId": meta.get("downloadId"),
                "title": title,
                "downloadUrl": meta.get("downloadUrl"),
                "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
            }

            exam_options = []
            key_options = []
            excluded_docs = []
            for document in documents:
                text, mode = doc_text(document)
                if eligible_exam(document, text):
                    qmap, expected = parse_exam_text(text)
                    exam_options.append((len(qmap), expected, document.page_count, document, qmap, mode))
                elif eligible_key(document, text):
                    answers = parse_key_text(text)
                    status = key_status(document, text)
                    key_options.append((status == "definitive", len(answers), document.page_count, document, answers, status, mode))
                else:
                    excluded_docs.append({
                        "member": document.member,
                        "sha256": document.sha256,
                        "reason": "non-regular-objective-document",
                    })

            if not exam_options:
                raise ValueError("regular type-1 exam not found")
            if not key_options:
                raise ValueError("regular answer key not found")

            exam = max(exam_options, key=lambda item: (item[1] > 0, item[0], item[1], item[2]))
            key = max(key_options, key=lambda item: (item[0], item[1], item[2]))
            _, exam_expected, _, exam_doc, qmap, exam_mode = exam
            _, _, _, key_doc, amap, status, key_mode = key
            expected = exam_expected or max(amap, default=0) or max(qmap, default=0)

            questions = []
            missing_body = []
            missing_key = []
            incompatible = []
            visual = 0
            for number in range(1, expected + 1):
                question = qmap.get(number)
                if question is None:
                    missing_body.append(number)
                    continue
                if number not in amap:
                    missing_key.append(number)
                    continue
                correct = amap[number]
                if correct is not None and correct not in question["alternatives"]:
                    incompatible.append(number)
                    continue
                flag = bool(VISUAL_RE.search(question["statement"]))
                visual += int(flag)
                questions.append({
                    "number": number,
                    "subject": question["subject"],
                    "statement": question["statement"],
                    "alternatives": [
                        {"id": letter, "text": question["alternatives"][letter]} for letter in LETTERS
                    ],
                    "correctAlternative": correct,
                    "annulled": correct is None,
                    "page": question["page"],
                    "flags": ["likely-visual-dependency"] if flag else [],
                })

            issues = []
            if missing_body:
                issues.append("missing-questions:" + ",".join(map(str, missing_body)))
            if missing_key:
                issues.append("missing-answers:" + ",".join(map(str, missing_key)))
            if incompatible:
                issues.append("answer-not-in-alternatives:" + ",".join(map(str, incompatible)))
            if status != "definitive":
                issues.append(f"answer-key-status:{status}")

            edition_id = f"ufu-{year}-{term}"
            extracted = len(questions)
            unit = {
                "id": "first-phase-type-1",
                "label": "1ª fase - Tipo 1",
                "expectedQuestions": expected,
                "extractedQuestions": extracted,
                "missingIdentities": max(0, expected - extracted),
                "structurallyComplete": expected > 0 and extracted == expected,
                "answerKeyStatus": status,
                "questionsNeedingReview": visual,
                "visualDependencies": visual,
                "examTextExtractionMode": exam_mode,
                "answerKeyTextExtractionMode": key_mode,
                "examDocument": descriptor(exam_doc, record),
                "answerKeyDocument": descriptor(key_doc, record),
                "excludedDocuments": excluded_docs,
                "issues": issues,
                "questions": questions,
            }
            editions.append({
                "providerId": PROVIDER_ID,
                "institution": "UFU",
                "modality": "Vestibular regular - 1ª fase",
                "editionId": edition_id,
                "year": year,
                "term": term,
                "parserVersion": PARSER_VERSION,
                "rightsStatus": RIGHTS_STATUS,
                "source": record,
                "units": [unit],
                "summary": {
                    "expectedQuestions": expected,
                    "extractedQuestions": extracted,
                    "completeUnits": int(unit["structurallyComplete"]),
                    "missingIdentities": max(0, expected - extracted),
                    "visualDependencies": visual,
                },
            })
        except Exception as error:
            failures.append({
                "archive": path.name,
                "exceptionType": type(error).__name__,
                "error": probe.utf8_safe(str(error)),
            })

    by_id = defaultdict(list)
    for item in editions:
        by_id[item["editionId"]].append(item)
    editions = [
        max(
            items,
            key=lambda item: (
                item["summary"]["completeUnits"],
                item["summary"]["extractedQuestions"],
                item["summary"]["expectedQuestions"],
            ),
        )
        for items in by_id.values()
    ]
    editions.sort(key=lambda item: (item["year"], item["term"]))

    summary = {
        "version": 2,
        "parserVersion": PARSER_VERSION,
        "providerId": PROVIDER_ID,
        "institution": "UFU",
        "archivesScanned": len(paths),
        "uniquePackages": len(seen_packages),
        "excludedPackages": excluded_packages,
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
                "term": item["term"],
                **item["summary"],
            }
            for item in editions
        ],
        "failures": failures,
    }
    return editions, summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic UFU regular first-phase ingestion.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.input)
    paths = sorted(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED)
    editions, summary = process(paths)
    out = Path(args.output)
    for item in editions:
        target = out / "ufu" / item["editionId"].removeprefix("ufu-") / "bundle.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    out.mkdir(parents=True, exist_ok=True)
    (out / "ufu-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
