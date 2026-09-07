#!/usr/bin/env python3
"""Ingestão do gabarito oficial do IME (CFG).

    python scripts/ingest-ime.py                # todas as edições descobertas
    python scripts/ingest-ime.py --edition 2025-2026
    python scripts/ingest-ime.py --dry-run

O que este script ingere e o que não ingere
-------------------------------------------
Ingere: **o gabarito da prova objetiva**. É dado factual (número → letra),
extraível de forma determinística, e é o que permite corrigir a prova.

Não ingere: **o enunciado**. A prova objetiva do IME *tem* camada de texto —
ao contrário do ITA, que é digitalizada. Mas a extração destrói a
matemática: numa medição da edição 2025-2026, 67 frações saem quebradas em
três linhas e os expoentes viram dígitos comuns. A questão 20 extrai como

    y = x2
    2b − b
    2

quando a fórmula é y = x²/(2b) − b/2. Mostrar isso ao aluno seria mostrar
uma equação diferente da que caiu na prova — pior que não mostrar nada.

Por isso o IME entra como `reference-only`, pelo mesmo caminho do ITA: o app
cuida de tempo, marcação e correção; o enunciado é lido no PDF oficial.

Descoberta
----------
As edições vêm da página oficial, não de um padrão de URL. O IME nomeia os
arquivos de forma inconsistente entre anos — `CFG_Gabarito_Objetiva_2018_2019`,
`GabaritoDEFINITIVO`, `gabaritooficialbjetiva20222023` (o typo é da fonte) —
e inferir nome levaria a 404 silencioso ou, pior, ao arquivo errado.

Falha fechado
-------------
Edição sem cobertura contígua de 1..N, com número duplicado, letra inválida
ou anulada com resposta é **recusada**. Prova pela metade corrige errado.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

PAGINA = "https://www.ime.eb.mil.br/vestibular-e-concursos/cfg-ensino-medio/provas-anteriores-cfg"
BASE = "https://www.ime.eb.mil.br"
SAIDA = Path(__file__).resolve().parent.parent / "src/lib/providers/ime/answer-keys.generated.json"
PARSER_VERSION = "ime-answer-key@1.0.0"

LETRAS = ("A", "B", "C", "D", "E")

# Matérias da objetiva, no vocabulário do provider.
SUBJECT_NAMES = {
    "MATEMATICA": "mathematics",
    "FISICA": "physics",
    "QUIMICA": "chemistry",
}

# Só edições dentro desta faixa entram (§14: descobrir automaticamente, mas
# com allowlist). O limite superior é generoso de propósito — o de baixo
# recusa lixo de navegação que por acaso case com o padrão.
ANO_MIN, ANO_MAX = 1996, 2100


def sem_acento(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def buscar(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "enemlab-ingest/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# --------------------------------------------------------------------- #
# Descoberta
# --------------------------------------------------------------------- #

LINK_RE = re.compile(
    r"""["'](?P<url>[^"'<>\s]*provas-anteriores/(?P<ed>\d{4}-\d{4})/[^"'<>\s]+\.pdf)["']""",
    re.I,
)


@dataclass
class Documento:
    edicao: str
    url: str
    arquivo: str
    papel: str


@dataclass
class Edicao:
    edicao: str
    ano: int
    documentos: list[Documento] = field(default_factory=list)

    def por_papel(self, papel: str) -> list[Documento]:
        return [d for d in self.documentos if d.papel == papel]


def classificar(arquivo: str) -> str:
    """Papel do documento a partir do nome.

    Heurística sobre nome de arquivo é frágil por natureza, então ela é
    conservadora: o que não se encaixa vira `unknown` e simplesmente não é
    usado. Classificar errado um gabarito seria pior que ignorá-lo.
    """
    n = sem_acento(arquivo).lower()
    tem_gabarito = "gabarito" in n
    # "linguas", "portugues", "ingles" → prova de línguas, que tem gabarito
    # próprio e não faz parte da objetiva desta wave.
    linguas = any(k in n for k in ("lingua", "portugues", "port_", "ing", "idioma"))
    discursiva = "discursiv" in n

    if tem_gabarito and linguas:
        return "answer-key-languages"
    if tem_gabarito and not discursiva:
        return "answer-key-objective"
    if discursiva:
        return "subject-exam"
    if linguas:
        return "languages-exam"
    if "objetiva" in n or "1fase" in n or "1_fase" in n:
        return "objective-exam"
    return "unknown"


