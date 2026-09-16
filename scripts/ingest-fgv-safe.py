#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

SCRIPT_DIR = Path(__file__).resolve().parent
MIRROR_SCRIPT = SCRIPT_DIR / "ingest-uece-mirror.py"
spec = importlib.util.spec_from_file_location("fgv_ingest_mirror", MIRROR_SCRIPT)
assert spec and spec.loader
mirror = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mirror
spec.loader.exec_module(mirror)
base = mirror.core.base

PARSER_VERSION = "inbox-fgv@0.1.0"
PROVIDER_ID = "brasil-escola"
RIGHTS_STATUS = "third-party-mirror-reference"
SLUG = "fundacao-getulio-vargas"
SUPPORTED = {".zip", ".rar", ".7z", ".pdf"}
LETTERS = "ABCDE"
OPEN_GLYPH = "\uf0a1"
SELECTED_GLYPH = "\uf0a3"
DENY_RE = re.compile(r"(?:redac|discurs|resol|grade[- _]?de[- _]?correc)", re.I)
OBJECTIVE_RE = re.compile(r"(?:objetiv|1a[- _]?fase|1ª[- _]?fase)", re.I)
YEAR_TERM_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})\s*[/.-]\s*([12])(?!\d)")
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
VISUAL_RE = re.compile(r"\b(figura|imagem|gr[aá]fico|mapa|charge|fotografia|foto|diagrama|esquema|tabela|ilustra[cç][aã]o|quadro)\b", re.I)


@dataclass
class Run:
    text: str
    font: str
    size: float
    x: float
    y: float
    page: int

    @property
    def is_choice(self) -> bool:
        return "wingdings" in self.font.lower() and self.text in {OPEN_GLYPH, SELECTED_GLYPH}


@dataclass
class ParsedQuestion:
    number: int
    statement: str
    alternatives: list[str]
    correct: str
    page: int


def compact(value: str) -> str:
    return base.compact_space(value or "")


def norm(value: str) -> str:
    return compact(re.sub(r"[^a-z0-9]+", " ", base.deaccent(compact(value)))).lower()


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


def edition(meta: dict, path: Path) -> tuple[int | None, int | None]:
    title = str(meta.get("title") or path.stem)
    direct = YEAR_TERM_RE.search(title)
    if direct:
        return int(direct.group(1)), int(direct.group(2))
    year_match = YEAR_RE.search(title)
    if year_match:
        return int(year_match.group(1)), 1
    try:
        return int(meta.get("year")), 1
    except (TypeError, ValueError):
        return None, None


def program(title: str) -> str:
    value = norm(title)
    if "economia" in value:
        return "Economia"
    if "direito" in value:
        return "Direito"
    if "rio" in value:
        return "Unificado Rio"
    if "relacoes internacionais" in value and "administracao" in value:
        return "Administração e Relações Internacionais"
    if "administracao" in value or "eaesp" in value:
        return "Administração EAESP"
    return "FGV"


def is_objective_member(member: str) -> bool:
    leaf = Path(member).name
    return not DENY_RE.search(leaf) and bool(OBJECTIVE_RE.search(leaf))


def is_marked(member: str) -> bool:
    stem = Path(member).stem
    return bool(re.match(r"^g[- _]", stem, re.I) or re.search(r"gabarito", stem, re.I))


def normalized_stem(member: str) -> str:
    value = Path(member).stem
    value = re.sub(r"^g[- _]+", "", value, flags=re.I)
    value = re.sub(r"[- _]+gabarito(?:[- _].*)?$", "", value, flags=re.I)
    value = re.sub(r"[- _]+0$", "", value)
    return norm(value)


def pair_documents(documents) -> list[tuple[str, object, object]]:
    groups = defaultdict(lambda: {"base": [], "marked": []})
    for document in documents:
        if not is_objective_member(document.member):
            continue
        groups[normalized_stem(document.member)]["marked" if is_marked(document.member) else "base"].append(document)
    pairs = []
    for key, group in groups.items():
        if not group["base"] or not group["marked"]:
            continue
        plain = max(group["base"], key=lambda d: (d.page_count, d.size))
        marked = max(group["marked"], key=lambda d: (d.page_count, d.size))
        pairs.append((key, plain, marked))
    return pairs


def extract_runs(document) -> list[Run]:
    reader = PdfReader(io.BytesIO(document.bytes), strict=False)
    output: list[Run] = []
    for page_no, page in enumerate(reader.pages, 1):
        def visitor(text, cm, tm, font_dict, font_size):
            value = compact(text)
            if not value:
                return
            font = str((font_dict or {}).get("/BaseFont") or "")
            try:
                x, y = float(tm[4]), float(tm[5])
            except Exception:
                x, y = 0.0, 0.0
            output.append(Run(value, font, float(font_size or 0), x, y, page_no))
        try:
            page.extract_text(visitor_text=visitor)
        except Exception:
            continue
    return output


