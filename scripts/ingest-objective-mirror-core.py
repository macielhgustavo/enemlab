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


probe = load_module("objective_mirror_probe", PROBE_SCRIPT)
mirror = probe.mirror
base = probe.core.base

PARSER_VERSION = "inbox-objective-mirror@0.1.0"
PROVIDER_ID = "brasil-escola"
RIGHTS_STATUS = "third-party-mirror-reference"
SUPPORTED = probe.SUPPORTED
LETTERS = ("A", "B", "C", "D", "E")
VISUAL_RE = re.compile(
    r"\b(figura|imagem|gr[aá]fico|mapa|charge|fotografia|foto|diagrama|esquema|tabela|ilustra[cç][aã]o|quadro)\b",
    re.I,
)
YEAR_TERM_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})\s*[/.-]\s*([12])(?!\d)")
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
QUESTION_RE = re.compile(
    r"^\s*(?:QUEST(?:ÃO|AO)\s*)?0?(\d{1,3})\s*(?:[.)\-–—:]\s*|\s+)(\S.*)$",
    re.I,
)
ALT_RE = re.compile(
    r"^\s*(?:\(([A-Ea-e])\)|([A-Ea-e])\s*[.)\-–—:]|([A-Ea-e])\s{2,})(?:\s*)(.*)$"
)
KEY_PAIR_RE = re.compile(
    r"(?<!\d)0?(\d{1,3})\s*(?:[-–—.:=)]\s*)?([A-EX])(?![A-Z])",
    re.I,
)


PROFILES = {
    "fatec": {
        "institution": "FATEC",
        "slug": "faculdade-tecnologia-sao-paulo",
        "region": "sudeste",
        "prefix": "fatec",
        "package_deny": (),
        "document_deny": ("edital", "prouni", "sisu", "termo de adesao", "termo-de-adesao"),
    },
    "ueg": {
        "institution": "UEG",
        "slug": "universidade-estadual-goias-1",
        "region": "centro-oeste",
        "prefix": "ueg",
        "package_deny": (),
        "document_deny": ("redacao", "expectativa da banca"),
    },
    "ufu": {
        "institution": "UFU",
        "slug": "universidade-federal-uberlandia",
        "region": "sudeste",
        "prefix": "ufu",
        "package_deny": ("ead",),
        "document_deny": ("2 fase", "2a fase", "segunda fase", "discursiva", "medicina", "frances"),
    },
    "unesp": {
        "institution": "UNESP",
        "slug": "universidade-estadual-paulista",
        "region": "sudeste",
        "prefix": "unesp",
        "package_deny": (),
        "document_deny": ("2 fase", "2a fase", "segunda fase", "segunda-fase", "2-fase"),
    },
}


@dataclass
class Candidate:
    number: int
    statement: str
    alternatives: dict[str, str]
    page: int
    mode: str

    @property
    def complete(self) -> bool:
        return bool(self.statement) and len(self.alternatives) >= 4 and set(self.alternatives) <= set(LETTERS)

    @property
    def score(self):
        return (
            len(self.alternatives),
            self.mode == "plain",
            len(self.statement) + sum(len(value) for value in self.alternatives.values()),
        )


def compact(value: str) -> str:
    return base.compact_space(probe.utf8_safe(value))


def norm(value: str) -> str:
    return compact(re.sub(r"[^a-z0-9]+", " ", base.deaccent(compact(value)))).lower()


def package_sha(path: Path, meta: dict) -> str:
    value = meta.get("sha256")
    if isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value):
        return value.lower()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def contains_any(value: str, markers) -> bool:
    normalized = norm(value)
    return any(norm(marker) in normalized for marker in markers)


def profile_input(profile: dict, values: list[str]) -> list[Path]:
    defaults = [f".ingestion-inbox/brasil-escola/{profile['region']}/{profile['slug']}"]
    output: list[Path] = []
    for raw in values or defaults:
        path = Path(raw)
        if path.is_dir():
            output.extend(sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in SUPPORTED))
        elif path.is_file() and path.suffix.lower() in SUPPORTED:
            output.append(path)
        elif not path.exists():
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(output))


