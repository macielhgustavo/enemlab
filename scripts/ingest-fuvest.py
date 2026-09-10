#!/usr/bin/env python3
"""Ingestão do gabarito oficial da FUVEST (1ª fase).

    python scripts/ingest-fuvest.py --dry-run
    python scripts/ingest-fuvest.py --year 2025

O que este script ingere
------------------------
O gabarito da **1ª fase**, objetiva com 100 questões em 2005–2006 e 90 nas
edições de 2007 em diante.

A FUVEST aplica versões da mesma prova com as questões em ordem diferente.
Os nomes mudaram ao longo do acervo: V/K/Q/X/Z e, mais recentemente,
V1/V2/V3/V4. O documento oficial publica as respostas por versão ou uma tabela
de correspondência entre elas.

    PROVA V1   PROVA V2   PROVA V3   PROVA V4
    1 E  46 D  1 A  46 C  1 E  46 C  1 C  46 B

A questão 1 vale E na V1, A na V2, E na V3 e C na V4 — é a mesma questão em
posições diferentes. Por isso a relação entre variantes é `reordered`, e
apenas a **V1 é ingerida** como fonte das questões. As outras três ficam
como referência ao documento oficial.

Ingerir todas as versões multiplicaria a mesma questão no catálogo e faria o
SRS tratar cada caderno reordenado como conteúdo diferente.

O que não ingere
----------------
A 2ª fase, que é discursiva. Ela é registrada na fonte com as respostas
esperadas que a FUVEST publica, mas não é executável: não há correção de
discursiva, e inventar uma seria pior que não ter.

O enunciado também não: por ora a 1ª fase entra em modo referência, como as
demais provas, até que alguém meça se a extração preserva o significado.

Falha fechado
-------------
Cobertura incompleta, número duplicado, letra inválida ou versões
com gabarito idêntico recusam a edição. Gabaritos iguais entre versões
reordenadas indicam leitura do mesmo bloco duas vezes.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.fuvest.br"
SAIDA = Path(__file__).resolve().parent.parent / "src/lib/providers/fuvest/answer-keys.generated.json"
PARSER_VERSION = "fuvest-answer-key@1.1.0"

LETRAS = ("A", "B", "C", "D", "E")

# Os nomes e a quantidade de versões vêm do próprio documento, nunca do
# código: em 2025 a FUVEST usou V1..V4; em 2024, cinco versões chamadas
# V, K, Q, X e Z. Fixar a lista aqui faria o parser recusar todo ano em que
# a banca mudasse a nomenclatura — ou, pior, atribuir a resposta à versão
# errada.
CABECALHO_VERSOES_RE = re.compile(r"PROVA\s+([A-Z][A-Z0-9]?)")

# As edições aceitas têm entre 80 e 100 questões. Fora dessa faixa, o parser
# recusa em vez de aceitar o que leu.
TOTAL_MIN, TOTAL_MAX = 80, 100

ANO_MIN, ANO_MAX = 2001, 2100


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
PDF_RE = re.compile(r'href=["\']([^"\']*\.pdf(?:\?[^"\']*)?)["\']', re.I)


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
    candidatos_gabarito: list[str] = []

    for m in PDF_RE.finditer(html):
        import html as html_module

        url = absoluto(html_module.unescape(m.group(1)))
        nome = sem_acento(url.rsplit("/", 1)[-1].split("?", 1)[0]).lower()
        if str(ano) not in nome:
            continue

        primeira_fase = any(marker in nome for marker in ("primeira_fase", "1fase", "1_fase", "fase1"))
        gabarito = "gabarito" in nome or re.search(
            r"(?:(?:primeira_fase|1fase|1_fase|fase1).*gab|gab.*(?:primeira_fase|1fase|1_fase|fase1))",
            nome,
        )
        if "gabarito" in nome and "oficial" in nome:
            primeira_fase = True
        if primeira_fase and gabarito and "simulado" not in nome:
            candidatos_gabarito.append(url)
            continue

        v = re.search(
            r"(?:primeira_fase_prova_|1fase_prova_|fase1-prova-)(v[1-4]|[vkqxz])",
            nome,
        )
        if v:
            e.provas[v.group(1).upper()] = url
            continue

        if primeira_fase and not gabarito and (
            "prova_primeira_fase" in nome or nome.endswith("primeira_fase.pdf")
        ):
            e.provas.setdefault("V", url)
            continue

        if "2fase" in nome or "segunda_fase" in nome or "segunda-fase" in nome:
            e.segunda_fase.append(url)

    if candidatos_gabarito:
        def prioridade(url: str) -> tuple[int, int, str]:
            nome = sem_acento(url.rsplit("/", 1)[-1]).lower()
            return (
                1 if "retific" in nome else 0,
                0 if "gab_cor" in nome else 1,
                nome,
            )

        e.gabarito = max(candidatos_gabarito, key=prioridade)

    return e


# --------------------------------------------------------------------- #
# Gabarito
# --------------------------------------------------------------------- #

PAR_RE = re.compile(r"(?<!\d)(\d{1,3})[^0-9A-Z]{0,6}([A-E*])(?![A-Z])")
PREFIXADA_RE = re.compile(
    r"(?<![A-Z0-9])(V[1-4]|[VKQXZ])[^\r\nA-Z0-9]+(\d{1,3})[^\r\nA-Z0-9]+(ANULAD[AO]|[A-E*])(?![A-Z])"
)


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
    inicio = texto.find("GABARITO")
    if inicio < 0:
        inicio = 0
    cabecalho = texto[inicio : inicio + 1200]
    for prefixo in ("PROVA", "GRUPO"):
        vistos: list[str] = []
        for versao in re.findall(rf"{prefixo}\s+([A-Z][A-Z0-9]?)", cabecalho):
            if versao in {"V", "K", "Q", "X", "Z", "V1", "V2", "V3", "V4"} and versao not in vistos:
                vistos.append(versao)
        if len(vistos) >= 2:
            return vistos
    return []


def cobertura_completa(versoes: dict[str, dict[int, str]]) -> int | None:
    if not versoes or not all(versoes.values()):
        return None
    total = max(max(respostas) for respostas in versoes.values())
    if total < TOTAL_MIN:
        return None
    esperadas = set(range(1, total + 1))
    return total if all(set(respostas) == esperadas for respostas in versoes.values()) else None


def normalizar_pares_quebrados(texto: str) -> str:
    texto = re.sub(r"(?<=\d)(?=[A-E*]\b)", " ", texto)
    return re.sub(r"\b([1-9])\s+([0-9])\s+(?=[A-E*]\b)", r"\1\2 ", texto)


def resposta_normalizada(resposta: str) -> str:
    return "X" if resposta == "*" or resposta.startswith("ANULAD") else resposta


def adicionar_resposta(
    versoes: dict[str, dict[int, str]], versao: str, numero: int, resposta: str
) -> bool:
    if numero in versoes[versao]:
        return False
    versoes[versao][numero] = resposta_normalizada(resposta)
    return True


def parse_tabela_prefixada(
    texto: str, ordem: list[str]
) -> tuple[dict[str, dict[int, str]], int] | None:
    versoes: dict[str, dict[int, str]] = {versao: {} for versao in ordem}
    for versao, numero, resposta in PREFIXADA_RE.findall(texto):
        if versao in versoes and not adicionar_resposta(
            versoes, versao, int(numero), resposta
        ):
            return None
    total = cobertura_completa(versoes)
    return (versoes, total) if total is not None else None


def parse_tabela_direta(texto: str, ordem: list[str]) -> tuple[dict[str, dict[int, str]], int] | None:
    linhas = texto.splitlines()
    inicio = next(
        (
            index + 1
            for index, linha in enumerate(linhas)
            if len(CABECALHO_VERSOES_RE.findall(linha)) >= 2
        ),
        None,
    )
    if inicio is None:
        return None

    por_linha = 2 * len(ordem)

    versoes_por_linha: dict[str, dict[int, str]] = {versao: {} for versao in ordem}
    encontrou_linha = False
    for linha in linhas[inicio:]:
        pares_linha = PAR_RE.findall(normalizar_pares_quebrados(linha))
        if len(pares_linha) != por_linha:
            continue
        encontrou_linha = True
        for index, versao in enumerate(ordem):
            for numero, resposta in pares_linha[index * 2 : index * 2 + 2]:
                if not adicionar_resposta(
                    versoes_por_linha, versao, int(numero), resposta
                ):
                    return None
    total = cobertura_completa(versoes_por_linha)
    if total is not None:
        return versoes_por_linha, total
    if encontrou_linha:
        return None

    pares = PAR_RE.findall(normalizar_pares_quebrados("\n".join(linhas[inicio:])))
    versoes: dict[str, dict[int, str]] = {versao: {} for versao in ordem}
    for offset in range(0, len(pares) - por_linha + 1, por_linha):
        bloco = pares[offset : offset + por_linha]
        for index, versao in enumerate(ordem):
            for numero, resposta in bloco[index * 2 : index * 2 + 2]:
                if not adicionar_resposta(versoes, versao, int(numero), resposta):
                    return None
    total = cobertura_completa(versoes)
    return (versoes, total) if total is not None else None


def parse_tabela_correspondencia(
    texto: str, ordem: list[str]
) -> tuple[dict[str, dict[int, str]], int] | None:
    quantidade = len(ordem)
    tamanho = quantidade + 1
    versoes: dict[str, dict[int, str]] = {versao: {} for versao in ordem}
    encontrou_dados = False
    for linha in texto.splitlines():
        tokens = re.findall(r"(?<![A-Z0-9])(?:[A-E*]|\d{1,3})(?![A-Z0-9])", linha)
        tokens = [
            token
            for index, token in enumerate(tokens)
            if not (
                index > 0
                and token in (*LETRAS, "*")
                and tokens[index - 1] in (*LETRAS, "*")
            )
        ]
        if len(tokens) < tamanho or len(tokens) % tamanho != 0:
            continue
        for offset in range(0, len(tokens), tamanho):
            resposta, numeros = tokens[offset], tokens[offset + 1 : offset + tamanho]
            if resposta not in (*LETRAS, "*") or not all(numero.isdigit() for numero in numeros):
                continue
            encontrou_dados = True
            for versao, numero in zip(ordem, numeros, strict=True):
                if not adicionar_resposta(versoes, versao, int(numero), resposta):
                    return None
    if not encontrou_dados:
        return None
    total = cobertura_completa(versoes)
    return (versoes, total) if total is not None else None


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

    if PREFIXADA_RE.search(limpo):
        resultado = parse_tabela_prefixada(limpo, ordem)
    else:
        resultado = (
            parse_tabela_correspondencia(limpo, ordem)
            if "RESPOSTA GRUPO" in limpo or "GABARITO DE CORRESPONDENCIA" in limpo
            else parse_tabela_direta(limpo, ordem)
        )
    if resultado is None:
        return None
    versoes, total = resultado
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

        ruins = [n for n, l in respostas.items() if l not in (*LETRAS, "X")]
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

    anteriores = json.loads(SAIDA.read_text(encoding="utf-8")) if SAIDA.exists() else {}
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
            pdf_bytes = buscar(e.gabarito)
            g = parse_gabarito(extrair_texto(pdf_bytes), e.gabarito)
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
        sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        anterior = anteriores.get(str(ano), {})
        retrieval_anterior = anterior.get("retrieval", {})
        fetched_at = (
            retrieval_anterior.get("fetchedAt")
            if retrieval_anterior.get("sha256") == sha256
            else datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        )
        aceitas[str(ano)] = {
            "edition": str(ano),
            "year": ano,
            "total": g.total,
            "canonicalVariant": canonica.lower(),
            "variantRelation": "reordered",
            "revision": g.revisao,
            "answers": {
                str(k): v
                for k, v in sorted(g.versoes[canonica].items())
                if v in LETRAS
            },
            "annulled": sorted(
                numero for numero, resposta in g.versoes[canonica].items() if resposta == "X"
            ),
            "variants": [
                {"id": v.lower(), "label": f"Prova {v}", "examUrl": e.provas.get(v)}
                for v in g.ordem
            ],
            "answerKeyUrl": g.url,
            "examUrl": e.provas.get(canonica),
            "secondPhaseUrls": sorted(e.segunda_fase or []),
            "archivePage": pagina,
            "sourceType": "pdf-reference",
            "contentMode": "reference-only",
            "rightsStatus": "official-reference",
            "validationLevel": "reviewed",
            "expectedQuestions": g.total,
            "parsedQuestions": g.total,
            "validationEvidence": [
                "Página oficial FUVEST associa a edição à prova e ao gabarito.",
                "Gabarito final/retificado cobre integralmente a primeira fase objetiva.",
                "Tabela oficial de correspondência demonstra a reordenação entre versões.",
            ],
            "retrieval": {
                "originalUrl": g.url,
                "effectiveSourceUrl": g.url,
                "sourceType": "pdf-reference",
                "fetchedAt": fetched_at,
                "sha256": sha256,
                "bytes": len(pdf_bytes),
                "parserVersion": PARSER_VERSION,
                "revision": g.revisao,
                "final": True,
            },
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
