#!/usr/bin/env python3
"""Ingestão do gabarito oficial da FUVEST (1ª fase).

    python scripts/ingest-fuvest.py --dry-run
    python scripts/ingest-fuvest.py --year 2025

O que este script ingere
------------------------
O gabarito da **1ª fase**, que é objetiva com 90 questões.

A FUVEST aplica quatro versões da mesma prova — V1, V2, V3 e V4 —, com as
questões em ordem diferente em cada uma. Publica um único documento de
gabarito, com as quatro em colunas lado a lado:

    PROVA V1   PROVA V2   PROVA V3   PROVA V4
    1 E  46 D  1 A  46 C  1 E  46 C  1 C  46 B

A questão 1 vale E na V1, A na V2, E na V3 e C na V4 — é a mesma questão em
posições diferentes. Por isso a relação entre variantes é `reordered`, e
apenas a **V1 é ingerida** como fonte das questões. As outras três ficam
como referência ao documento oficial.

Ingerir as quatro criaria 360 entradas para 90 questões, e o SRS trataria a
mesma questão como quatro.

O que não ingere
----------------
A 2ª fase, que é discursiva. Ela é registrada na fonte com as respostas
esperadas que a FUVEST publica, mas não é executável: não há correção de
discursiva, e inventar uma seria pior que não ter.

O enunciado também não: por ora a 1ª fase entra em modo referência, como as
demais provas, até que alguém meça se a extração preserva o significado.

Falha fechado
-------------
Cobertura incompleta de 1..90, número duplicado, letra inválida ou versões
com gabarito idêntico recusam a edição. Gabaritos iguais entre versões
reordenadas indicam leitura do mesmo bloco duas vezes.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass
from pathlib import Path

BASE = "https://www.fuvest.br"
SAIDA = Path(__file__).resolve().parent.parent / "src/lib/providers/fuvest/answer-keys.generated.json"
PARSER_VERSION = "fuvest-answer-key@1.0.0"

LETRAS = ("A", "B", "C", "D", "E")

# Os nomes e a quantidade de versões vêm do próprio documento, nunca do
# código: em 2025 a FUVEST usou V1..V4; em 2024, cinco versões chamadas
# V, K, Q, X e Z. Fixar a lista aqui faria o parser recusar todo ano em que
# a banca mudasse a nomenclatura — ou, pior, atribuir a resposta à versão
# errada.
CABECALHO_VERSOES_RE = re.compile(r"PROVA\s+([A-Z][A-Z0-9]?)")

# A 1ª fase tem 90 questões desde que a FUVEST adotou o formato atual.
# Fora dessa faixa, o parser recusa em vez de aceitar o que leu.
TOTAL_MIN, TOTAL_MAX = 80, 100

ANO_MIN, ANO_MAX = 2000, 2100


def sem_acento(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def buscar(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "enemlab-ingest/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def extrair_texto(pdf_bytes: bytes) -> str:
    import pypdf

    leitor = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((p.extract_text() or "") for p in leitor.pages)


# --------------------------------------------------------------------- #
# Descoberta
# --------------------------------------------------------------------- #

ANO_LINK_RE = re.compile(r'href="([^"]*acervo-vestibular-(\d{4})[^"]*)"', re.I)
PDF_RE = re.compile(r'href="([^"]*\.pdf)"', re.I)


@dataclass
class EdicaoDescoberta:
    ano: int
    pagina: str
    gabarito: str | None = None
    provas: dict[str, str] | None = None
    segunda_fase: list[str] | None = None


def absoluto(url: str) -> str:
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return BASE + url
    return url


def descobrir_anos(html: str) -> dict[int, str]:
    achados: dict[int, str] = {}
    for m in ANO_LINK_RE.finditer(html):
        ano = int(m.group(2))
        if ANO_MIN <= ano <= ANO_MAX:
            achados[ano] = absoluto(m.group(1))
    return dict(sorted(achados.items(), reverse=True))


def classificar_edicao(ano: int, pagina: str, html: str) -> EdicaoDescoberta:
    e = EdicaoDescoberta(ano=ano, pagina=pagina, provas={}, segunda_fase=[])

    for m in PDF_RE.finditer(html):
        url = absoluto(m.group(1))
        nome = sem_acento(url.rsplit("/", 1)[-1]).lower()

        if "gabarito" in nome and ("primeira" in nome or "1fase" in nome or "1_fase" in nome):
            e.gabarito = url
            continue

        v = re.search(r"primeira_fase_prova_(v[1-4])", nome)
        if v:
            e.provas[v.group(1).upper()] = url
            continue

        if "2fase" in nome or "segunda_fase" in nome or "segunda-fase" in nome:
            e.segunda_fase.append(url)

    return e


# --------------------------------------------------------------------- #
# Gabarito
# --------------------------------------------------------------------- #

PAR_RE = re.compile(r"(?<!\d)(\d{1,3})\s+([A-E])(?![A-Z])")


@dataclass
class GabaritoFuvest:
    versoes: dict[str, dict[int, str]]
    ordem: list[str]
    total: int
    url: str
    revisao: str


def detectar_versoes(texto: str) -> list[str]:
    """Nomes das versões, lidos do cabeçalho do documento.

    A linha é do tipo `PROVA V1  PROVA V2  PROVA V3  PROVA V4` ou
    `PROVA V  PROVA K  PROVA Q  PROVA X  PROVA Z`. Devolve na ordem em que
    aparecem, que é a ordem das colunas.
    """
    for linha in texto.split("\n"):
        achados = CABECALHO_VERSOES_RE.findall(linha)
        # Duas ou mais na mesma linha é cabeçalho de tabela; uma só pode ser
        # texto corrido ("a prova V foi aplicada...").
        if len(achados) >= 2:
            vistos: list[str] = []
            for v in achados:
                if v not in vistos:
                    vistos.append(v)
            return vistos
    return []


def parse_gabarito(texto: str, url: str) -> GabaritoFuvest | None:
    """Lê todas as versões do documento único.

    O layout põe as colunas lado a lado, e a extração as entrega
    intercaladas na mesma linha, sempre na ordem do cabeçalho: dois pares
    por versão.

        1 E  46 D  1 A  46 C  1 E  46 C  1 C  46 B
        └V1───────┘└V2───────┘└V3───────┘└V4───────┘

    Linha com número de pares diferente do esperado é ignorada em vez de
    interpretada: cabeçalho e rodapé também contêm dígitos, e adivinhar
    onde uma coluna começa é como se atribui a resposta à versão errada.
    """
    limpo = sem_acento(texto).upper()

    ordem = detectar_versoes(limpo)
    if len(ordem) < 2:
        return None

    revisao = "rectified" if "RETIFICAD" in limpo else "final"

    versoes: dict[str, dict[int, str]] = {v: {} for v in ordem}
    duplicadas: list[tuple[str, int]] = []
    esperado = 2 * len(ordem)

    for linha in limpo.split("\n"):
        pares = PAR_RE.findall(linha)
        if len(pares) != esperado:
            continue

        for i, versao in enumerate(ordem):
            for num_s, letra in pares[i * 2 : i * 2 + 2]:
                num = int(num_s)
                if num in versoes[versao]:
                    duplicadas.append((versao, num))
                    continue
                versoes[versao][num] = letra

    if duplicadas:
        print(f"    numeração duplicada: {duplicadas[:6]}", file=sys.stderr)
        return None

    if not all(versoes.values()):
        return None

    total = max(max(m) for m in versoes.values())
    return GabaritoFuvest(
        versoes=versoes, ordem=ordem, total=total, url=url, revisao=revisao
    )


def validar(g: GabaritoFuvest) -> list[str]:
    problemas: list[str] = []

    if not (TOTAL_MIN <= g.total <= TOTAL_MAX):
        problemas.append(f"total implausível para a 1ª fase: {g.total}")

    for versao, respostas in g.versoes.items():
        faltando = [n for n in range(1, g.total + 1) if n not in respostas]
        if faltando:
            problemas.append(f"{versao} sem cobertura: {len(faltando)} questão(ões)")

        ruins = [n for n, l in respostas.items() if l not in LETRAS]
        if ruins:
            problemas.append(f"{versao} com letra inválida: {sorted(ruins)[:5]}")

    # As versões são reordenações: gabaritos idênticos indicam que o parser
    # leu o mesmo bloco duas vezes.
    iguais = [
        (a, b)
        for i, a in enumerate(g.ordem)
        for b in g.ordem[i + 1 :]
        if g.versoes[a] == g.versoes[b]
    ]
    if iguais:
        problemas.append(f"versões com gabarito idêntico: {iguais}")

    return problemas


# --------------------------------------------------------------------- #
# Principal
# --------------------------------------------------------------------- #


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int, help="só esta edição")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="no máximo N edições")
    args = ap.parse_args()

    print("descobrindo edições em https://www.fuvest.br/acervo-vestibular")
    anos = descobrir_anos(buscar(f"{BASE}/acervo-vestibular").decode("utf-8", "replace"))
    if args.year:
        anos = {k: v for k, v in anos.items() if k == args.year}
    if args.limit:
        anos = dict(list(anos.items())[: args.limit])
    if not anos:
        print("nenhuma edição encontrada", file=sys.stderr)
        return 1

    print(f"{len(anos)} edição(ões)\n")

    aceitas: dict[str, dict] = {}
    recusadas: list[tuple[int, str]] = []

    for ano, pagina in anos.items():
        try:
            e = classificar_edicao(ano, pagina, buscar(pagina).decode("utf-8", "replace"))
        except Exception as ex:  # noqa: BLE001
            recusadas.append((ano, f"página ilegível: {ex}"))
            print(f"{ano}: RECUSADA (página ilegível)\n")
            continue

        if not e.gabarito:
            recusadas.append((ano, "sem gabarito da 1ª fase"))
            print(f"{ano}: RECUSADA (sem gabarito da 1ª fase)\n")
            continue

        try:
            g = parse_gabarito(extrair_texto(buscar(e.gabarito)), e.gabarito)
        except Exception as ex:  # noqa: BLE001
            recusadas.append((ano, f"falha ao ler o PDF: {ex}"))
            print(f"{ano}: RECUSADA ({ex})\n")
            continue

        if g is None:
            recusadas.append((ano, "gabarito ilegível no formato de quatro versões"))
            print(f"{ano}: RECUSADA (gabarito ilegível)\n")
            continue

        problemas = validar(g)
        if problemas:
            recusadas.append((ano, "; ".join(problemas)))
            print(f"{ano}: RECUSADA ({'; '.join(problemas)})\n")
            continue

        # Só a primeira versão vira questão: todas são a mesma prova
        # reordenada, e ingerir todas multiplicaria o banco.
        canonica = g.ordem[0]
        aceitas[str(ano)] = {
            "edition": str(ano),
            "year": ano,
            "total": g.total,
            "canonicalVariant": canonica.lower(),
            "variantRelation": "reordered",
            "revision": g.revisao,
            "answers": {str(k): v for k, v in sorted(g.versoes[canonica].items())},
            "annulled": [],
            "variants": [
                {"id": v.lower(), "label": f"Prova {v}", "examUrl": e.provas.get(v)}
                for v in g.ordem
            ],
            "answerKeyUrl": g.url,
            "examUrl": e.provas.get(canonica),
            "secondPhaseUrls": sorted(e.segunda_fase or []),
            "archivePage": pagina,
            "parserVersion": PARSER_VERSION,
        }
        print(
            f"{ano}: ACEITA — {g.total} questões, versões {chr(47).join(g.ordem)} "
            f"({g.revisao}), canônica {canonica}\n"
        )

    print(f"\naceitas:   {len(aceitas)}")
    print(f"recusadas: {len(recusadas)}")
    for ano, motivo in recusadas:
        print(f"  {ano}: {motivo}")

    if args.dry_run:
        print("\n--dry-run: nada foi escrito.")
        return 0

    if not aceitas:
        print("\nnenhuma edição aceita; catálogo não foi tocado.", file=sys.stderr)
        return 1

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    ordenado = {k: aceitas[k] for k in sorted(aceitas, reverse=True)}
    SAIDA.write_text(
        json.dumps(ordenado, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nescrito: {SAIDA}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