def edition(meta: dict, path: Path, documents=None) -> tuple[int | None, int | None]:
    title = str(meta.get("title") or path.stem)
    # Prefer strong document evidence over catalog labels. Mirrors occasionally publish
    # a package under the following cycle while its internal files identify the real one.
    evidence = []
    for document in documents or []:
        for value in (document.leaf, document.first_text[:1200]):
            direct = YEAR_TERM_RE.search(value)
            if direct:
                evidence.append((int(direct.group(1)), int(direct.group(2))))
    if evidence:
        counts = defaultdict(int)
        for item in evidence:
            counts[item] += 1
        return max(counts, key=lambda item: (counts[item], item[0], item[1]))
    direct = YEAR_TERM_RE.search(title)
    if direct:
        return int(direct.group(1)), int(direct.group(2))
    year_match = YEAR_RE.search(title)
    year = int(year_match.group(1)) if year_match else None
    if year is None:
        try:
            year = int(meta.get("year"))
        except (TypeError, ValueError):
            return None, None
    normalized = norm(title)
    if "meio do ano" in normalized or "meio ano" in normalized:
        return year, 2
    return year, 1


def modality(profile_name: str, title: str) -> str:
    value = norm(title)
    if profile_name == "ueg" and "medicina" in value:
        return "Vestibular Medicina"
    return "Vestibular regular"


def document_allowed(profile_name: str, profile: dict, title: str, document) -> bool:
    # Filtering is intentionally based primarily on package/member identity. Subject names
    # routinely appear inside valid first-phase exams, so full body text must not blacklist them.
    identity = f"{title} {document.leaf}"
    normalized = norm(identity)
    if contains_any(identity, profile.get("document_deny", ())):
        # UEG Medicina is a separate explicit modality, not contamination of regular UEG.
        if not (profile_name == "ueg" and "medicina" in norm(title) and "medicina" in normalized):
            return False
    if profile_name == "ueg":
        package_is_medicine = "medicina" in norm(title)
        doc_is_medicine = "medicina" in normalized
        if package_is_medicine != doc_is_medicine and doc_is_medicine:
            return False
        if "reaplic" in normalized:
            return False
    if profile_name == "ufu":
        if any(marker in normalized for marker in ("segunda fase", "2 fase", "2a fase", "ead")):
            return False
    if profile_name == "unesp":
        if any(marker in normalized for marker in ("segunda fase", "2 fase", "2a fase")):
            return False
    return True


def parse_question_pages(pages: list[str], *, mode: str) -> list[Candidate]:
    candidates: list[Candidate] = []
    current = None

    def finish():
        nonlocal current
        if not current:
            return
        alternatives = {
            key: compact(" ".join(parts))
            for key, parts in current["alternatives"].items()
            if compact(" ".join(parts))
        }
        candidate = Candidate(
            number=current["number"],
            statement=compact(" ".join(current["statement"])),
            alternatives=alternatives,
            page=current["page"],
            mode=mode,
        )
        if candidate.complete:
            candidates.append(candidate)
        current = None

    for page_no, page in enumerate(pages, 1):
        for raw in page.splitlines():
            line = compact(raw)
            if not line:
                continue
            match = QUESTION_RE.match(line)
            if match:
                number = int(match.group(1))
                if 1 <= number <= 150:
                    finish()
                    current = {
                        "number": number,
                        "statement": [match.group(2)],
                        "alternatives": {},
                        "active": None,
                        "page": page_no,
                    }
                    continue
            if current is None:
                continue
            alternative = ALT_RE.match(line)
            if alternative:
                letter = (alternative.group(1) or alternative.group(2) or alternative.group(3)).upper()
                text = alternative.group(4)
                current["alternatives"].setdefault(letter, []).append(text)
                current["active"] = letter
            elif current["active"]:
                current["alternatives"].setdefault(current["active"], []).append(line)
            else:
                current["statement"].append(line)
    finish()
    return candidates


def parse_question_document(document) -> dict[int, Candidate]:
    grouped: dict[int, list[Candidate]] = defaultdict(list)
    for layout, mode in ((False, "plain"), (True, "layout")):
        try:
            pages = [probe.utf8_safe(page) for page in base.pdf_pages(document, layout=layout)]
        except Exception:
            continue
        for candidate in parse_question_pages(pages, mode=mode):
            grouped[candidate.number].append(candidate)
    return {number: max(items, key=lambda item: item.score) for number, items in grouped.items()}


def language_context(line: str) -> str | None:
    value = norm(line)
    if "lingua inglesa" in value or re.search(r"\bingles\b", value):
        return "english"
    if "lingua espanhola" in value or re.search(r"\bespanhol\b", value):
        return "spanish"
    if "lingua francesa" in value or re.search(r"\bfrances\b", value):
        return "french"
    return None


