#!/usr/bin/env python3
"""Coletor QConcursos da Mass Ingestion 2 (somente vestibulares).

Usa a listagem pública de provas como índice de pacotes já redistribuídos e
persiste apenas metadados + gabarito factual. Não copia enunciados nem PDFs.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from ingest_mass2_sparky import (  # noqa: E402
    FETCHED_AT,
    MIN_ACCEPTED_EDITIONS,
    OUTPUT,
    PARSER_VERSION,
    IngestionError,
    PdfMember,
    SourceSpec,
    ascii_upper,
    compact_spaces,
    contiguous_map,
    pdf_text,
    request_bytes,
    row_pairs,
)

QC_BASE = "https://www.qconcursos.com"
QC_PROOFS = f"{QC_BASE}/questoes-de-vestibular/provas"
QC_PARSER_VERSION = f"{PARSER_VERSION}+qconcursos"


@dataclass(frozen=True)
class QSource:
    spec: SourceSpec
    filter_query: str
    title_markers: tuple[str, ...]
    max_pages: int = 20


@dataclass(frozen=True)
class QCandidate:
    source: QSource
    title: str
    page_url: str
    edition: str
    year: int
    phase: str


SOURCES = [
    QSource(
        SourceSpec("ufpr", "UFPR", "", "first", ("A", "B", "C", "D", "E"), 50, 120),
        "institute_ids%5B%5D=6029",
        ("UFPR",),
    ),
    QSource(
        SourceSpec("uece", "UECE/CEV", "", "first", ("A", "B", "C", "D"), 60, 100),
        "institute_ids%5B%5D=6221",
        ("UECE",),
        25,
    ),
    QSource(
        SourceSpec("uerj", "UERJ", "", "first", ("A", "B", "C", "D"), 40, 100),
        "institute_ids%5B%5D=6207",
        ("UERJ",),
        25,
    ),
    QSource(
        SourceSpec("cederj", "CEDERJ/CECIERJ", "", "single", ("A", "B", "C", "D"), 35, 100, "last"),
        "institute_ids%5B%5D=6212",
        ("CEDERJ", "CECIERJ"),
        25,
    ),
    QSource(
        SourceSpec("uemg", "UEMG", "", "single", ("A", "B", "C", "D"), 35, 100),
        "institute_ids%5B%5D=6208",
        ("UEMG",),
        20,
    ),
    QSource(
        SourceSpec("ufrgs", "UFRGS", "", "single", ("A", "B", "C", "D", "E"), 20, 100),
        "institute_ids%5B%5D=6720",
        ("UFRGS",),
        25,
    ),
    QSource(
        SourceSpec("unespar", "UNESPAR", "", "single", ("A", "B", "C", "D", "E"), 30, 100),
        "examining_board_ids%5B%5D=860",
        ("UNESPAR",),
        20,
    ),
]


def strip_tags(value: str) -> str:
    return compact_spaces(html.unescape(re.sub(r"<[^>]+>", " ", value)))


def request_text(url: str) -> str:
    data = request_bytes(url, referer=QC_BASE)
    return data.decode("utf-8", "replace")


def title_is_objective(source: QSource, title: str) -> bool:
    normalized = f" {ascii_upper(title)} "
    if not all(any(marker in normalized for marker in (ascii_upper(item),)) for item in source.title_markers[:1]):
        return False
    forbidden = (
        " 2A FASE ",
        " 2ª FASE ",
        " SEGUNDA FASE ",
        " DISCURS",
        " REDACAO ",
        " ESPECIFICA",
        " HABILIDADE ESPECIFICA",
        " PAC ",
        " PAS ",
    )
    if any(marker in normalized for marker in forbidden):
        return False

    provider = source.spec.id
    if provider == "ufpr":
        # Só a prova geral de primeira fase, nunca matérias da segunda fase.
        return "1A FASE" in normalized or "1ª FASE" in normalized or "CONHECIMENTOS GERAIS" in normalized
    if provider == "uece":
        return "1A FASE" in normalized or "1ª FASE" in normalized or "CONHECIMENTOS GERAIS" in normalized
    if provider == "uerj":
        return any(marker in normalized for marker in ("PRIMEIRO EXAME", "SEGUNDO EXAME", "EXAME DE QUALIFICACAO", "EXAME UNICO"))
    if provider == "cederj":
        return "VESTIBULAR" in normalized
    if provider == "uemg":
        # Inglês é a variante canônica quando o site separa idioma.
        if "ESPANHOL" in normalized:
            return False
        return "VESTIBULAR" in normalized
    if provider == "ufrgs":
        return "VESTIBULAR" in normalized and "ESPANHOL" not in normalized
    if provider == "unespar":
        if "GRUPO 2" in normalized or "GRUPO II" in normalized:
            return False
        return "VESTIBULAR" in normalized
    return False


def edition_and_phase(source: QSource, title: str) -> tuple[str, int, str]:
    normalized = ascii_upper(title)
    years = [int(value) for value in re.findall(r"\b(20\d{2})\b", normalized)]
    if not years:
        raise IngestionError("ano ausente")
    logical_year = max(years)

    semester = re.search(
        r"\b([12])(?:O|º|°)?\s*SEMESTRE(?:\s+DE)?\s*(20\d{2})\b",
        normalized,
    )
    if semester:
        logical_year = int(semester.group(2))
        return f"{logical_year}.{semester.group(1)}", logical_year, source.spec.phase
    if "PRIMEIRO SEMESTRE" in normalized:
        return f"{logical_year}.1", logical_year, source.spec.phase
    if "SEGUNDO SEMESTRE" in normalized:
        return f"{logical_year}.2", logical_year, source.spec.phase

    if source.spec.id == "uerj":
        if "PRIMEIRO EXAME" in normalized or "1O EXAME" in normalized or "1º EXAME" in normalized:
            return f"{logical_year}-eq1", logical_year, "first"
        if "SEGUNDO EXAME" in normalized or "2O EXAME" in normalized or "2º EXAME" in normalized:
            return f"{logical_year}-eq2", logical_year, "first"
        return str(logical_year), logical_year, "first"

    if source.spec.id == "ufrgs":
        day = re.search(r"\b([12])(?:O|º|°)?\s*DIA\b", normalized)
        return str(logical_year), logical_year, f"day{day.group(1)}" if day else "single"

    return str(logical_year), logical_year, source.spec.phase


def proof_links(page_html: str) -> list[tuple[str, str]]:
    pattern = re.compile(
        r"<a\b[^>]*href=[\"']([^\"']*/questoes-de-vestibular/provas/[^\"'?#]+)[\"'][^>]*>(.*?)</a>",
        re.IGNORECASE | re.DOTALL,
    )
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for href, body in pattern.findall(page_html):
        url = urllib.parse.urljoin(QC_BASE, html.unescape(href))
        if url in seen:
            continue
        title = strip_tags(body)
        if not title:
            continue
        seen.add(url)
        found.append((url, title))
    return found


def discover(source: QSource) -> list[QCandidate]:
    candidates: dict[tuple[str, str], QCandidate] = {}
    previous_signature: tuple[str, ...] | None = None
    empty_pages = 0

    for page in range(1, source.max_pages + 1):
        url = f"{QC_PROOFS}?{source.filter_query}&page={page}"
        try:
            links = proof_links(request_text(url))
        except Exception as exc:  # noqa: BLE001
            print(f"{source.spec.id}: página {page} falhou: {exc}", file=sys.stderr)
            break
        signature = tuple(item[0] for item in links)
        if not links:
            empty_pages += 1
            if empty_pages >= 2:
                break
            continue
        if signature == previous_signature:
            break
        previous_signature = signature

        accepted_on_page = 0
        for page_url, title in links:
            if not title_is_objective(source, title):
                continue
            try:
                edition, year, phase = edition_and_phase(source, title)
            except IngestionError:
                continue
            key = (edition, phase)
            current = QCandidate(source, title, page_url, edition, year, phase)
            # Prefere título mais informativo se houver duplicata do mesmo bloco.
            if key not in candidates or len(title) > len(candidates[key].title):
                candidates[key] = current
            accepted_on_page += 1
        if accepted_on_page == 0 and page > 5:
            # Não encerra no primeiro zero, mas evita varrer dezenas de páginas
            # quando o filtro do site já saiu do conjunto relevante.
            empty_pages += 1
            if empty_pages >= 3:
                break
        else:
            empty_pages = 0

    return sorted(candidates.values(), key=lambda item: (item.year, item.edition, item.phase), reverse=True)


def direct_gabarito_url(detail_html: str) -> str:
    candidates = re.findall(
        r"href=[\"'](https://arquivos\.qconcursos\.com/prova/arquivo_gabarito/[^\"']+\.pdf)[\"']",
        detail_html,
        re.IGNORECASE,
    )
    if not candidates:
        # Alguns HTMLs usam URL escapada/relativa em atributo de download.
        decoded = html.unescape(detail_html).replace("\\/", "/")
        candidates = re.findall(
            r"https://arquivos\.qconcursos\.com/prova/arquivo_gabarito/[^\"'<>\\s]+\.pdf",
            decoded,
            re.IGNORECASE,
        )
    if not candidates:
        raise IngestionError("página sem PDF de gabarito redistribuído")
    return candidates[0]


def marked_pairs(text: str) -> list[tuple[int, str | None]]:
    lines = [compact_spaces(line) for line in text.splitlines() if line.strip()]
    out: list[tuple[int, str | None]] = []
    current: int | None = None
    for line in lines:
        normalized = ascii_upper(line)
        start = re.match(r"^\s*(\d{1,3})\s*[-.)]\s+", normalized)
        if start:
            current = int(start.group(1))
        if current is None:
            continue
        if "ANULAD" in normalized:
            out.append((current, None))
            current = None
            continue
        marked = re.search(r"(?:►|▶|▸|➤||>)\s*([A-E])\s*[).:-]", normalized)
        if marked:
            out.append((current, marked.group(1)))
            current = None
    return out


def parse_answer_pdf(member: PdfMember, spec: SourceSpec) -> tuple[dict[str, str], list[int], int]:
    name = ascii_upper(member.name)
    first_page = ascii_upper(member.text[:2500])
    if "PRELIMINAR" in name or "PROVISORIO" in name:
        raise IngestionError("gabarito preliminar/provisório")
    # Só considera o documento preliminar quando isso é o título do arquivo/
    # cabeçalho, não uma mera referência textual a recurso contra preliminar.
    if re.search(r"^.{0,250}\bGABARITO\s+(?:OFICIAL\s+)?(?:PRELIMINAR|PROVISORIO)\b", first_page, re.DOTALL):
        raise IngestionError("gabarito preliminar/provisório")

    forbidden = ("SOMATORIO", "SOMATORIA", "SOMA DAS PROPOSICOES", "CERTO OU ERRADO")
    if any(marker in ascii_upper(member.text) for marker in forbidden):
        raise IngestionError("formato incompatível com resposta única")

    pools = [row_pairs(member.text), marked_pairs(member.text)]
    valid = [contiguous_map(pairs, spec) for pairs in pools]
    valid = [item for item in valid if item is not None]
    if not valid:
        raise IngestionError("gabarito completo não reconhecido")
    total = max(item[2] for item in valid)
    best = [item for item in valid if item[2] == total]
    signatures = {json.dumps({"answers": item[0], "annulled": item[1]}, sort_keys=True) for item in best}
    if len(signatures) != 1:
        raise IngestionError("métodos de extração discordam")
    return best[0]


def process(candidate: QCandidate) -> tuple[str, dict[str, object]]:
    detail = request_text(candidate.page_url)
    answer_url = direct_gabarito_url(detail)
    raw = request_bytes(answer_url, referer=candidate.page_url)
    if not raw.lstrip().startswith(b"%PDF"):
        raise IngestionError("gabarito não é PDF")
    text = pdf_text(raw)
    member = PdfMember(answer_url.rsplit("/", 1)[-1], raw, text)
    answers, annulled, total = parse_answer_pdf(member, candidate.source.spec)

    option_ids = list(candidate.source.spec.option_ids)
    if candidate.source.spec.id == "ufpr" and candidate.year >= 2026:
        option_ids = ["A", "B", "C", "D"]
    if any(answer not in option_ids for answer in answers.values()):
        raise IngestionError("resposta fora do alfabeto da edição")

    provider = candidate.source.spec.id
    key = f"{provider}:{candidate.edition}:{candidate.phase}"
    entry = {
        "edition": candidate.edition,
        "year": candidate.year,
        "label": candidate.title,
        "phase": candidate.phase,
        "total": total,
        "canonicalVariant": "qconcursos-redistributed",
        "variantRelation": "unknown",
        "revision": "final",
        "answers": answers,
        "annulled": annulled,
        "optionIds": option_ids,
        "officialDocument": False,
        "variants": [
            {
                "id": "qconcursos-redistributed",
                "label": "PDF público redistribuído",
                "examUrl": candidate.page_url,
                "answerKeyUrl": answer_url,
            }
        ],
        "answerKeyUrl": answer_url,
        "examUrl": candidate.page_url,
        "archivePage": candidate.page_url,
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
            "QConcursos usado como índice público de prova/gabarito redistribuídos; enunciados não são copiados",
            f"gabarito objetivo completo 1..{total}; uma resposta por questão não anulada",
            f"SHA-256 do PDF de gabarito: {hashlib.sha256(raw).hexdigest()}",
        ],
        "retrieval": {
            "originalUrl": answer_url,
            "effectiveSourceUrl": answer_url,
            "sourceType": "pdf-reference",
            "fetchedAt": FETCHED_AT,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "parserVersion": QC_PARSER_VERSION,
            "revision": "final",
            "final": True,
        },
        "parserVersion": QC_PARSER_VERSION,
    }
    return key, entry


def collect(workers: int) -> tuple[dict[str, dict[str, object]], list[str], int]:
    output: dict[str, dict[str, object]] = {source.spec.id: {} for source in SOURCES}
    candidates: list[QCandidate] = []
    for source in SOURCES:
        discovered = discover(source)
        print(f"QC {source.spec.id}: {len(discovered)} candidato(s)", file=sys.stderr)
        candidates.extend(discovered)

    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, candidate): candidate for candidate in candidates}
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                key, entry = future.result()
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{candidate.source.spec.id} {candidate.edition}/{candidate.phase}: {exc}")
                continue
            output[candidate.source.spec.id][key] = entry
            print(
                f"QC aceita {candidate.source.spec.id} {candidate.edition}/{candidate.phase}: {entry['total']} questões",
                file=sys.stderr,
            )

    # Conta edições lógicas: múltiplos dias/fases da mesma edição contam uma vez.
    logical = sum(
        len({str(entry["edition"]) for entry in entries.values()})
        for entries in output.values()
    )
    return output, sorted(failures), logical


def merge_existing(generated: dict[str, dict[str, object]]) -> dict[str, dict[str, object]]:
    if not OUTPUT.exists():
        return generated
    try:
        current = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except Exception:
        return generated
    merged: dict[str, dict[str, object]] = {}
    for provider in set(current) | set(generated):
        merged[provider] = {**current.get(provider, {}), **generated.get(provider, {})}
    return merged


def logical_count(data: dict[str, dict[str, object]]) -> int:
    return sum(
        len({str(entry["edition"]) for entry in entries.values()})
        for entries in data.values()
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--min-editions", type=int, default=MIN_ACCEPTED_EDITIONS)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    generated, failures, discovered_logical = collect(args.workers)
    merged = merge_existing(generated)
    total = logical_count(merged)
    report = {
        "acceptedLogicalEditions": total,
        "acceptedThisPass": discovered_logical,
        "minimum": args.min_editions,
        "byProvider": {
            provider: len({str(entry["edition"]) for entry in entries.values()})
            for provider, entries in merged.items()
        },
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.write:
        OUTPUT.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if total < args.min_editions:
        print(f"Mass2 QC recusada: {total} edições lógicas; mínimo={args.min_editions}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
