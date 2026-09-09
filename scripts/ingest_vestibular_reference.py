#!/usr/bin/env python3
"""
Ingestão de vestibulares em modo referência para a v8.8.

Este script usa rede de propósito: baixa páginas/PDFs oficiais, extrai apenas
gabaritos objetivos A-E e grava manifests pequenos em `src/lib/providers/*`.
Os enunciados permanecem nas fontes oficiais.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import ssl
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Callable

RAIZ = Path(__file__).resolve().parents[1]
FETCHED_AT = "2026-09-08"
HTTP_HEADERS = {"User-Agent": "enemlab-v8.8-source-ingestion/1.0"}
LETTERS = {"A", "B", "C", "D", "E"}


class IngestionError(ValueError):
    pass


@dataclass(frozen=True)
class PdfDocument:
    url: str
    bytes: bytes
    text: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.bytes).hexdigest()

    @property
    def size(self) -> int:
        return len(self.bytes)


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(req, context=context, timeout=60) as response:
        data = response.read()
    if not data.lstrip().startswith(b"%PDF"):
        raise IngestionError(f"{url} não parece PDF")
    return data


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(req, context=context, timeout=60) as response:
        return response.read().decode("utf-8", "replace")


def fetch_pdf(url: str) -> PdfDocument:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise IngestionError("pypdf ausente. Rode: pip install pypdf") from exc

    data = fetch_bytes(url)
    reader = PdfReader(BytesIO(data.lstrip()))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    if not text.strip():
        raise IngestionError(f"{url} não tem camada de texto legível")
    return PdfDocument(url=url, bytes=data, text=text)


def normalize_answer(token: str) -> str | None:
    token = token.strip().upper()
    if token in {"*", "X", "ANULADA", "ANULADO"} or token.startswith("ANULADA"):
        return None
    if token not in LETTERS:
        raise IngestionError(f"alternativa inválida: {token}")
    return token


def validate_answers(
    answers: dict[str, str],
    annulled: list[int],
    total: int,
) -> None:
    problems: list[str] = []
    annulled_set = set(annulled)
    expected = set(range(1, total + 1))
    answered = {int(key) for key in answers}

    if answered | annulled_set != expected:
        missing = sorted(expected - answered - annulled_set)
        extra = sorted((answered | annulled_set) - expected)
        if missing:
            problems.append(f"faltantes: {missing}")
        if extra:
            problems.append(f"fora do intervalo: {extra}")
    if answered & annulled_set:
        problems.append(f"anuladas com resposta: {sorted(answered & annulled_set)}")
    for key, value in answers.items():
        if value not in LETTERS:
            problems.append(f"q{key}={value}")
    if len(annulled) != len(annulled_set):
        problems.append("anulada duplicada")
    if problems:
        raise IngestionError("; ".join(problems))


def parse_unicamp_answer_key(text: str, total: int = 72) -> tuple[dict[str, str], list[int]]:
    body = text.split("GABARITO DA PROVA", 1)[0]
    pairs = re.findall(r"\b0?([1-9][0-9]?|100)\s+([A-E]|\*)", body.upper())
    return pairs_to_answers(pairs, total)


def parse_uel_answer_key(text: str, total: int = 60) -> tuple[dict[str, str], list[int]]:
    if "GABARITO OFICIAL DEFINITIVO" not in text.upper():
        raise IngestionError("gabarito UEL não é definitivo")
    body = text.split("* Pontos atribuídos", 1)[0]
    pairs = []
    for line in body.splitlines():
        match = re.match(r"^\s*([1-9][0-9]?|60)\s+([A-E*])\s*$", line.upper())
        if match:
            pairs.append(match.groups())
    return pairs_to_answers(pairs, total)


def parse_pucsp_answer_key(text: str, total: int = 50) -> tuple[dict[str, str], list[int]]:
    if "VESTIBULAR PUC-SP" not in text.upper():
        raise IngestionError("documento não é gabarito PUC-SP")
    pairs = []
    for line in text.splitlines():
        match = re.match(r"^\s*([1-9][0-9]?|50)\s+(ANULADA(?:\s*\(\*\))?|[A-E])\s*$", line.upper())
        if match:
            pairs.append(match.groups())
    return pairs_to_answers(pairs, total)


def pairs_to_answers(pairs: list[tuple[str, str]], total: int) -> tuple[dict[str, str], list[int]]:
    answers: dict[str, str] = {}
    annulled: list[int] = []
    seen: set[int] = set()

    for raw_number, raw_answer in pairs:
        number = int(raw_number)
        if number in seen:
            raise IngestionError(f"questão duplicada: {number}")
        seen.add(number)
        answer = normalize_answer(raw_answer)
        if answer is None:
            annulled.append(number)
        else:
            answers[str(number)] = answer

    validate_answers(answers, annulled, total)
    return answers, sorted(annulled)


def subject_ranges(*ranges: tuple[str, str, str, int, int]) -> list[dict[str, object]]:
    return [
        {"id": subject_id, "label": label, "area": area, "range": [start, end]}
        for subject_id, label, area, start, end in ranges
    ]


def make_retrieval(doc: PdfDocument, parser_version: str, revision: str) -> dict[str, object]:
    return {
        "originalUrl": doc.url,
        "effectiveSourceUrl": doc.url,
        "sourceType": "pdf-reference",
        "fetchedAt": FETCHED_AT,
        "sha256": doc.sha256,
        "bytes": doc.size,
        "parserVersion": parser_version,
        "revision": revision,
        "final": revision in {"final", "rectified"},
    }


def entry(
    *,
    edition: str,
    year: int,
    label: str,
    phase: str,
    total: int,
    answers: dict[str, str],
    annulled: list[int],
    variants: list[dict[str, object]],
    canonical_variant: str,
    variant_relation: str,
    revision: str,
    archive_page: str,
    subjects: list[dict[str, object]],
    parser_version: str,
    retrieval: dict[str, object],
    validation_evidence: list[str],
) -> dict[str, object]:
    answer_key_url = next(v["answerKeyUrl"] for v in variants if v["id"] == canonical_variant)
    exam_url = next(v["examUrl"] for v in variants if v["id"] == canonical_variant)
    return {
        "edition": edition,
        "year": year,
        "label": label,
        "phase": phase,
        "total": total,
        "canonicalVariant": canonical_variant,
        "variantRelation": variant_relation,
        "revision": revision,
        "answers": answers,
        "annulled": annulled,
        "variants": variants,
        "answerKeyUrl": answer_key_url,
        "examUrl": exam_url,
        "archivePage": archive_page,
        "subjects": subjects,
        "contentMode": "reference-only",
        "rightsStatus": "official-reference",
        "validationLevel": "reviewed",
        "validationEvidence": validation_evidence,
        "retrieval": retrieval,
        "parserVersion": parser_version,
    }


def write_provider(provider_id: str, data: dict[str, object]) -> None:
    destination = RAIZ / "src" / "lib" / "providers" / provider_id / "answer-keys.generated.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{provider_id}: {len(data)} edição(ões) -> {destination.relative_to(RAIZ)}")


def discover_page_contains(page_url: str, expected_urls: list[str]) -> None:
    text = fetch_text(page_url)
    missing = []
    for url in expected_urls:
        parsed = urllib.parse.urlparse(url)
        path = parsed.path.lstrip("/")
        candidates = {url, urllib.parse.unquote(url), path, urllib.parse.unquote(path)}
        if not any(candidate and candidate in text for candidate in candidates):
            missing.append(url)
    if missing:
        raise IngestionError(f"página oficial não contém URLs esperadas: {missing[:2]}")


UNICAMP = {
    2026: {
        "archive": "https://www.comvest.unicamp.br/ingresso-2026/vestibular-2026/provas-e-gabaritos-vestibular-2026/",
        "variant_relation": "unknown",
        "canonical": "qx",
        "revision": "final",
        "variants": [
            ("qx", "Provas Q e X", "https://www.comvest.unicamp.br/vest2026/F1/f12026Q_X.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2025/10/Q_X-gabarito.pdf"),
            ("ry", "Provas R e Y", "https://www.comvest.unicamp.br/vest2026/F1/f12026R_Y.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2025/10/R_Y-gabarito.pdf"),
            ("sz", "Provas S e Z", "https://www.comvest.unicamp.br/vest2026/F1/f12026S_Z.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2025/10/S_Z-gabarito.pdf"),
            ("tw", "Provas T e W", "https://www.comvest.unicamp.br/vest2026/F1/f12026T_W.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2025/10/T_W-gabarito.pdf"),
        ],
    },
    2025: {
        "archive": "https://www.comvest.unicamp.br/ingresso-2025/vestibular-2025/",
        "variant_relation": "unknown",
        "canonical": "qz",
        "revision": "final",
        "variants": [
            ("qz", "Provas Q e Z", "https://www.comvest.unicamp.br/vest2025/F1/f12025Q_Z.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2024/10/QZ_gabarito_2025_FINAL_site.pdf"),
            ("rw", "Provas R e W", "https://www.comvest.unicamp.br/vest2025/F1/f12025R_W.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2024/10/RW_gabarito_2025_FINAL_site.pdf"),
            ("sx", "Provas S e X", "https://www.comvest.unicamp.br/vest2025/F1/f12025S_X.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2024/10/SX_gabarito_2025_FINAL_site.pdf"),
            ("ty", "Provas T e Y", "https://www.comvest.unicamp.br/vest2025/F1/f12025T_Y.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2024/10/TY_gabarito_2025_FINAL_site.pdf"),
        ],
    },
    2024: {
        "archive": "https://www.comvest.unicamp.br/ingresso-2024/vestibular-2024-2/area-doa-candidatoa/",
        "variant_relation": "unknown",
        "canonical": "qy",
        "revision": "final",
        "variants": [
            ("qy", "Provas Q e Y", "https://www.comvest.unicamp.br/vest2024/F1/f12024Q_Y.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2023/10/Q_Y.pdf"),
            ("rz", "Provas R e Z", "https://www.comvest.unicamp.br/vest2024/F1/f12024R_Z.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2023/10/R_Z.pdf"),
            ("sw", "Provas S e W", "https://www.comvest.unicamp.br/vest2024/F1/f12024S_W.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2023/10/S_W.pdf"),
            ("tx", "Provas T e X", "https://www.comvest.unicamp.br/vest2024/F1/f12024T_X.pdf", "https://www.comvest.unicamp.br/wp-content/uploads/2023/10/T_X.pdf"),
        ],
    },
}


UEL_2026_URLS = {
    "archive": "https://www.cops.uel.br/v2/ProvasGabaritos/DivulgacaoProvasGabaritos1DiaVestibularDefinitivo/Selecao/370/Atividade/20969",
    "exam": "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZjg1ZTQzM2QwMGNjOWUyMzFmZjEzMjZlYzc1ZGI0YjE4NTIwZDdhYjBjY2MxYjU2YTljYzcyYjgxOGI4ZGE1MTI=",
    "answer": "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZmQxZmEzNWU2YjZmYzkwOWE4NjBkM2YyMWJhOTJjZDVhM2RkZjRhNDNmMGQzN2RjYjFmMGZmYzY0YmExZGI4NGJkMGU1MTAxOTYwZThhNjBmN2I1MzE4NzI2ZDIxZDk4YQ==",
    "variant_answers": [
        ("tipo-1", "Tipo 1 - Inglês", "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZmQxZmEzNWU2YjZmYzkwOWE4NjBkM2YyMWJhOTJjZDVhM2RkZjRhNDNmMGQzN2RjYjFmMGZmYzY0YmExZGI4NGJkMGU1MTAxOTYwZThhNjBmN2I1MzE4NzI2ZDIxZDk4YQ=="),
        ("tipo-2", "Tipo 2 - Inglês", "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZjYyMjI4YzI3MDg0YjFiOGIxZjMzZGM5OTI0YzkyNzFkM2RkZjRhNDNmMGQzN2RjYjFmMGZmYzY0YmExZGI4NGJkMGU1MTAxOTYwZThhNjBmN2I1MzE4NzI2ZDIxZDk4YQ=="),
        ("tipo-3", "Tipo 3 - Inglês", "https://www.cops.uel.br/v2/download.php?Acesso=NTc0NTQyMzZjZTU3Mzg2MDZkNzAwMjMyMmVmZjA2MjJiM2EzNjg5NDhlYTY1NGM5NGU3N2Q0NGNkYTM2NTUzZjZmMzcxMjYxN2JhNThhMjM4OTQ0MzBiZTYxZjJhYWMzM2RkZjRhNDNmMGQzN2RjYjFmMGZmYzY0YmExZGI4NGJkMGU1MTAxOTYwZThhNjBmN2I1MzE4NzI2ZDIxZDk4YQ=="),
    ],
}


PUCSP = {
    2026: {
        "edition": "2026-verao",
        "label": "Vestibular PUC-SP Verão 2026",
        "archive": "https://nucvest.com.br/pucsp/vestibular/2026/verao/index.html",
        "exam": "https://nucvest.com.br/downloads/pucsp/vestibular/2026/verao/gabarito-e-prova/PUC-SP-Verao-2026-A4-v2-direito-autoral-digital.pdf",
        "answer": "https://nucvest.com.br/downloads/pucsp/vestibular/2026/verao/gabarito-e-prova/PUC-Verao-2026-Gabarito.pdf",
        "revision": "final",
    },
    2025: {
        "edition": "2025-verao",
        "label": "Vestibular PUC-SP Verão 2025",
        "archive": "https://nucvest.com.br/pucsp/vestibular/2025/verao/index.html",
        "exam": "https://nucvest.com.br/downloads/pucsp/vestibular/2025/verao/gabarito-e-prova/PUC-SP-verao-2025-A4-DIREITO-AUTORAL.pdf",
        "answer": "https://nucvest.com.br/downloads/pucsp/vestibular/2025/verao/gabarito-e-prova/PUC-Verao-2025-Gabarito-Republicado.pdf",
        "revision": "rectified",
    },
    2024: {
        "edition": "2024-verao",
        "label": "Vestibular PUC-SP Verão 2024",
        "archive": "https://nucvest.com.br/pucsp/vestibular/2025/index.html",
        "exam": "https://nucvest.com.br/downloads/pucsp/vestibular/2024/verao/PUC-SP-Verao-2024-A4-v1.pdf",
        "answer": "https://nucvest.com.br/downloads/pucsp/vestibular/2024/verao/PUC-SP-Verao-2024-Gabarito.pdf",
        "revision": "final",
    },
}


def ingest_unicamp() -> dict[str, object]:
    parser_version = "unicamp-answer-key@1.0.0"
    catalog: dict[str, object] = {}
    for year, config in sorted(UNICAMP.items(), reverse=True):
        variants = [
            {"id": variant_id, "label": label, "examUrl": exam_url, "answerKeyUrl": answer_url}
            for variant_id, label, exam_url, answer_url in config["variants"]
        ]
        discover_page_contains(config["archive"], [item["examUrl"] for item in variants] + [item["answerKeyUrl"] for item in variants])
        canonical = next(v for v in variants if v["id"] == config["canonical"])
        doc = fetch_pdf(canonical["answerKeyUrl"])
        answers, annulled = parse_unicamp_answer_key(doc.text)
        catalog[str(year)] = entry(
            edition=str(year),
            year=year,
            label=f"Vestibular Unicamp {year} - 1ª fase",
            phase="first",
            total=72,
            answers=answers,
            annulled=annulled,
            variants=variants,
            canonical_variant=config["canonical"],
            variant_relation=config["variant_relation"],
            revision=config["revision"],
            archive_page=config["archive"],
            subjects=subject_ranges(("conhecimentos-gerais", "Conhecimentos gerais", "conhecimentos-gerais", 1, 72)),
            parser_version=parser_version,
            retrieval=make_retrieval(doc, parser_version, config["revision"]),
            validation_evidence=[
                "Página oficial da COMVEST lista prova e gabarito da 1ª fase.",
                "Gabarito canônico cobre exatamente 72 questões.",
                "Variantes são registradas como unknown; só a canônica vira executável.",
            ],
        )
    return catalog


def ingest_uel() -> dict[str, object]:
    parser_version = "uel-answer-key@1.0.0"
    discover_page_contains(
        UEL_2026_URLS["archive"],
        [UEL_2026_URLS["exam"], UEL_2026_URLS["answer"], *(url for _, _, url in UEL_2026_URLS["variant_answers"])],
    )
    doc = fetch_pdf(UEL_2026_URLS["answer"])
    answers, annulled = parse_uel_answer_key(doc.text)
    variants = [
        {"id": variant_id, "label": label, "examUrl": UEL_2026_URLS["exam"] if variant_id == "tipo-1" else None, "answerKeyUrl": answer_url}
        for variant_id, label, answer_url in UEL_2026_URLS["variant_answers"]
    ]
    return {
        "2026": entry(
            edition="2026",
            year=2026,
            label="Vestibular UEL 2026 - 1º dia - Inglês",
            phase="first",
            total=60,
            answers=answers,
            annulled=annulled,
            variants=variants,
            canonical_variant="tipo-1",
            variant_relation="unknown",
            revision="final",
            archive_page=UEL_2026_URLS["archive"],
            subjects=subject_ranges(("conhecimentos-gerais", "Conhecimentos gerais", "conhecimentos-gerais", 1, 60)),
            parser_version=parser_version,
            retrieval=make_retrieval(doc, parser_version, "final"),
            validation_evidence=[
                "Endpoint oficial COPS/UEL identifica gabaritos definitivos do 1º dia.",
                "Gabarito canônico em inglês cobre exatamente 60 questões.",
                "Tipos 1-3 são registrados como unknown; só o Tipo 1 vira executável.",
            ],
        )
    }


def ingest_pucsp() -> dict[str, object]:
    parser_version = "puc-sp-answer-key@1.0.0"
    catalog: dict[str, object] = {}
    for year, config in sorted(PUCSP.items(), reverse=True):
        discover_page_contains(config["archive"], [config["exam"], config["answer"]])
        doc = fetch_pdf(config["answer"])
        answers, annulled = parse_pucsp_answer_key(doc.text)
        catalog[str(year)] = entry(
            edition=config["edition"],
            year=year,
            label=config["label"],
            phase="single",
            total=50,
            answers=answers,
            annulled=annulled,
            variants=[
                {
                    "id": "unica",
                    "label": "Prova única",
                    "examUrl": config["exam"],
                    "answerKeyUrl": config["answer"],
                }
            ],
            canonical_variant="unica",
            variant_relation="unknown",
            revision=config["revision"],
            archive_page=config["archive"],
            subjects=subject_ranges(
                ("matematica", "Matemática e suas tecnologias", "matematica", 1, 5),
                ("ciencias-natureza", "Ciências da Natureza", "ciencias-natureza", 6, 20),
                ("ciencias-humanas", "Ciências Humanas", "ciencias-humanas", 21, 35),
                ("linguagens", "Linguagens e Códigos", "linguagens", 36, 50),
            ),
            parser_version=parser_version,
            retrieval=make_retrieval(doc, parser_version, config["revision"]),
            validation_evidence=[
                "Página oficial NucVest lista caderno e gabarito da edição.",
                "Gabarito cobre exatamente 50 questões objetivas.",
                "PUC-SP é provider próprio, separado de outras PUCs.",
            ],
        )
    return catalog


IMPORTERS: dict[str, Callable[[], dict[str, object]]] = {
    "unicamp": ingest_unicamp,
    "uel": ingest_uel,
    "puc-sp": ingest_pucsp,
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Ingere gabaritos oficiais em modo referência.")
    parser.add_argument("provider", nargs="?", default="all", choices=["all", *IMPORTERS.keys()])
    args = parser.parse_args(argv)

    targets = IMPORTERS.keys() if args.provider == "all" else [args.provider]
    for provider_id in targets:
        write_provider(provider_id, IMPORTERS[provider_id]())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
