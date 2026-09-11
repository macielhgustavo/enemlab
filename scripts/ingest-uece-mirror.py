#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import re
import shutil
import subprocess
import sys
from pathlib import Path

CORE_SCRIPT = Path(__file__).resolve().with_name("ingest-uece-inbox.py")
spec = importlib.util.spec_from_file_location("ingest_uece_inbox_core", CORE_SCRIPT)
assert spec and spec.loader
core = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = core
spec.loader.exec_module(core)

core.PARSER_VERSION = "inbox-uece@0.5.0"
SUPPORTED = {".zip", ".pdf", ".rar", ".7z"}
COMPRESSED = {".rar", ".7z"}
MAX_COMPRESSED_PDF = 64 * 1024 * 1024
MAX_COMPRESSED_TOTAL = 512 * 1024 * 1024
STRUCTURAL_EXAMS: set[str] = set()
STRUCTURAL_EXPECTED: dict[str, int] = {}


def inputs(values):
    output = []
    for raw in values or [f".ingestion-inbox/brasil-escola/nordeste/{core.UECE_SLUG}"]:
        path = Path(raw)
        if path.is_dir():
            output.extend(sorted(item for item in path.rglob("*") if item.is_file() and item.suffix.lower() in SUPPORTED))
        elif path.is_file() and path.suffix.lower() in SUPPORTED:
            output.append(path)
        elif not path.exists():
            raise ValueError(f"input not found: {path}")
    return sorted(dict.fromkeys(output))


def expected(document):
    cached = STRUCTURAL_EXPECTED.get(getattr(document, "sha256", ""))
    original = core._original_expected(document)
    if cached is None:
        return original
    if original is None:
        return cached
    return max(original, cached)


def is_exam(document):
    if getattr(document, "sha256", None) in STRUCTURAL_EXAMS:
        return True
    text = core.norm(document.first_text)
    leaf = core.norm(document.leaf)
    if core.phase(document.first_text, 2) and not core.phase(document.first_text, 1):
        return False
    key_only = (
        "gabarito" in leaf
        or "grade definitiva de respostas" in text
        or "grade preliminar de respostas" in text
        or (
            document.page_count <= 5
            and "gabarito" in text
            and "caderno de prova" not in text
            and "questao" not in text
        )
    )
    structural = bool(
        expected(document)
        and document.page_count >= 8
        and ("vestibular" in text or "uece" in text or "universidade estadual do ceara" in text)
    )
    labelled = core.phase(document.first_text, 1) and any(
        marker in text
        for marker in ("prova de conhecimentos gerais", "conhecimentos gerais", "caderno de prova")
    )
    return (labelled or structural) and not key_only


def _language_context(lines, index):
    context = core.norm(" ".join(lines[max(0, index - 10) : index + 2]))
    if "lingua inglesa" in context or re.search(r"\bingles\b", context):
        return "english"
    if "lingua francesa" in context or re.search(r"\bfrances\b", context):
        return "french"
    if "lingua espanhola" in context or re.search(r"\bespanhol\b", context):
        return "spanish"
    return None


def _parse_key_block(lines, expected_count):
    answers = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        pairs = re.findall(r"(?<!\d)(\d{1,3})\s*[-.:=)]?\s*([A-DX])(?![A-Z])", line.upper())
        if len(pairs) >= 2:
            for raw_number, token in pairs:
                number = int(raw_number)
                if 1 <= number <= (expected_count or 120):
                    answers[number] = None if token == "X" else token
            i += 1
            continue
        numbers = core.number_tokens(line)
        if len(numbers) < 4:
            i += 1
            continue
        tokens = []
        j = i + 1
        while j < len(lines) and len(tokens) < len(numbers) and j <= i + 4:
            if len(core.number_tokens(lines[j])) >= 4 and not tokens:
                break
            tokens.extend(core.answer_tokens(lines[j]))
            j += 1
        if len(tokens) >= len(numbers):
            for number, token in zip(numbers, tokens):
                if expected_count is None or number <= expected_count:
                    answers[number] = None if token == "X" else token
            i = j
        else:
            i += 1
    return answers