def parse_key_text(text: str) -> dict:
    occurrences: dict[int, list[tuple[str | None, str | None]]] = defaultdict(list)
    active_language = None
    for raw in probe.utf8_safe(text).splitlines():
        line = compact(raw)
        if not line:
            continue
        marker = language_context(line)
        if marker:
            active_language = marker
        for number_text, token in KEY_PAIR_RE.findall(line.upper()):
            number = int(number_text)
            if not 1 <= number <= 150:
                continue
            value = None if token.upper() == "X" else token.upper()
            occurrences[number].append((active_language, value))

    answers: dict[int, str | None] = {}
    conflicts: list[int] = []
    for number, values in occurrences.items():
        english = [value for language, value in values if language == "english"]
        if english and len(set(english)) == 1:
            answers[number] = english[-1]
            continue
        unique = {value for _, value in values}
        if len(unique) == 1:
            answers[number] = next(iter(unique))
        else:
            conflicts.append(number)

    expected = max(occurrences, default=0)
    contiguous = 0
    for number in range(1, expected + 1):
        if number in answers:
            contiguous += 1
        else:
            break
    return {
        "answers": answers,
        "expectedMax": expected,
        "contiguous": contiguous,
        "conflicts": sorted(conflicts),
        "score": (contiguous, len(answers), expected),
    }


def key_status(document) -> str:
    value = norm(f"{document.leaf} {document.first_text}")
    if any(marker in value for marker in ("definitiv", "final", "oficial")):
        return "definitive"
    if any(marker in value for marker in ("preliminar", "provisor")):
        return "preliminary"
    return "unknown"


def parse_key_document(document) -> dict:
    best = None
    for layout in (True, False):
        try:
            text = "\n".join(base.pdf_pages(document, layout=layout))
        except Exception:
            continue
        payload = parse_key_text(text)
        payload["status"] = key_status(document)
        if best is None or payload["score"] > best["score"]:
            best = payload
    return best or {
        "answers": {}, "expectedMax": 0, "contiguous": 0, "conflicts": [],
        "status": "missing", "score": (0, 0, 0),
    }


def choose_exam(items: list[dict]) -> dict | None:
    return max(items, default=None, key=lambda item: (len(item["questions"]), item["document"].page_count))


def choose_key(items: list[dict]) -> dict | None:
    status = {"definitive": 2, "preliminary": 1, "unknown": 0, "missing": -1}
    return max(
        items,
        default=None,
        key=lambda item: (
            item["key"]["contiguous"], len(item["key"]["answers"]),
            item["key"]["expectedMax"], status[item["key"]["status"]],
        ),
    )


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


