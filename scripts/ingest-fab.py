#!/usr/bin/env python3
"""Ingestão dos gabaritos oficiais da FAB (AFA e EPCAR/CPCAR).

    python scripts/ingest-fab.py --dry-run
    python scripts/ingest-fab.py --provider afa
    python scripts/ingest-fab.py --no-booklets      # pula a conferência de matérias

Por que este importador baixa por arquivo público
--------------------------------------------------
O site da FAB está atrás de verificação de bot: qualquer cliente que não seja
um navegador interativo recebe 403 — curl, urllib e navegador automatizado
inclusive. Contornar essa proteção não está em questão (§ das regras da
plataforma).

A saída é o Internet Archive, que **já** guarda os PDFs oficiais. Não é uma
fonte alternativa de conteúdo: é a mesma URL oficial, com uma cópia datada do
mesmo arquivo. Por isso `documentUrl` continua sendo a URL da FAB — é o que o
aluno deve citar e abrir —, e `retrieval.retrievedFrom` registra de onde a
ingestão de fato leu. Os dois campos existem porque são coisas diferentes, e
juntá-los foi o defeito que este arquivo conserta.

Cada edição tenta a URL viva primeiro. Se a FAB voltar a responder, a rota
passa a ser `live` sem nenhuma outra mudança.

O que o gabarito da FAB traz
----------------------------
Uma página, três versões da mesma prova em colunas:

    VERSÃO A VERSÃO B VERSÃO C
    01 B     01 C     01 B
    12 C     12 ANULADA  12 A

As versões são a mesma prova reordenada (`reordered`), então só a A vira
questão; B e C são lidas para conferência. Duas colunas idênticas indicam que
o parser leu o mesmo bloco duas vezes — `compareVariantKeys` cobre isso do
lado do TypeScript, e aqui a leitura já recusa.

Matérias: o cabeçalho manda, e ele muda de ano
-----------------------------------------------
O gabarito não marca onde cada matéria começa. O que ele traz é a ordem, na
linha de cabeçalho:

    2024: LÍNGUA PORTUGUESA - MATEMÁTICA - LÍNGUA INGLESA - FÍSICA
    2022: LÍNGUA INGLESA - FÍSICA - LÍNGUA PORTUGUESA E MATEMÁTICA

**A ordem inverte entre edições.** Assumir uma ordem fixa põe Física sob o
rótulo de Matemática — o aluno filtra "Matemática" e estuda outra coisa. Por
isso a ordem sai do documento, nunca do código.

O tamanho dos blocos é divisão igual (64÷4, 48÷3), e isso *é* uma inferência.
Ela não fica no escuro: quando o caderno de prova está disponível, o
importador lê onde cada seção começa e **recusa a edição** se discordar da
divisão. Quando não está, a edição é ingerida com
`subjects.boundariesVerified: false`, e o teste registra quais edições estão
nessa condição.

Falha fechado
-------------
Cobertura incompleta de 1..N, número duplicado, letra fora do conjunto,
anulada com resposta, colunas idênticas, cabeçalho sem matérias reconhecíveis,
total não divisível pelo número de matérias, PDF truncado, ou fronteira
conferida que discorda do caderno — qualquer um recusa a edição. Uma edição
recusada não é escrita.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PARSER_VERSION = "fab-answer-key@2.1.0"
AGENTE = "Mozilla/5.0 (compatible; ENEMLab-ingest/1.0)"
CDX = "https://web.archive.org/cdx/search/cdx"

# Cada prova declara o que o documento precisa confirmar. `total` não é
# adivinhado do PDF: é o que a banca aplica, e uma leitura que devolva outro
# número é leitura errada, não edição nova.
PROVAS = {
    "afa": {
        "prefixo": "afa",
        "instituicao": "FAB",
        "total": 64,
        "materias": 4,
        "pagina": "https://www.fab.mil.br/ingresso/afa/",
    },
    "epcar": {
        "prefixo": "cpcar",
        "instituicao": "FAB",
        "total": 48,
        "materias": 3,
        "pagina": "https://www.fab.mil.br/ingresso/epcar/",
    },
}

# Nome no cabeçalho -> identificador da matéria. Sem sobreposição entre eles,
# então a ordem de aparição no texto resolve a ordem dos blocos.
MATERIAS = {
    "LINGUA PORTUGUESA": "portuguese",
    "MATEMATICA": "mathematics",
    "LINGUA INGLESA": "english",
    "FISICA": "physics",
}

LETRAS = set("ABCD")


def achatar(texto: str) -> str:
    """Sem acento e em maiúscula. O PDF da FAB varia acentuação entre anos."""
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    ).upper()


# ---------------------------------------------------------------- rede


def _abrir(url: str, tempo: int) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE})
    with urllib.request.urlopen(req, timeout=tempo) as r:
        declarado = r.headers.get("Content-Length")
        buf = bytearray()
        while True:
            pedaco = r.read(65536)
            if not pedaco:
                break
            buf.extend(pedaco)
    dados = bytes(buf)
    if declarado and int(declarado) != len(dados):
        raise OSError(f"resposta truncada: {len(dados)} de {declarado} bytes")
    return dados


_CACHE_CDX: dict[str, list[list[str]]] = {}


def consultar_cdx(padrao: str, limite: int = 30000) -> list[list[str]]:
    # O índice de `/ingresso` tem milhares de linhas e é o mesmo para todas as
    # edições. Sem cache, cada ano refaria a varredura inteira.
    if padrao in _CACHE_CDX:
        return _CACHE_CDX[padrao]
    q = (
        f"{CDX}?url={urllib.parse.quote(padrao, safe='')}"
        f"&output=json&filter=statuscode:200&collapse=urlkey&limit={limite}"
    )
    for tentativa in range(3):
        try:
            linhas = json.loads(_abrir(q, 300).decode("utf-8", "replace"))
            _CACHE_CDX[padrao] = linhas[1:] if len(linhas) > 1 else []
            return _CACHE_CDX[padrao]
        except Exception as erro:  # noqa: BLE001 — a falha vira aviso, não exceção
            if tentativa == 2:
                print(f"  !! CDX indisponível: {erro}", file=sys.stderr)
            time.sleep(5)
    return []


def snapshots(url: str) -> list[tuple[str, int]]:
    """Cópias datadas de uma URL, da mais recente para a mais antiga."""
    q = (
        f"{CDX}?url={urllib.parse.quote(url, safe='')}"
        "&output=json&filter=statuscode:200&limit=100"
    )
    try:
        linhas = json.loads(_abrir(q, 180).decode("utf-8", "replace"))[1:]
    except Exception:  # noqa: BLE001
        return []
    saida = []
    for l in linhas:
        try:
            saida.append((l[1], int(l[6]) if len(l) > 6 and l[6].isdigit() else 0))
        except (IndexError, ValueError):
            continue
    # Maior primeiro: um snapshot truncado é menor que o íntegro, e tentar o
    # maior antes evita gastar tentativa no cortado.
    return sorted(saida, key=lambda s: (-s[1], s[0]))


def baixar_pdf(url: str, tentativas: int = 3) -> tuple[bytes, str, str] | None:
    """Devolve (conteúdo, rota, origem lida) ou None.

    Tenta a URL viva antes do arquivo: se a FAB voltar a responder, a rota
    muda sozinha. Um PDF sem `%%EOF` é recusado — o Wayback guarda registros
    cortados em 1 MiB, e um PDF cortado abre e lê parcialmente, o que é pior
    que não abrir.
    """
    try:
        dados = _abrir(url, 60)
        if dados.startswith(b"%PDF-") and dados.rstrip().endswith(b"%%EOF"):
            return dados, "live", url
    except Exception:  # noqa: BLE001 — 403 da verificação de bot é o esperado
        pass

    for ts, _ in snapshots(url)[:tentativas]:
        origem = f"https://web.archive.org/web/{ts}id_/{url}"
        try:
            dados = _abrir(origem, 300)
        except Exception:  # noqa: BLE001
            time.sleep(4)
            continue
        if dados.startswith(b"%PDF-") and dados.rstrip().endswith(b"%%EOF"):
            return dados, "web-archive", origem
        time.sleep(2)
    return None


# ------------------------------------------------------------ descoberta


def descobrir(prova: str) -> dict[int, list[str]]:
    """Edições com gabarito oficial publicado, pelo índice do arquivo.

    Descoberta de verdade: varre o índice de `/ingresso` e agrupa por ano.
    Nada de montar URL por padrão de nome — os nomes variam de ano para ano
    (`afa2019_gab_oficial`, `afa2020_gabarito_oficial`,
    `afa2026-P1-gabarito-oficial`), e inferir levaria a 404 ou ao arquivo
    errado.

    Devolve **todos** os caminhos achados para cada ano, do mais recente para
    o mais antigo. A FAB republica o mesmo gabarito em mais de um diretório
    (`arquivos/2020/` e `arquivos/provas/`), e nem toda cópia arquivada está
    íntegra: em 2021 a primeira está cortada e a segunda não. Guardar só uma
    perderia a edição por acidente de arquivamento.
    """
    prefixo = PROVAS[prova]["prefixo"]
    achados: dict[int, dict[str, str]] = {}

    for padrao in ("fab.mil.br/ingresso/arquivos*", "fab.mil.br/ingresso*"):
        for linha in consultar_cdx(padrao):
            url = linha[2]
            nome = url.rsplit("/", 1)[-1].lower()
            if not nome.endswith(".pdf"):
                continue
            m = re.match(rf"{prefixo}[_-]?(\d{{4}})", nome)
            if not m:
                continue
            # Provisório pode ser retificado; §9 só aceita o final.
            if "provisorio" in nome or "_prov" in nome or "provis" in nome:
                continue
            if not re.search(r"gab|oficial", nome):
                continue
            # `resultado_...gabriel...` casa com "gab" sem ser gabarito.
            if re.search(r"resultado|convoc|tacf|inspsau|_cf_|locais", nome):
                continue
            ano = int(m.group(1))
            # A URL canônica é a da FAB, sempre com host completo.
            canonica = url if url.startswith("http") else f"https://{url}"
            canonica = canonica.replace("http://", "https://")
            if "://www." not in canonica:
                canonica = canonica.replace("://fab.mil.br", "://www.fab.mil.br")
            por_ano = achados.setdefault(ano, {})
            # Mesmo caminho visto duas vezes: fica o snapshot mais novo.
            if canonica not in por_ano or linha[1] > por_ano[canonica]:
                por_ano[canonica] = linha[1]

    return {
        ano: [u for u, _ in sorted(urls.items(), key=lambda kv: kv[1], reverse=True)]
        for ano, urls in sorted(achados.items())
    }


def descobrir_caderno(prova: str, ano: int) -> str | None:
    """Caderno da versão A, quando arquivado. Usado só para conferir matérias."""
    prefixo = PROVAS[prova]["prefixo"]
    melhor: tuple[str, str] | None = None
    for linha in consultar_cdx("fab.mil.br/ingresso/arquivos*"):
        url = linha[2]
        nome = urllib.parse.unquote(url.rsplit("/", 1)[-1]).lower()
        if not nome.endswith(".pdf") or not nome.startswith(f"{prefixo}{ano}"):
            continue
        if "prova" not in nome and "vers" not in nome:
            continue
        if "locais" in nome or "aviso" in nome:
            continue
        if not re.search(r"(prova_?_?a|versao_a|vers.o_a|prova a)", nome):
            continue
        canonica = url if url.startswith("http") else f"https://{url}"
        if melhor is None or linha[1] > melhor[0]:
            melhor = (linha[1], canonica)
    return melhor[1] if melhor else None


# ---------------------------------------------------------------- leitura


def paginas_do_pdf(dados: bytes) -> list[str]:
    import io

    import pypdf  # importado aqui para o --help funcionar sem a dependência

    leitor = pypdf.PdfReader(io.BytesIO(dados))
    return [(p.extract_text() or "") for p in leitor.pages]


def texto_do_pdf(dados: bytes) -> str:
    return "\n".join(paginas_do_pdf(dados))


def ler_colunas(texto: str) -> dict[str, dict[int, str]]:
    """Lê as colunas versão A/B/C do gabarito.

    Cada linha útil traz um par (número, valor) por versão, na ordem das
    colunas. Linhas com outro número de pares não são linha de gabarito e são
    descartadas — cabeçalho, rodapé e ruído caem aqui.
    """
    plano = achatar(texto)
    nomes = re.findall(r"VERSAO\s+([A-Z])\b", plano)
    # A ordem das colunas é a ordem em que os títulos aparecem, sem repetir.
    ordem: list[str] = []
    for n in nomes:
        if n not in ordem:
            ordem.append(n)
    if not ordem:
        return {}

    colunas: dict[str, dict[int, str]] = {n: {} for n in ordem}
    for linha in plano.split("\n"):
        pares = re.findall(r"(?<!\d)(\d{1,3})\s+(ANULADA|[A-E])(?![A-Z])", linha)
        if len(pares) != len(ordem):
            if pares:
                raise ValueError("linha incompleta ou emenda de coluna")
            continue
        if len({int(numero) for numero, _ in pares}) != 1:
            raise ValueError("numeração desalinhada: emenda de coluna")
        for (numero, valor), versao in zip(pares, ordem):
            if int(numero) in colunas[versao]:
                raise ValueError(f"número duplicado na versão {versao}: {numero}")
            colunas[versao][int(numero)] = valor
    return colunas


def ler_materias(texto: str, total: int, esperadas: int) -> list[str] | None:
    """Ordem das matérias, lida do cabeçalho do próprio documento."""
    plano = achatar(texto)
    cabecalho = None
    for linha in plano.split("\n"):
        if "PROVAS DE" in linha or "PROVA DE" in linha:
            cabecalho = linha
            break
    if cabecalho is None:
        return None

    posicoes = []
    for nome, ident in MATERIAS.items():
        i = cabecalho.find(nome)
        if i >= 0:
            posicoes.append((i, ident))
    # "LINGUA PORTUGUESA" e "LINGUA INGLESA" não se contêm, mas um cabeçalho
    # com matéria repetida indicaria leitura errada da linha.
    idents = [ident for _, ident in sorted(posicoes)]
    if len(idents) != esperadas or len(set(idents)) != esperadas:
        return None
    if total % esperadas:
        return None
    return idents


def fronteiras_do_caderno(dados: bytes) -> dict[str, int]:
    """Em que questão cada seção começa, segundo o caderno de prova.

    Melhor esforço: alguns cadernos arquivados têm extração quebrada (2021
    troca espaço por `g`), e nesses o retorno é parcial ou vazio. Vazio não
    aprova nada — só deixa a fronteira sem conferência.
    """
    achados: dict[str, int] = {}
    secao_aberta: str | None = None
    # A capa lista as quatro matérias juntas; ler seção ali marcaria a
    # primeira questão do caderno como início de todas elas.
    for pagina in paginas_do_pdf(dados)[1:]:
        for linha in pagina.split("\n"):
            s = achatar(linha).strip()
            if s in MATERIAS:
                secao_aberta = MATERIAS[s]
                continue
            m = re.match(r"^(\d{1,2})\s*[-–]\s+\S", s)
            if m and secao_aberta and secao_aberta not in achados:
                achados[secao_aberta] = int(m.group(1))
                secao_aberta = None
    return achados


# ------------------------------------------------------------- validação


def montar(prova: str, ano: int, url: str, dados: bytes, rota: str, origem: str,
           caderno: bytes | None) -> tuple[dict | None, list[str]]:
    cfg = PROVAS[prova]
    total = cfg["total"]
    problemas: list[str] = []

    texto = texto_do_pdf(dados)
    plano = achatar(texto)
    if "GABARITO OFICIAL" not in plano or re.search(r"PROVISORIO|PRELIMINAR", plano):
        return None, ["documento não confirma gabarito final"]
    identificador = r"CFOAV/CFOINT/CFOINF" if prova == "afa" else r"CPCAR"
    if not re.search(rf"{identificador}\s+{ano}\b", plano):
        return None, ["documento não confirma instituição/edição"]
    try:
        colunas = ler_colunas(texto)
    except ValueError as erro:
        return None, [str(erro)]
    if not colunas:
        return None, ["nenhuma coluna VERSÃO encontrada no documento"]
    if set(colunas) != {"A", "B", "C"}:
        return None, ["documento não cobre versões A/B/C"]
    for versao, valores in colunas.items():
        if set(valores) != set(range(1, total + 1)):
            problemas.append(f"versão {versao} não cobre 1..{total} exatamente")
        if any(valor not in LETRAS | {"ANULADA"} for valor in valores.values()):
            problemas.append(f"letra inválida na versão {versao}")

    canonica = sorted(colunas)[0]
    respostas = colunas[canonica]

    # Cobertura: 1..total, sem buraco e sem sobra.
    faltando = [n for n in range(1, total + 1) if n not in respostas]
    sobrando = [n for n in respostas if n < 1 or n > total]
    if faltando:
        problemas.append(f"versão {canonica} sem as questões {faltando[:8]}")
    if sobrando:
        problemas.append(f"versão {canonica} traz números fora de 1..{total}: {sobrando[:8]}")

    anuladas = sorted(n for n, v in respostas.items() if v == "ANULADA" and 1 <= n <= total)
    for n in range(1, total + 1):
        v = respostas.get(n)
        if v is None or v == "ANULADA":
            continue
        if v not in LETRAS:
            problemas.append(f"questão {n} com letra fora do conjunto: {v}")

    # Colunas idênticas: numa prova reordenada, o gabarito precisa divergir
    # entre versões. Igualdade indica leitura do mesmo bloco duas vezes.
    for outra in sorted(colunas):
        if outra == canonica:
            continue
        comuns = [n for n in respostas if n in colunas[outra]]
        if comuns and all(respostas[n] == colunas[outra][n] for n in comuns):
            problemas.append(f"versões {canonica} e {outra} têm gabarito idêntico")

    # Matérias: ordem do documento, blocos iguais, conferidos contra o caderno.
    ordem = ler_materias(texto, total, cfg["materias"])
    if ordem is None:
        problemas.append("cabeçalho não declara as matérias de forma legível")
        materias, conferidas = {}, False
    else:
        tamanho = total // cfg["materias"]
        materias = {
            ident: [i * tamanho + 1, (i + 1) * tamanho] for i, ident in enumerate(ordem)
        }
        conferidas = False
        if caderno is not None:
            fronteiras = fronteiras_do_caderno(caderno)
            divergencias = [
                f"{ident} começa na {inicio} no caderno, {materias[ident][0]} na divisão"
                for ident, inicio in fronteiras.items()
                if ident in materias and inicio != materias[ident][0]
            ]
            if divergencias:
                problemas.extend(divergencias)
            elif set(fronteiras) == set(materias):
                conferidas = True

    if problemas:
        return None, problemas

    tamanho = total // cfg["materias"]
    letras = ["X" if respostas[n] == "ANULADA" else respostas[n] for n in range(1, total + 1)]
    sequencia = " | ".join(
        " ".join(letras[i : i + tamanho]) for i in range(0, total, tamanho)
    )

    entrada = {
        "edition": str(ano),
        "year": ano,
        "total": total,
        "canonicalVariant": canonica.lower(),
        "variantRelation": "reordered",
        "revision": "rectified" if "RETIFICADO" in plano else "final",
        "sequence": sequencia,
        "annulled": anuladas,
        "variants": [
            {"id": v.lower(), "label": f"Versão {v}", "examUrl": None} for v in sorted(colunas)
        ],
        # Gabarito de cada versão, como lido. Só a canônica vira questão
        # (`variantsToIngest`), mas guardar as outras é o que permite
        # `compareVariantKeys` conferir que são colunas diferentes de verdade.
        "variantAnswers": {
            v.lower(): {
                str(n): ("X" if colunas[v][n] == "ANULADA" else colunas[v][n])
                for n in sorted(colunas[v])
                if 1 <= n <= total
            }
            for v in sorted(colunas)
        },
        "answerKeyUrl": url,
        "examUrl": None,
        "archivePage": PROVAS[prova]["pagina"],
        "subjects": materias,
        "subjectsDerivedFrom": "answer-key-header",
        "subjectBoundariesVerified": conferidas,
        "retrieval": {
            "route": rota,
            "retrievedFrom": origem,
            "sha256": hashlib.sha256(dados).hexdigest(),
            "bytes": len(dados),
            "importedAt": date.today().isoformat(),
        },
        "parserVersion": PARSER_VERSION,
    }
    return entrada, []


# ------------------------------------------------------------------ main


def executar(prova: str, dry_run: bool, com_caderno: bool, anos: list[int] | None) -> int:
    print(f"== {prova.upper()} ==")
    edicoes = descobrir(prova)
    if anos:
        edicoes = {a: u for a, u in edicoes.items() if a in anos}
    if not edicoes:
        print("  nenhuma edição descoberta")
        return 1
    print(f"  {len(edicoes)} edições descobertas: {sorted(edicoes)}")

    aceitas: dict[str, dict] = {}
    recusadas: list[tuple[int, list[str]]] = []

    for ano, candidatos in sorted(edicoes.items()):
        baixado = None
        for candidato in candidatos:
            baixado = baixar_pdf(candidato)
            if baixado:
                url = candidato
                break
        if not baixado:
            recusadas.append((ano, [f"nenhuma das {len(candidatos)} cópias veio íntegra"]))
            print(f"  -- {ano}: documento indisponível")
            continue
        dados, rota, origem = baixado

        caderno = None
        if com_caderno:
            url_caderno = descobrir_caderno(prova, ano)
            if url_caderno:
                obtido = baixar_pdf(url_caderno, tentativas=2)
                if obtido:
                    caderno = obtido[0]

        entrada, problemas = montar(prova, ano, url, dados, rota, origem, caderno)
        if entrada is None:
            recusadas.append((ano, problemas))
            print(f"  -- {ano}: recusada")
            for p in problemas:
                print(f"       {p}")
            continue

        aceitas[str(ano)] = entrada
        marca = "conferidas" if entrada["subjectBoundariesVerified"] else "sem conferência"
        print(
            f"  OK {ano}: {entrada['total']} questões, anuladas {entrada['annulled']}, "
            f"{len(entrada['variants'])} versões, matérias {marca} [{rota}]"
        )

    if not aceitas:
        print("  nenhuma edição aceita")
        return 1

    destino = RAIZ / "src" / "lib" / "providers" / prova / "answer-keys.generated.json"
    if recusadas:
        print(f"  {len(recusadas)} edições recusadas: {[a for a, _ in recusadas]}; nada escrito")
        return 1
    if dry_run:
        print(f"  (dry-run) {len(aceitas)} edições prontas para {destino.name}")
    else:
        destino.parent.mkdir(parents=True, exist_ok=True)
        anteriores = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
        anteriores.update(aceitas)
        temporario = destino.with_suffix(".tmp")
        temporario.write_text(json.dumps(anteriores, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporario.replace(destino)
        print(f"  escrito: {destino.relative_to(RAIZ)} ({len(aceitas)} edições)")

    if recusadas:
        print(f"  {len(recusadas)} edições recusadas: {[a for a, _ in recusadas]}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--provider", choices=sorted(PROVAS), action="append")
    p.add_argument("--year", type=int, action="append")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--verify-manifest", action="store_true")
    p.add_argument("--evidence-output", type=Path)
    p.add_argument("--cache-dir", type=Path)
    p.add_argument("--no-booklets", action="store_true",
                   help="não confere as fronteiras de matéria contra o caderno")
    args = p.parse_args()

    if args.verify_manifest:
        return verificar_manifesto(args.provider or sorted(PROVAS), args.year,
                                   args.evidence_output, args.cache_dir)

    provas = args.provider or sorted(PROVAS)
    codigo = 0
    for prova in provas:
        codigo |= executar(prova, args.dry_run, not args.no_booklets, args.year)
    return codigo


def verificar_documento(prova: str, entrada: dict, dados: bytes) -> dict:
    retrieval = entrada["retrieval"]
    if not dados.startswith(b"%PDF-") or not dados.rstrip().endswith(b"%%EOF"):
        raise ValueError("resposta não é PDF íntegro")
    if hashlib.sha256(dados).hexdigest() != retrieval["sha256"] or len(dados) != retrieval["bytes"]:
        raise ValueError("checksum/tamanho difere do documento ingerido")
    nova, problemas = montar(prova, entrada["year"], entrada["answerKeyUrl"], dados,
                            retrieval["route"], retrieval["retrievedFrom"], None)
    if problemas or nova is None:
        raise ValueError("; ".join(problemas))
    for campo in ("year", "total", "canonicalVariant", "revision", "annulled", "variantAnswers", "subjects"):
        if entrada[campo] != nova[campo]:
            raise ValueError(f"documento diverge do dataset: {campo}")
    if entrada["sequence"].replace("|", " ").split() != nova["sequence"].replace("|", " ").split():
        raise ValueError("documento diverge do dataset: sequence")
    return nova


def verificar_manifesto(provas: list[str], anos: list[int] | None,
                       destino: Path | None, cache: Path | None) -> int:
    from concurrent.futures import ThreadPoolExecutor

    tarefas = []
    for prova in provas:
        arquivo = RAIZ / "src/lib/providers" / prova / "answer-keys.generated.json"
        for entrada in json.loads(arquivo.read_text(encoding="utf-8")).values():
            if not anos or entrada["year"] in anos:
                tarefas.append((prova, entrada))

    def conferir(tarefa):
        prova, entrada = tarefa
        retrieval = entrada["retrieval"]
        url = retrieval["retrievedFrom"]
        evidence = {
            "provider": prova, "year": entrada["year"],
            "originalUrl": entrada["answerKeyUrl"], "effectiveSourceUrl": url,
            "sourceType": "archived-official" if retrieval["route"] == "web-archive" else "official",
            "fetchedAt": None, "sha256": retrieval["sha256"], "bytes": retrieval["bytes"],
            "parserVersion": PARSER_VERSION, "revision": entrada["revision"],
            "validationLevel": "provisional", "validationEvidence": [],
        }
        try:
            if retrieval["route"] == "web-archive":
                expected = r"https://web\.archive\.org/web/\d{14}id_/" + re.escape(entrada["answerKeyUrl"])
                if not re.fullmatch(expected, url):
                    raise ValueError("snapshot não corresponde à URL oficial")
            elif url != entrada["answerKeyUrl"]:
                raise ValueError("origem não corresponde à URL oficial")
            dados = _abrir(url, 90)
            evidence["fetchedAt"] = datetime.now(timezone.utc).isoformat()
            nova = verificar_documento(prova, entrada, dados)
            evidence["datasetSignature"] = assinatura(entrada)
            evidence["validationLevel"] = "reviewed"
            evidence["validationEvidence"] = [
                "PDF completo, SHA-256 e tamanho iguais ao documento ingerido",
                f"{nova['total']}/{nova['total']} respostas em cada versão A/B/C comparadas ao PDF",
                "Edição, revisão final, anuladas e ordem das matérias conferidas no texto",
                "Escopo: gabarito; limites das matérias e permutação A/B/C não comprovados por esta conferência",
            ]
            if cache:
                cache.mkdir(parents=True, exist_ok=True)
                (cache / f"{prova}-{entrada['year']}.pdf").write_bytes(dados)
        except ValueError as erro:
            evidence["validationLevel"] = "blocked"
            evidence["validationEvidence"] = [str(erro)]
        except Exception as erro:
            evidence["validationEvidence"] = [f"Documento não pôde ser conferido nesta execução: {erro}"]
        print(f"{prova} {entrada['year']}: {evidence['validationLevel']}", flush=True)
        return f"{prova}-{entrada['year']}", evidence

    with ThreadPoolExecutor(max_workers=4) as executor:
        registros = dict(executor.map(conferir, tarefas))
    if destino:
        if anos or set(provas) != set(PROVAS):
            raise ValueError("escrita de evidências exige todas as edições e providers")
        destino.write_text(json.dumps(registros, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        print(json.dumps(registros, ensure_ascii=False, indent=2))
    return int(any(item["validationLevel"] != "reviewed" for item in registros.values()))


def assinatura(entrada: dict) -> str:
    campos = ("year", "total", "canonicalVariant", "revision", "sequence", "annulled",
              "variantAnswers", "subjects", "variantRelation", "subjectBoundariesVerified")
    return json.dumps({campo: entrada[campo] for campo in campos},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    raise SystemExit(main())