_TABLE_ROW = re.compile(
    r"(?:^|\s)(\d{1,3})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]*?)\s+"
    r"([A-DX])\s+([A-DX])\s+([A-DX])\s+([A-DX])"
    r"(?=\s+\d{1,3}\s+[A-Za-zÀ-ÿ]|\s*$)",
    re.I,
)


def _tabular_key(text, expected_count):
    regular: dict[int, str | None] = {}
    languages: dict[str, dict[int, str | None]] = {"english": {}, "french": {}, "spanish": {}}
    for raw in text.splitlines():
        line = core.compact(raw)
        for match in _TABLE_ROW.finditer(line):
            number = int(match.group(1))
            if number < 1 or number > (expected_count or 120):
                continue
            subject = core.norm(match.group(2))
            token = match.group(3).upper()
            value = None if token == "X" else token
            if "lingua inglesa" in subject or "ingles" in subject:
                languages["english"][number] = value
            elif "lingua francesa" in subject or "frances" in subject:
                languages["french"][number] = value
            elif "lingua espanhola" in subject or "espanhol" in subject:
                languages["spanish"][number] = value
            else:
                regular[number] = value
    output = dict(regular)
    output.update(languages["english"])
    return output


def parse_key_text(text, expected_count=None):
    table = _tabular_key(text, expected_count)
    if table and (expected_count is None or len(table) == expected_count):
        return table
    original = core._original_parse_key_text(text, expected_count)
    if original and (expected_count is None or len(original) == expected_count):
        return original

    lines = [core.compact(line) for line in text.splitlines() if core.compact(line)]
    normalized = [core.norm(line) for line in lines]
    starts = []
    for index, line in enumerate(normalized):
        values = [int(match.group(1)) for match in core.KEY_HEAD.finditer(line)]
        if 1 in values:
            starts.append(index)

    candidates = []
    for start in starts:
        end = len(lines)
        for index in range(start + 1, len(lines)):
            values = [int(match.group(1)) for match in core.KEY_HEAD.finditer(normalized[index])]
            if values and any(value != 1 for value in values):
                end = index
                break
            if index > start + 1:
                language = _language_context(lines, index)
                if language and core.KEY_HEAD.search(normalized[index]):
                    end = index
                    break
        answers = _parse_key_block(lines[start + 1 : end], expected_count)
        candidates.append((_language_context(lines, start), answers))

    english = [answers for language, answers in candidates if language == "english"]
    if english:
        best = max(english, key=len)
        if expected_count is None or len(best) >= min(expected_count, 80):
            return best
    complete = [answers for _, answers in candidates if expected_count is not None and len(answers) == expected_count]
    if len(complete) == 1:
        return complete[0]
    if len(candidates) == 1 and candidates[0][1]:
        return candidates[0][1]
    return max((table, original), key=len) if (table or original) else {}


def parse_key(document, expected_count):
    answers, status = core._original_parse_key(document, expected_count)
    if expected_count is not None and len(answers) == expected_count:
        return answers, status
    try:
        layout_text = "\n".join(core.base.pdf_pages(document, layout=True))
        layout_answers = parse_key_text(layout_text, expected_count)
        if len(layout_answers) > len(answers):
            answers = layout_answers
    except Exception:
        pass
    return answers, status


def _compressed_tool():
    return shutil.which("7zz") or shutil.which("7z")