def process(profile_name: str, paths: list[Path]) -> tuple[list[dict], dict]:
    profile = PROFILES[profile_name]
    editions = []
    failures = []
    seen_packages = {}
    for path in paths:
        meta = probe.sidecar(path)
        title = str(meta.get("title") or path.stem)
        if contains_any(title, profile.get("package_deny", ())):
            continue
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
            year, term = edition(meta, path, documents)
            if year is None:
                failures.append({"archive": path.name, "exceptionType": "EditionMissing", "error": "could not determine edition"})
                continue

            exam_items = []
            key_items = []
            excluded = []
            for document in documents:
                doc_role = probe.classify_role(document.leaf, document.first_text)
                allowed = document_allowed(profile_name, profile, title, document)
                record = {
                    "archive": path.name,
                    "packageSha256": fingerprint,
                    "downloadId": meta.get("downloadId"),
                    "title": title,
                    "downloadUrl": meta.get("downloadUrl"),
                    "resolvedDownloadUrl": meta.get("resolvedDownloadUrl"),
                    "document": document,
                }
                if not allowed:
                    excluded.append({"member": document.member, "sha256": document.sha256, "role": doc_role, "reason": "profile-filter"})
                elif doc_role == "exam":
                    record["questions"] = parse_question_document(document)
                    exam_items.append(record)
                elif doc_role == "answer-key":
                    record["key"] = parse_key_document(document)
                    key_items.append(record)
                else:
                    excluded.append({"member": document.member, "sha256": document.sha256, "role": doc_role, "reason": "non-objective-document"})

            exam = choose_exam(exam_items)
            key = choose_key(key_items)
            qmap = exam["questions"] if exam else {}
            key_payload = key["key"] if key else {
                "answers": {}, "expectedMax": 0, "contiguous": 0,
                "conflicts": [], "status": "missing",
            }
            amap = key_payload["answers"]
            expected = key_payload["expectedMax"]
            if expected == 0 and qmap:
                expected = max(qmap)
            identities = list(range(1, expected + 1)) if expected else []

            questions = []
            missing_questions = []
            missing_answers = []
            incompatible = []
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
                    incompatible.append(number)
                    continue
                visual = bool(VISUAL_RE.search(candidate.statement))
                review += int(visual)
                ordered_letters = [letter for letter in LETTERS if letter in candidate.alternatives]
                questions.append({
                    "number": number,
                    "subject": "Conhecimentos gerais",
                    "statement": candidate.statement,
                    "alternatives": [{"id": letter, "text": candidate.alternatives[letter]} for letter in ordered_letters],
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
                issues.append("ambiguous-answer:" + ",".join(map(str, key_payload["conflicts"])))
            if missing_questions:
                issues.append("missing-questions:" + ",".join(map(str, missing_questions)))
            if missing_answers:
                issues.append("missing-answers:" + ",".join(map(str, missing_answers)))
            if incompatible:
                issues.append("answer-not-in-alternatives:" + ",".join(map(str, incompatible)))
            if key and key_payload["status"] != "definitive":
                issues.append(f"answer-key-status:{key_payload['status']}")

            mod = modality(profile_name, title)
            suffix = f"{year}-{term}" if term else str(year)
            if mod != "Vestibular regular":
                suffix += "-medicina"
            edition_id = f"{profile['prefix']}-{suffix}"
            unit = {
                "id": "objective",
                "label": "Prova objetiva",
                "expectedQuestions": expected,
                "extractedQuestions": len(questions),
                "missingIdentities": max(0, expected - len(questions)),
                "structurallyComplete": expected > 0 and len(questions) == expected,
                "answerKeyStatus": key_payload["status"] if key else "missing",
                "questionsNeedingReview": review,
                "visualDependencies": review,
                "examDocument": descriptor(exam["document"], exam) if exam else None,
                "answerKeyDocument": descriptor(key["document"], key) if key else None,
                "excludedDocuments": excluded,
                "issues": issues,
                "questions": questions,
            }
            editions.append({
                "providerId": PROVIDER_ID,
                "institution": profile["institution"],
                "modality": mod,
                "editionId": edition_id,
                "year": year,
                "term": term,
                "parserVersion": PARSER_VERSION,
                "rightsStatus": RIGHTS_STATUS,
                "source": {
                    "archive": path.name,
                    "packageSha256": fingerprint,
                    "downloadId": meta.get("downloadId"),
                    "title": title,
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
            failures.append({"archive": path.name, "exceptionType": type(error).__name__, "error": probe.utf8_safe(str(error))})

    # Mirrors can expose duplicate downloads for the same cycle (for example an exam-only
    # entry plus a combined exam/key package). We never cross-pair documents across packages;
    # instead retain the single package with the strongest independently valid coverage.
    by_edition: dict[str, list[dict]] = defaultdict(list)
    for item in editions:
        by_edition[item["editionId"]].append(item)
    editions = [
        max(
            items,
            key=lambda item: (
                item["summary"]["completeUnits"],
                item["summary"]["extractedQuestions"],
                item["summary"]["expectedQuestions"],
                item["source"].get("downloadId") or 0,
            ),
        )
        for items in by_edition.values()
    ]
    editions.sort(key=lambda item: (item["year"], item.get("term") or 0, item["modality"], item["source"].get("downloadId") or 0))
    summary = {
        "version": 1,
        "parserVersion": PARSER_VERSION,
        "providerId": PROVIDER_ID,
        "institution": profile["institution"],
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
    text = json.dumps(probe.utf8_safe(value), ensure_ascii=False, indent=2) + "\n"
    text.encode("utf-8")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely ingest deterministic objective exams from high-volume Brasil Escola mirrors.")
    parser.add_argument("--profile", choices=sorted(PROFILES), required=True)
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    profile = PROFILES[args.profile]
    paths = profile_input(profile, args.input)
    editions, summary = process(args.profile, paths)
    output = Path(args.output)
    for item in editions:
        target = output / profile["prefix"] / item["editionId"].removeprefix(profile["prefix"] + "-") / "bundle.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json_text(item), encoding="utf-8")
    output.mkdir(parents=True, exist_ok=True)
    (output / f"{profile['prefix']}-summary.json").write_text(json_text(summary), encoding="utf-8")
    print(json.dumps(probe.utf8_safe(summary), ensure_ascii=False, indent=2))
    return 1 if summary["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
