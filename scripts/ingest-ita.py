"""
Ingestão dos gabaritos oficiais do ITA.

Por que só o gabarito: as provas publicadas em vestibular.ita.br são PDFs
digitalizados (0 caractere de texto extraível, uma imagem por página), então
não há estrutura para extrair — e reproduzir o enunciado no repositório seria
cópia de conteúdo oficial. O gabarito, ao contrário, tem camada de texto e é
dado factual (número da questão → alternativa), que é o necessário para
corrigir.

O enunciado permanece na fonte oficial: guardamos a URL e a página.

Uso:
    python scripts/ingest-ita.py 2026 2025 2024
Saída:
    src/lib/providers/ita/answer-keys.generated.json
"""

import json
import re
import tempfile
import sys
import urllib.request
from pathlib import Path

BASE = "https://www.vestibular.ita.br/provas"
OUT = Path(__file__).resolve().parent.parent / "src/lib/providers/ita/answer-keys.generated.json"

# Nomes de matéria como aparecem no cabeçalho do gabarito.
SUBJECT_NAMES = {
    "matematica": "mathematics",
    "fisica": "physics",
    "quimica": "chemistry",
    "ingles": "english",
    "portugues": "portuguese",
}


def _strip(s: str) -> str:
    import unicodedata

    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn"
    )


def parse_subject_order(text: str):
    """Lê a ordem das matérias no cabeçalho.

    A ordem e a quantidade mudam por ano: 2026 tem quatro matérias começando
    por Matemática; 2023 tem cinco começando por Física. Assumir uma ordem
    fixa corrompe a correção, então ela é sempre lida do documento.
    """
    for line in text.splitlines():
        flat = _strip(line)
        found = [(flat.index(k), v) for k, v in SUBJECT_NAMES.items() if k in flat]
        if len(found) >= 3:
            return [v for _, v in sorted(found)]
    return []


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "enem-lab-ingest/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def parse_answer_key(text: str):
    """Extrai (número → alternativa) e as anuladas.

    Layout em colunas: uma linha traz vários pares. Anulação aparece como
    marcador de asteriscos, que varia (*), (**), (***) dentro do mesmo ano.
    """
    answers, annulled = {}, []
    for num, mark in re.findall(r"(\d{1,2})\s+([A-E]|\(\*+\))", text):
        n = int(num)
        if not 1 <= n <= 60:
            continue
        if mark.startswith("("):
            annulled.append(n)
        else:
            answers[n] = mark
    return answers, sorted(set(annulled))


def build_ranges(order, total):
    """Divide a numeração em blocos iguais na ordem lida do cabeçalho."""
    if not order or total % len(order):
        return {}
    size = total // len(order)
    return {name: [i * size + 1, (i + 1) * size] for i, name in enumerate(order)}


def main(years):
    try:
        import pypdf
    except ImportError:
        sys.exit("pypdf ausente. Rode: pip install pypdf")

    out = {}
    for year in years:
        url = f"{BASE}/gabarito_{year}.pdf"
        try:
            raw = fetch(url)
        except Exception as e:
            print(f"{year}: falhou o download ({e})")
            continue

        tmp = Path(tempfile.gettempdir()) / f"ita_{year}.pdf"
        tmp.write_bytes(raw)
        reader = pypdf.PdfReader(str(tmp))
        text = "\n".join((p.extract_text() or "") for p in reader.pages)

        if not text.strip():
            print(f"{year}: gabarito sem camada de texto — ignorado (não usamos OCR)")
            continue

        pares = re.findall(r"(\d{1,2})\s+([A-E]|\(\*+\)|\*)", text)
        # Ate 2018 o gabarito numera POR MATERIA, reiniciando em 1 a cada coluna.
        # Tratar isso como numeracao global faz uma materia sobrescrever a outra e
        # corromper a correcao em silencio, entao a edicao e recusada.
        vistos = {}
        repetido = False
        for num, mark in pares:
            if num in vistos and vistos[num] != mark:
                repetido = True
                break
            vistos[num] = mark
        if repetido:
            print(f"{year}: descartado - numeracao por materia (formato antigo)")
            continue

        answers, annulled = parse_answer_key(text)
        order = parse_subject_order(text)
        total = max([*answers.keys(), *annulled], default=0)

        # Correção errada é pior que ausência de dado: só aceitamos a edição
        # quando a numeração está completa e contígua de 1 a total.
        faltando = [n for n in range(1, total + 1) if n not in answers and n not in annulled]
        if not order or total == 0 or faltando:
            print(
                f"{year}: descartado — matérias={order or 'não lidas'}, "
                f"total={total}, faltando={faltando}"
            )
            continue

        ranges = build_ranges(order, total)
        if not ranges:
            print(f"{year}: descartado — {total} questões não divide em {len(order)} matérias")
            continue

        out[str(year)] = {
            "year": year,
            "phase": "first",
            "total": total,
            "answers": {str(k): v for k, v in sorted(answers.items())},
            "annulled": annulled,
            "subjects": ranges,
            "source": {
                "official": True,
                "institution": "ITA",
                "documentUrl": url,
            },
        }
        print(f"{year}: {total} questões, {len(annulled)} anulada(s), matérias={order}")

    if not out:
        sys.exit("Nada ingerido.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nGravado: {OUT.relative_to(OUT.parent.parent.parent.parent)}  ({len(out)} edições)")


if __name__ == "__main__":
    args = sys.argv[1:] or ["2026", "2025", "2024", "2023", "2022"]
    main([int(a) for a in args])