def _compressed_members(path: Path, executable: str):
    result = subprocess.run([executable, "l", "-slt", "-ba", str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30, check=False)
    if result.returncode != 0:
        raise ValueError(f"compressed archive listing failed: {result.stderr.strip()[:240]}")
    members = []
    current = {}
    for raw in result.stdout.splitlines() + [""]:
        line = raw.strip()
        if not line:
            if current.get("Path") and current.get("Size") is not None:
                try:
                    size = int(current["Size"])
                except ValueError:
                    size = -1
                name = current["Path"]
                if name.lower().endswith(".pdf") and 0 <= size <= MAX_COMPRESSED_PDF:
                    members.append((name, size))
            current = {}
            continue
        if " = " in line:
            key, value = line.split(" = ", 1)
            current[key] = value
    if sum(size for _, size in members) > MAX_COMPRESSED_TOTAL:
        raise ValueError("compressed PDF total exceeds safety limit")
    return members


def _load_compressed(path: Path):
    executable = _compressed_tool()
    if executable is None:
        return None
    documents = []
    for member, expected_size in _compressed_members(path, executable):
        result = subprocess.run([executable, "x", "-so", str(path), member], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60, check=False)
        if result.returncode != 0:
            continue
        data = result.stdout
        if len(data) > MAX_COMPRESSED_PDF or not data.startswith(b"%PDF"):
            continue
        if expected_size and abs(len(data) - expected_size) > 4096:
            continue
        documents.append(core.base.PdfDocument(archive=path.name, member=member, leaf=Path(member).name, bytes=data, sha256=core.base.sha256(data), size=len(data)))
    return documents


def load_documents(path: Path):
    suffix = path.suffix.lower()
    if suffix == ".zip":
        return core.base.load_documents([path])
    if suffix == ".pdf":
        data = path.read_bytes()
        return [core.base.PdfDocument(archive=path.name, member=path.name, leaf=path.name, bytes=data, sha256=core.base.sha256(data), size=len(data))]
    if suffix in COMPRESSED:
        return _load_compressed(path)
    return []


def source_info(source, *, reason: str | None = None):
    data = source.path.read_bytes()
    payload = {"name": source.path.name, "sha256": core.base.sha256(data), "bytes": len(data), "downloadId": source.meta.get("downloadId"), "title": source.title, "downloadUrl": source.meta.get("downloadUrl"), "resolvedDownloadUrl": source.meta.get("resolvedDownloadUrl"), "detectedFormat": source.meta.get("detectedFormat") or source.path.suffix.lower().removeprefix(".")}
    if reason:
        payload["reason"] = reason
    return payload


def _source_variant(source):
    value = core.norm(" ".join((source.title, str(source.path))))
    if re.search(r"\bead\b", value):
        return "ead"
    if re.search(r"\bmusica\b", value):
        return "music"
    return "regular"


def _infer_structural_expected(document):
    if document.page_count < 8 or core.is_key(document):
        return None
    try:
        candidates = core.doc_candidates(document)
    except Exception:
        return None
    numbers = {item.number for item in candidates if item.complete and 1 <= item.number <= 120}
    if len(numbers) < 30:
        return None
    for candidate_max in range(min(max(numbers), 120), 29, -1):
        coverage = sum(number in numbers for number in range(1, candidate_max + 1)) / candidate_max
        if coverage >= 0.90:
            return candidate_max
    return None


def scan(source):
    if not core.is_uece(source):
        return [], {"archive": source.path.name, "reason": "not-uece"}, None
    variant = _source_variant(source)
    if variant != "regular":
        return [], source_info(source, reason=f"non-regular-uece-variant:{variant}"), None
    if source.path.suffix.lower() in COMPRESSED and _compressed_tool() is None:
        return [], source_info(source, reason="compressed-format-staged:7z-unavailable"), None
    try:
        documents = load_documents(source.path)
        if documents is None:
            return [], source_info(source, reason="compressed-format-staged:7z-unavailable"), None
        core.base.hydrate_pdf_metadata(documents)
    except Exception as error:
        return [], {}, str(error)

    relevant = []
    for document in documents:
        accepted_key = core.is_key(document)
        inferred = None if accepted_key else _infer_structural_expected(document)
        if inferred is not None:
            STRUCTURAL_EXPECTED[document.sha256] = inferred
        accepted_exam = core.is_exam(document)
        if not accepted_exam and inferred is not None:
            STRUCTURAL_EXAMS.add(document.sha256)
            accepted_exam = True
        if accepted_exam or accepted_key:
            detected_cycle = core.cycle(document.first_text, source)
            if all(detected_cycle):
                relevant.append((detected_cycle, document))
    if not relevant:
        return [], source_info(source, reason="no-first-phase-objective-documents"), None
    return relevant, source_info(source), None


core._original_expected = core.expected
core._original_parse_key_text = core.parse_key_text
core._original_parse_key = core.parse_key
core.inputs = inputs
core.expected = expected
core.is_exam = is_exam
core.parse_key_text = parse_key_text
core.parse_key = parse_key
core.scan = scan

if __name__ == "__main__":
    raise SystemExit(core.main())