def choice_groups(runs: list[Run]) -> list[list[int]]:
    indices = [index for index, run in enumerate(runs) if run.is_choice]
    groups = []
    cursor = 0
    while cursor + 4 < len(indices):
        group = indices[cursor: cursor + 5]
        # A valid group is local: the five bullets stay on one page/column and appear in
        # descending vertical order. If not, advance one bullet rather than forcing a pair.
        items = [runs[index] for index in group]
        same_page = len({item.page for item in items}) == 1
        same_column = max(item.x for item in items) - min(item.x for item in items) <= 4.0
        descending = all(items[i].y >= items[i + 1].y - 1.0 for i in range(4))
        if same_page and same_column and descending:
            groups.append(group)
            cursor += 5
        else:
            cursor += 1
    return groups


def _alternative_end(runs: list[Run], start: int, next_choice: int | None, bullet: Run) -> int:
    if next_choice is not None:
        return next_choice
    # The fifth alternative ends when text returns to the left question margin after a
    # visible vertical gap. Formula fragments inside the alternative stay to the right.
    previous_y = bullet.y
    saw_content = False
    for index in range(start, len(runs)):
        run = runs[index]
        if run.page != bullet.page:
            return index
        if run.is_choice:
            return index
        if saw_content and run.x <= bullet.x + 4.0 and previous_y - run.y >= 18.0:
            return index
        if compact(run.text):
            saw_content = True
            previous_y = min(previous_y, run.y)
    return len(runs)