def revisao(arquivo: str) -> str:
    """Qual publicação do gabarito é esta (§9, §10)."""
    n = sem_acento(arquivo).lower()
    if "preliminar" in n:
        return "preliminary"
    if "definitiv" in n or "final" in n:
        return "final"
    return "final"  # sem marca explícita, o arquivo publicado é o vigente


def descobrir(html: str) -> list[Edicao]:
    achados: dict[str, Edicao] = {}

    for m in LINK_RE.finditer(html):
        url, ed = m.group("url"), m.group("ed")
        ini = int(ed.split("-")[0])
        if not (ANO_MIN <= ini <= ANO_MAX):
            continue

        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/"):
            url = BASE + url
        url = url.replace("http://", "https://")

        arquivo = url.rsplit("/", 1)[-1]
        # O ciclo 2025-2026 é a edição de ingresso em 2026.
        ano = int(ed.split("-")[1])
        e = achados.setdefault(ed, Edicao(edicao=ed, ano=ano))
        if any(d.url == url for d in e.documentos):
            continue
        e.documentos.append(
            Documento(edicao=ed, url=url, arquivo=arquivo, papel=classificar(arquivo))
        )

    return sorted(achados.values(), key=lambda e: e.ano, reverse=True)


# --------------------------------------------------------------------- #
# Gabarito
# --------------------------------------------------------------------- #

# "1 D", "40 ANULADA". O nome da matéria aparece solto entre os blocos.
LINHA_RE = re.compile(r"(?<!\d)(\d{1,3})\s+([A-E]|ANULAD[AO])(?![A-Z])")


@dataclass
class Gabarito:
    respostas: dict[int, str]
    anuladas: list[int]
    materias: dict[str, list[int]]
    total: int
    revisao: str
    url: str


# O IME imprime uma tabela por matéria, cada uma com o cabeçalho
# "Questão Gabarito". É esse cabeçalho que delimita os blocos.
CABECALHO_RE = re.compile(r"QUESTAO\s+GABARITO")


def parse_gabarito(texto: str, rev: str, url: str) -> Gabarito | None:
    """Lê o gabarito da objetiva.

    A matéria vem do bloco em que a questão está, não de uma ordem fixa no
    código: o IME publica uma tabela por matéria, cada uma encabeçada por
    "Questão Gabarito", e imprime o nome da matéria **dentro** do bloco —
    é um rótulo vertical da tabela, que a extração deposita no meio das
    linhas.

    A primeira versão deste parser usava "última matéria vista antes da
    questão" e recusou as oito edições, porque as questões 1 a 5 vinham
    antes do rótulo "MATEMÁTICA". Recusar estava certo; a leitura é que
    estava errada.
    """
    limpo = sem_acento(texto).upper()

    blocos = CABECALHO_RE.split(limpo)
    if len(blocos) < 2:
        return None

    respostas: dict[int, str] = {}
    anuladas: list[int] = []
    duplicadas: list[int] = []
    materias: dict[str, list[int]] = {}

    for bloco in blocos[1:]:
        nomes = [ident for nome, ident in SUBJECT_NAMES.items() if nome in bloco]
        # Bloco com duas matérias é ambíguo: não dá para saber qual questão
        # é de qual, e chutar seria contaminar o mapa de domínio.
        materia = nomes[0] if len(nomes) == 1 else None

        for m in LINHA_RE.finditer(bloco):
            num, val = int(m.group(1)), m.group(2)
            if num in respostas or num in anuladas:
                duplicadas.append(num)
                continue
            if val.startswith("ANULAD"):
                anuladas.append(num)
            else:
                respostas[num] = val
            if materia:
                materias.setdefault(materia, []).append(num)

    if duplicadas:
        print(f"    numeração duplicada: {sorted(set(duplicadas))}", file=sys.stderr)
        return None

    cobertas = set(respostas) | set(anuladas)
    if not cobertas:
        return None

    return Gabarito(
        respostas=respostas,
        anuladas=sorted(anuladas),
        materias={k: sorted(v) for k, v in materias.items()},
        total=max(cobertas),
        revisao=rev,
        url=url,
    )


