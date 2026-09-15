#!/usr/bin/env python3
"""Mass Ingestion 2 — The Sparky Edition.

Descobre pacotes públicos de provas/gabaritos já redistribuídos, extrai somente
metadados e respostas factuais e gera providers reference-only. Nenhum
enunciado é copiado para o repositório.

A promoção é fail-closed: só entra edição com gabarito completo, contíguo,
objetivo e de resposta única A-D/A-E. Somatório, blocos conflitantes,
preliminares, PDFs sem camada de texto e pacotes ambíguos são recusados.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import ssl
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/lib/providers/mass2/answer-keys.generated.json"
PARSER_VERSION = "mass2-sparky@1.0.0"
FETCHED_AT = "2026-09-15"
MIN_ACCEPTED_EDITIONS = 150
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36 ENEMLab/1.0"
)


class IngestionError(ValueError):
    pass


@dataclass(frozen=True)
class SourceSpec:
    id: str
    institution: str
    archive_url: str
    phase: str
    option_ids: tuple[str, ...]
    min_questions: int
    max_questions: int = 120
    duplicate_policy: str = "reject"


@dataclass(frozen=True)
class Candidate:
    spec: SourceSpec
    title: str
    download_url: str
    edition: str
    year: int


@dataclass(frozen=True)
class PdfMember:
    name: str
    data: bytes
    text: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


SOURCES = [
    SourceSpec(
        "ufpr",
        "UFPR",
        "https://vestibular.brasilescola.uol.com.br/downloads/universidade-federal-parana.htm",
        "first",
        ("A", "B", "C", "D", "E"),
        50,
    ),
    SourceSpec(
        "uece",
        "UECE/CEV",
        "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-ceara.htm",
        "first",
        ("A", "B", "C", "D"),
        60,
    ),
    SourceSpec(
        "uerj",
        "UERJ",
        "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estado-rio-janeiro-1.htm",
        "first",
        ("A", "B", "C", "D"),
        50,
    ),
    SourceSpec(
        "cederj",
        "CEDERJ/CECIERJ",
        "https://vestibular.brasilescola.uol.com.br/downloads/centro-ciencias-educacao-superior-distancia-estado-.htm",
        "single",
        ("A", "B", "C", "D"),
        35,
        duplicate_policy="last",
    ),
    SourceSpec(
        "puc-rio",
        "PUC-Rio",
        "https://vestibular.brasilescola.uol.com.br/downloads/pontificia-universidade-catolica-rio-janeiro.htm",
        "single",
        ("A", "B", "C", "D", "E"),
        35,
    ),
    SourceSpec(
        "ufrgs",
        "UFRGS",
        "https://vestibular.brasilescola.uol.com.br/downloads/universidade-federal-rio-grande-sul.htm",
        "single",
        ("A", "B", "C", "D", "E"),
        50,
    ),
    SourceSpec(
        "unicentro",
        "UNICENTRO",
        "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-centrooeste.htm",
        "single",
        ("A", "B", "C", "D", "E"),
        35,
    ),
    SourceSpec(
        "uemg",
        "UEMG",
        "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estado-minas-gerais.htm",
        "single",
        ("A", "B", "C", "D", "E"),
        35,
    ),
    SourceSpec(
        "unespar",
        "UNESPAR",
        "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-parana.htm",
        "single",
        ("A", "B", "C", "D", "E"),
        35,
    ),
]

COMMON_EXCLUDES = (
    "DISCURS",
    "2A FASE",
    "2 FASE",
    "SEGUNDA FASE",
    "EAD",
    "UAB",
    "PAC ",
    " PAS ",
    "INDIGEN",
    "MUSICA",
    " THE ",
    "LIBRAS",
    "FUNAI",
    "LECAMPO",
    "SIMULADO",
    "VAGAS REMANESCENTES",
)


def ascii_upper(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().upper()


def compact_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def strip_tags(value: str) -> str:
    return compact_spaces(html.unescape(re.sub(r"<[^>]+>", " ", value)))


def request_bytes(url: str, referer: str | None = None) -> bytes:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
    }
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, context=ssl.create_default_context(), timeout=90) as response:
        return response.read()


def request_text(url: str) -> str:
    return request_bytes(url).decode("utf-8", "replace")


def relevant_title(spec: SourceSpec, title: str) -> bool:
    normalized = f" {ascii_upper(title)} "
    if not re.search(r"\b20\d{2}\b", normalized):
        return False
    if any(term in normalized for term in COMMON_EXCLUDES):
        return False
    if spec.id == "ufpr" and "LITORAL" in normalized:
        return False
    if spec.id == "uece" and ("EHE" in normalized or "CANCELADA" in normalized):
        return False
    if spec.id == "uerj":
        years = [int(year) for year in re.findall(r"\b(20\d{2})\b", normalized)]
        year = max(years) if years else 0
        if year <= 2020 and "QUALIFIC" not in normalized and " EQ " not in normalized:
            return False
    if spec.id == "ufrgs" and "REDACAO E GABARITOS" in normalized:
        return False
    if spec.id == "unicentro" and "PAC" in normalized:
        return False
    if spec.id == "uemg" and not ("PROVA" in normalized and "GABARITO" in normalized):
        return False
    return True


def edition_identity(spec: SourceSpec, title: str) -> tuple[str, int]:
    normalized = ascii_upper(title)
    years = [int(year) for year in re.findall(r"\b(20\d{2})\b", normalized)]
    if not years:
        raise IngestionError("ano ausente")
    year = max(years)

    if spec.id == "uerj":
        if re.search(r"(?:1O|1º|1°|1\s*)\s*(?:EXAME\s+DE\s+QUALIFICACAO|EQ)\b", normalized):
            return f"{year}-eq1", year
        if re.search(r"(?:2O|2º|2°|2\s*)\s*(?:EXAME\s+DE\s+QUALIFICACAO|EQ)\b", normalized):
            return f"{year}-eq2", year
        return str(year), year

    explicit = re.search(rf"\b{year}\s*[/.-]\s*([12])\b", normalized)
    if explicit:
        return f"{year}.{explicit.group(1)}", year
    if "MEIO DE ANO" in normalized or "INVERNO" in normalized:
        return f"{year}.2", year
    if "VERAO" in normalized:
        return f"{year}.1", year
    if "PRIMAVERA" in normalized:
        return f"{year}-primavera", year
    return str(year), year


def discover_candidates(spec: SourceSpec) -> list[Candidate]:
    page = request_text(spec.archive_url)
    pattern = re.compile(
        r"<a\b[^>]*href=[\"']([^\"']*/baixar/\d+)[\"'][^>]*>(.*?)</a>",
        re.IGNORECASE | re.DOTALL,
    )
    found: dict[str, Candidate] = {}
    for href, body in pattern.findall(page):
        title = strip_tags(body)
        if not relevant_title(spec, title):
            continue
        try:
            edition, year = edition_identity(spec, title)
        except IngestionError:
            continue
        url = urllib.parse.urljoin(spec.archive_url, html.unescape(href))
        candidate = Candidate(spec, title, url, edition, year)
        previous = found.get(edition)
        if previous is None or len(title) > len(previous.title):
            found[edition] = candidate
    return sorted(found.values(), key=lambda item: (item.year, item.edition), reverse=True)


def pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise IngestionError("pypdf ausente") from exc
    try:
        reader = PdfReader(BytesIO(data.lstrip()))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:  # pragma: no cover - depende do PDF remoto
        raise IngestionError(f"PDF ilegível: {exc}") from exc
    if not text.strip():
        raise IngestionError("PDF sem camada de texto")
    return text


def package_pdfs(candidate: Candidate) -> list[PdfMember]:
    data = request_bytes(candidate.download_url, referer=candidate.spec.archive_url)
    if data.lstrip().startswith(b"%PDF"):
        return [PdfMember("download.pdf", data, pdf_text(data))]
    if not data.startswith(b"PK"):
        raise IngestionError("download não é PDF nem ZIP")
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise IngestionError("ZIP inválido") from exc
    members: list[PdfMember] = []
    for info in archive.infolist():
        if info.is_dir() or not info.filename.lower().endswith(".pdf"):
            continue
        raw = archive.read(info)
        try:
            text = pdf_text(raw)
        except IngestionError:
            continue
        members.append(PdfMember(info.filename, raw, text))
    if not members:
        raise IngestionError("pacote sem PDF legível")
    return members


def answer_member_score(member: PdfMember) -> int:
    name = ascii_upper(member.name)
    head = ascii_upper(member.text[:5000])
    score = 0
    if "GABARITO" in name:
        score += 10
    if "RESPOST" in name:
        score += 5
    if "GABARITO" in head:
        score += 4
    if "RESPOST" in head:
        score += 2
    if "PRELIMINAR" in name or "PROVISOR" in name:
        score -= 20
    return score


def normalize_answer(token: str) -> str | None:
    value = ascii_upper(token).strip(" .:-()[]")
    if value in {"X", "*", "ANULADA", "ANULADO"}:
        return None
    if value not in {"A", "B", "C", "D", "E"}:
        raise IngestionError(f"resposta inválida: {token}")
    return value


def row_pairs(text: str) -> list[tuple[int, str | None]]:
    pairs: list[tuple[int, str | None]] = []
    lines = [compact_spaces(ascii_upper(line)) for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        direct = re.findall(
            r"(?<!\d)(\d{1,3})\s*(?:[-.:)–—]|\s)\s*(ANULAD[AO]|[A-E]|X|\*)\b",
            line,
        )
        pairs.extend((int(number), normalize_answer(answer)) for number, answer in direct)

        if index + 1 >= len(lines):
            continue
        numbers = re.findall(r"(?<!\d)(\d{1,3})(?!\d)", line)
        answers = re.findall(r"\b(?:ANULAD[AO]|[A-E]|X)\b|\*", lines[index + 1])
        if 4 <= len(numbers) == len(answers) <= 30:
            pairs.extend((int(number), normalize_answer(answer)) for number, answer in zip(numbers, answers))

        tokens = re.findall(r"\b\d{1,3}\b|\b(?:ANULAD[AO]|[A-E]|X)\b|\*", line)
        if len(tokens) >= 8 and len(tokens) % 2 == 0:
            half = len(tokens) // 2
            if all(token.isdigit() for token in tokens[:half]) and all(not token.isdigit() for token in tokens[half:]):
                pairs.extend(
                    (int(number), normalize_answer(answer))
                    for number, answer in zip(tokens[:half], tokens[half:])
                )
    return pairs


def contiguous_map(
    pairs: list[tuple[int, str | None]],
    spec: SourceSpec,
) -> tuple[dict[str, str], list[int], int] | None:
    by_number: dict[int, list[str | None]] = {}
    for number, answer in pairs:
        if 1 <= number <= spec.max_questions:
            by_number.setdefault(number, []).append(answer)
    if not by_number:
        return None

    total = 0
    for number in range(1, spec.max_questions + 1):
        if number not in by_number:
            break
        total = number
    if total < spec.min_questions:
        return None

    answers: dict[str, str] = {}
    annulled: list[int] = []
    for number in range(1, total + 1):
        values = by_number[number]
        unique = []
        for value in values:
            if value not in unique:
                unique.append(value)
        if len(unique) > 1:
            if spec.duplicate_policy == "last":
                chosen = values[-1]
            elif spec.duplicate_policy == "first":
                chosen = values[0]
            else:
                return None
        else:
            chosen = unique[0]
        if chosen is None:
            annulled.append(number)
        else:
            if chosen not in spec.option_ids:
                return None
            answers[str(number)] = chosen

    return answers, annulled, total


def parse_answer_key(member: PdfMember, spec: SourceSpec) -> tuple[dict[str, str], list[int], int]:
    normalized = ascii_upper(member.text)
    head = normalized[:6000]
    if "PRELIMINAR" in head or "PROVISORIO" in head:
        raise IngestionError("gabarito preliminar/provisório")
    forbidden = (
        "SOMATORIO",
        "SOMATORIA",
        "SOMA DAS ALTERNATIVAS",
        "SOMA DAS PROPOSICOES",
        "ITENS CERTOS",
        "CERTO OU ERRADO",
    )
    if any(marker in normalized for marker in forbidden):
        raise IngestionError("formato não é resposta única")

    sections = [normalized]
    positions = [match.start() for match in re.finditer(r"GABARITO", normalized)]
    sections.extend(normalized[position:] for position in positions[:8])

    parsed: list[tuple[dict[str, str], list[int], int]] = []
    for section in sections:
        candidate = contiguous_map(row_pairs(section), spec)
        if candidate is not None:
            parsed.append(candidate)
    if not parsed:
        raise IngestionError("não foi possível extrair gabarito completo")

    max_total = max(item[2] for item in parsed)
    best = [item for item in parsed if item[2] == max_total]
    signatures = {
        json.dumps({"answers": item[0], "annulled": item[1]}, sort_keys=True)
        for item in best
    }
    if len(signatures) != 1:
        raise IngestionError("gabaritos conflitantes no mesmo documento")
    return best[0]


def pick_answer_key(
    members: list[PdfMember], spec: SourceSpec
) -> tuple[PdfMember, dict[str, str], list[int], int]:
    candidates = sorted(members, key=answer_member_score, reverse=True)
    successes: list[tuple[int, PdfMember, dict[str, str], list[int], int]] = []
    errors: list[str] = []
    for member in candidates:
        score = answer_member_score(member)
        if score <= 0 and successes:
            break
        try:
            answers, annulled, total = parse_answer_key(member, spec)
            successes.append((score, member, answers, annulled, total))
        except IngestionError as exc:
            errors.append(f"{member.name}: {exc}")

    if not successes:
        raise IngestionError("; ".join(errors[:3]) or "gabarito não encontrado")
    max_score = max(item[0] for item in successes)
    top = [item for item in successes if item[0] == max_score]
    max_total = max(item[4] for item in top)
    top = [item for item in top if item[4] == max_total]
    signatures = {
        json.dumps({"answers": item[2], "annulled": item[3]}, sort_keys=True)
        for item in top
    }
    if len(signatures) != 1:
        raise IngestionError("pacote contém mais de um gabarito canônico possível")
    _, member, answers, annulled, total = top[0]
    return member, answers, annulled, total


def option_ids_for(candidate: Candidate) -> list[str]:
    if candidate.spec.id == "ufpr" and candidate.year >= 2026:
        return ["A", "B", "C", "D"]
    return list(candidate.spec.option_ids)


def process_candidate(candidate: Candidate) -> tuple[str, dict[str, object]]:
    members = package_pdfs(candidate)
    member, answers, annulled, total = pick_answer_key(members, candidate.spec)
    option_ids = option_ids_for(candidate)
    if any(answer not in option_ids for answer in answers.values()):
        raise IngestionError("gabarito usa alternativa fora do modelo da edição")

    revision = "final"
    phase = candidate.spec.phase
    entry = {
        "edition": candidate.edition,
        "year": candidate.year,
        "label": f"{candidate.spec.id.upper()} {candidate.edition}",
        "phase": phase,
        "total": total,
        "canonicalVariant": "redistributed",
        "variantRelation": "unknown",
        "revision": revision,
        "answers": answers,
        "annulled": annulled,
        "optionIds": option_ids,
        "officialDocument": False,
        "variants": [
            {
                "id": "redistributed",
                "label": "Pacote público redistribuído",
                "examUrl": candidate.download_url,
                "answerKeyUrl": candidate.download_url,
            }
        ],
        "answerKeyUrl": candidate.download_url,
        "examUrl": candidate.download_url,
        "archivePage": candidate.spec.archive_url,
        "subjects": [
            {
                "id": "conhecimentos-gerais",
                "label": "Conhecimentos gerais",
                "area": "conhecimentos-gerais",
                "range": [1, total],
            }
        ],
        "contentMode": "reference-only",
        "rightsStatus": "permission-required",
        "validationLevel": "verified",
        "validationEvidence": [
            "índice público de provas/gabaritos usado somente como referência; enunciados não são copiados",
            f"gabarito extraído de {member.name}",
            f"cobertura objetiva completa 1..{total}; uma alternativa por questão não anulada",
            f"SHA-256 do PDF de gabarito: {member.sha256}",
        ],
        "retrieval": {
            "originalUrl": candidate.download_url,
            "effectiveSourceUrl": candidate.download_url,
            "sourceType": "pdf-reference",
            "fetchedAt": FETCHED_AT,
            "sha256": member.sha256,
            "bytes": len(member.data),
            "parserVersion": PARSER_VERSION,
            "revision": revision,
            "final": True,
        },
        "parserVersion": PARSER_VERSION,
    }
    return f"{candidate.spec.id}:{candidate.edition}:{phase}", entry


def collect(max_workers: int = 6) -> tuple[dict[str, dict[str, object]], list[str]]:
    result: dict[str, dict[str, object]] = {spec.id: {} for spec in SOURCES}
    candidates: list[Candidate] = []
    for spec in SOURCES:
        discovered = discover_candidates(spec)
        print(f"{spec.id}: {len(discovered)} candidato(s) descobertos", file=sys.stderr)
        candidates.extend(discovered)

    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(process_candidate, candidate): candidate for candidate in candidates}
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                key, entry = future.result()
            except Exception as exc:  # noqa: BLE001 - relatório por edição
                failures.append(f"{candidate.spec.id} {candidate.edition}: {exc}")
                continue
            result[candidate.spec.id][key] = entry
            print(
                f"aceita {candidate.spec.id} {candidate.edition}: {entry['total']} questões",
                file=sys.stderr,
            )

    return result, sorted(failures)


def accepted_count(data: dict[str, dict[str, object]]) -> int:
    return sum(len(entries) for entries in data.values())


def write_output(data: dict[str, dict[str, object]]) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--min-editions", type=int, default=MIN_ACCEPTED_EDITIONS)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    data, failures = collect(max_workers=args.workers)
    total = accepted_count(data)
    by_provider = {provider: len(entries) for provider, entries in data.items()}
    report = {
        "accepted": total,
        "minimum": args.min_editions,
        "byProvider": by_provider,
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if total < args.min_editions:
        print(
            f"Mass2 recusada: {total} edições válidas; mínimo exigido = {args.min_editions}",
            file=sys.stderr,
        )
        return 2
    if args.write:
        write_output(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