def parse_marked_document(document) -> list[ParsedQuestion]:
    runs = extract_runs(document)
    groups = choice_groups(runs)
    questions = []
    previous_end = 0
    for number, group in enumerate(groups, 1):
        bullets = [runs[index] for index in group]
        selected = [index for index, item in enumerate(bullets) if item.text == SELECTED_GLYPH]
        if len(selected) != 1:
            previous_end = group[-1] + 1
            continue

        first = group[0]
        statement_runs = [run for run in runs[previous_end:first] if run.page <= bullets[0].page and not run.is_choice]
        # Remove page-number/footer artifacts without removing legitimate one-character maths.
        statement_parts = []
        for run in statement_runs:
            if run.y < 55 and re.fullmatch(r"\d{1,3}", run.text):
                continue
            statement_parts.append(run.text)
        statement = compact(" ".join(statement_parts))

        alternatives = []
        last_end = group[-1] + 1
        for offset, bullet_index in enumerate(group):
            next_choice = group[offset + 1] if offset < 4 else None
            end = _alternative_end(runs, bullet_index + 1, next_choice, runs[bullet_index])
            parts = []
            for run in runs[bullet_index + 1:end]:
                if run.is_choice:
                    break
                if run.page != runs[bullet_index].page:
                    break
                parts.append(run.text)
            alternatives.append(compact(" ".join(parts)))
            if offset == 4:
                last_end = end

        previous_end = last_end
        if len(alternatives) != 5 or any(not value for value in alternatives):
            continue
        if len(statement) < 8:
            continue
        visual = bool(VISUAL_RE.search(statement))
        questions.append(ParsedQuestion(
            number=number,
            statement=statement,
            alternatives=alternatives,
            correct=LETTERS[selected[0]],
            page=bullets[0].page,
        ))
    return questions


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
    records = []
    failures = []
    seen_packages = set()
    seen_exam_sha = set()

    for path in paths:
        meta = sidecar(path)
        title = str(meta.get("title") or path.stem)
        fingerprint = package_sha(path, meta)
        if fingerprint in seen_packages:
            continue
        seen_packages.add(fingerprint)
        try:
            documents = mirror.load_documents(path)
            if documents is None:
                raise ValueError("compressed-extractor-unavailable")
            base.hydrate_pdf_metadata(documents)
            year, term = edition(meta, path)
            if year is None:
                raise ValueError("could not determine FGV edition")
            record = {
                "archive": path.name,
                "packageSha256": fingerprint,
                "downloadId": meta.get("downloadId"),
                "title": title,
                "downloadUrl": meta.get("downloadUrl"),
                "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
            }
            for pair_key, plain, marked in pair_documents(documents):
                # Identical UNIFICADO PDFs appear in more than one mirror package. The exam
                # SHA is the corpus identity; provenance remains attached to the retained copy.
                if plain.sha256 in seen_exam_sha:
                    continue
                parsed = parse_marked_document(marked)
                glyph_count = sum(1 for run in extract_runs(marked) if run.is_choice)
                # Wingdings family only. Economia uses graphical highlighting and is handled
                # separately once that geometry is proven exhaustive.
                if glyph_count < 20 or glyph_count % 5 != 0:
                    continue
                expected = glyph_count // 5
                if not parsed:
                    continue
                seen_exam_sha.add(plain.sha256)
                records.append({
                    "year": year,
                    "term": term,
                    "program": program(title),
                    "pairKey": pair_key,
                    "record": record,
                    "plain": plain,
                    "marked": marked,
                    "expected": expected,
                    "questions": parsed,
                })
        except Exception as error:
            failures.append({"archive": path.name, "exceptionType": type(error).__name__, "error": str(error)[:500]})

    grouped = defaultdict(list)
    for item in records:
        key = (item["program"], item["year"], item["term"])
        grouped[key].append(item)

    editions = []
    for (prog, year, term), items in grouped.items():
        program_slug = re.sub(r"[^a-z0-9]+", "-", base.deaccent(prog).lower()).strip("-")
        edition_id = f"fgv-{program_slug}-{year}-{term}"
        units = []
        for item in sorted(items, key=lambda value: value["pairKey"]):
            questions = []
            review = 0
            for question in item["questions"]:
                visual = bool(VISUAL_RE.search(question.statement))
                review += int(visual)
                questions.append({
                    "number": question.number,
                    "subject": "Conhecimentos gerais",
                    "statement": question.statement,
                    "alternatives": [
                        {"id": letter, "text": text}
                        for letter, text in zip(LETTERS, question.alternatives)
                    ],
                    "correctAlternative": question.correct,
                    "annulled": False,
                    "page": question.page,
                    "flags": ["likely-visual-dependency"] if visual else [],
                })
            expected = item["expected"]
            extracted = len(questions)
            units.append({
                "id": re.sub(r"[^a-z0-9]+", "-", item["pairKey"]).strip("-"),
                "label": item["pairKey"],
                "expectedQuestions": expected,
                "extractedQuestions": extracted,
                "missingIdentities": max(0, expected - extracted),
                "structurallyComplete": expected > 0 and extracted == expected,
                "answerKeyStatus": "embedded-answer-marked-copy",
                "questionsNeedingReview": review,
                "visualDependencies": review,
                "examDocument": descriptor(item["plain"], item["record"]),
                "answerKeyDocument": descriptor(item["marked"], item["record"]),
                "issues": [] if extracted == expected else [f"missing-questions:{expected-extracted}"],
                "questions": questions,
            })
        expected_total = sum(unit["expectedQuestions"] for unit in units)
        extracted_total = sum(unit["extractedQuestions"] for unit in units)
        complete = sum(int(unit["structurallyComplete"]) for unit in units)
        visual = sum(unit["visualDependencies"] for unit in units)
        source = items[0]["record"]
        editions.append({
            "providerId": PROVIDER_ID,
            "institution": "FGV",
            "modality": prog,
            "editionId": edition_id,
            "year": year,
            "term": term,
            "parserVersion": PARSER_VERSION,
            "rightsStatus": RIGHTS_STATUS,
            "source": {key: source.get(key) for key in ("archive", "packageSha256", "downloadId", "title", "downloadUrl", "resolvedDownloadUrl")},
            "units": units,
            "summary": {
                "expectedQuestions": expected_total,
                "extractedQuestions": extracted_total,
                "completeUnits": complete,
                "missingIdentities": max(0, expected_total - extracted_total),
                "visualDependencies": visual,
            },
        })

    editions.sort(key=lambda item: (item["year"], item["term"], item["modality"]))
    summary = {
        "version": 1,
        "parserVersion": PARSER_VERSION,
        "providerId": PROVIDER_ID,
        "institution": "FGV",
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
                "term": item["term"],
                "modality": item["modality"],
                **item["summary"],
                "unitCoverage": [f"{unit['extractedQuestions']}/{unit['expectedQuestions']}" for unit in item["units"]],
            }
            for item in editions
        ],
        "failures": failures,
    }
    return editions, summary


def json_text(value) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministically ingest native FGV objective blocks with embedded answer markings.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.input)
    paths = sorted(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED)
    editions, summary = process(paths)
    output = Path(args.output)
    for item in editions:
        target = output / "fgv" / item["editionId"].removeprefix("fgv-") / "bundle.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json_text(item), encoding="utf-8")
    summary_path = output / "fgv-summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json_text(summary), encoding="utf-8")
    print(json_text(summary), end="")
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