def validar(g: Gabarito, edicao: str) -> list[str]:
    """Falha fechado: qualquer inconsistência recusa a edição."""
    problemas: list[str] = []

    cobertas = set(g.respostas) | set(g.anuladas)
    faltando = [n for n in range(1, g.total + 1) if n not in cobertas]
    if faltando:
        problemas.append(f"sem cobertura: {faltando}")

    fora = [n for n in cobertas if n < 1 or n > g.total]
    if fora:
        problemas.append(f"fora de 1..{g.total}: {sorted(fora)}")

    ruins = [n for n, l in g.respostas.items() if l not in LETRAS]
    if ruins:
        problemas.append(f"letra inválida: {sorted(ruins)}")

    conflito = [n for n in g.anuladas if n in g.respostas]
    if conflito:
        problemas.append(f"anulada com resposta: {sorted(conflito)}")

    if not g.materias:
        problemas.append("nenhuma matéria identificada no documento")
    else:
        cobertas_mat = {n for ns in g.materias.values() for n in ns}
        sem_materia = sorted(cobertas - cobertas_mat)
        if sem_materia:
            problemas.append(f"questão sem matéria: {sem_materia}")

    # Sanidade: a objetiva do IME tem dezenas de questões, não centenas.
    if not (10 <= g.total <= 120):
        problemas.append(f"total implausível para a objetiva: {g.total}")

    return problemas


# --------------------------------------------------------------------- #
# Principal
# --------------------------------------------------------------------- #


def extrair_texto(pdf_bytes: bytes) -> str:
    import pypdf

    leitor = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((p.extract_text() or "") for p in leitor.pages)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--edition", help='só esta edição, ex.: "2025-2026"')
    ap.add_argument("--dry-run", action="store_true", help="não escreve o catálogo")
    args = ap.parse_args()

    print(f"descobrindo edições em {PAGINA}")
    html = buscar(PAGINA).decode("utf-8", errors="replace")
    edicoes = descobrir(html)
    if args.edition:
        edicoes = [e for e in edicoes if e.edicao == args.edition]
    if not edicoes:
        print("nenhuma edição encontrada", file=sys.stderr)
        return 1

    print(f"{len(edicoes)} edição(ões) descoberta(s)\n")

    aceitas: dict[str, dict] = {}
    recusadas: list[tuple[str, str]] = []

    for e in edicoes:
        gabs = e.por_papel("answer-key-objective")
        print(f"{e.edicao}: {len(e.documentos)} documento(s), {len(gabs)} gabarito(s) da objetiva")

        if not gabs:
            recusadas.append((e.edicao, "sem gabarito da objetiva na página"))
            print("    RECUSADA: sem gabarito da objetiva\n")
            continue

        # Precedência: final/definitivo vence preliminar (§9).
        gabs.sort(key=lambda d: 0 if revisao(d.arquivo) == "final" else 1)
        escolhido = gabs[0]
        rev = revisao(escolhido.arquivo)

        try:
            texto = extrair_texto(buscar(escolhido.url))
        except Exception as ex:  # noqa: BLE001
            recusadas.append((e.edicao, f"falha ao ler o PDF: {ex}"))
            print(f"    RECUSADA: {ex}\n")
            continue

        g = parse_gabarito(texto, rev, escolhido.url)
        if g is None:
            recusadas.append((e.edicao, "gabarito ilegível"))
            print("    RECUSADA: gabarito ilegível\n")
            continue

        problemas = validar(g, e.edicao)
        if problemas:
            recusadas.append((e.edicao, "; ".join(problemas)))
            print(f"    RECUSADA: {'; '.join(problemas)}\n")
            continue

        aceitas[e.edicao] = {
            "edition": e.edicao,
            "year": e.ano,
            "total": g.total,
            "answers": {str(k): v for k, v in sorted(g.respostas.items())},
            "annulled": g.anuladas,
            "subjects": g.materias,
            "revision": g.revisao,
            "answerKeyUrl": g.url,
            "examUrl": (e.por_papel("objective-exam") or [None])[0].url
            if e.por_papel("objective-exam")
            else None,
            "parserVersion": PARSER_VERSION,
        }
        mat = ", ".join(f"{k}: {len(v)}" for k, v in g.materias.items())
        print(
            f"    ACEITA: {g.total} questões, {len(g.anuladas)} anulada(s), "
            f"gabarito {rev} | {mat}\n"
        )

    print(f"\naceitas:   {len(aceitas)}")
    print(f"recusadas: {len(recusadas)}")
    for ed, motivo in recusadas:
        print(f"  {ed}: {motivo}")

    if args.dry_run:
        print("\n--dry-run: nada foi escrito.")
        return 0

    if not aceitas:
        print("\nnenhuma edição aceita; catálogo não foi tocado.", file=sys.stderr)
        return 1

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    # Ordenado por edição para a reimportação produzir o mesmo arquivo (§35).
    ordenado = {k: aceitas[k] for k in sorted(aceitas, reverse=True)}
    SAIDA.write_text(
        json.dumps(ordenado, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nescrito: {SAIDA}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
