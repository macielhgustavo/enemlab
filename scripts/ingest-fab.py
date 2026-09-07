#!/usr/bin/env python3
"""Valida e materializa as chaves finais da FAB.

    python scripts/ingest-fab.py --dry-run
    python scripts/ingest-fab.py --provider afa

As fontes oficiais da FAB publicam PDFs com versões A/B/C. Esta wave conserva
a versão A como canônica e mantém as outras como referência. O enunciado não
é copiado: a questão continua apontando para o documento oficial.

O script lê o bruto versionado em src/lib/providers/*/answer-keys.generated.json
e aplica as mesmas barreiras do importador: edição final, sequência completa,
anulações consistentes, matérias contíguas e URL oficial. Uma edição inválida
não é escrita.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PARSER_VERSION = "fab-answer-key@1.0.0"
PROVIDERS = ("afa", "epcar")
LETRAS = set("ABCD")


def tokens(sequence: str) -> list[str]:
    return [token for token in sequence.upper().replace("|", " ").split() if token]


def validar_sequencia(entry: dict) -> list[str]:
    problemas: list[str] = []
    total = entry["total"]
    anuladas = set(entry["annulled"])
    values = tokens(entry["sequence"])

    if len(values) != total:
        problemas.append(f"sequência cobre {len(values)} de {total}")

    for number, value in enumerate(values[:total], start=1):
        if value == "X":
            if number not in anuladas:
                problemas.append(f"questão {number} marcada como anulada sem registro")
        elif value not in LETRAS:
            problemas.append(f"questão {number} tem letra inválida: {value}")
        elif number in anuladas:
            problemas.append(f"questão {number} anulada com resposta {value}")

    for number in sorted(anuladas):
        if number < 1 or number > total:
            problemas.append(f"anulada fora de 1..{total}: {number}")
        elif number > len(values) or values[number - 1] != "X":
            problemas.append(f"anulação {number} não está marcada na sequência")

    return problemas


def validar_materias(entry: dict) -> list[str]:
    total = entry["total"]
    covered: list[int] = []
    problemas: list[str] = []
    for subject, interval in entry["subjects"].items():
        if len(interval) != 2 or interval[0] > interval[1]:
            problemas.append(f"faixa inválida em {subject}")
            continue
        covered.extend(range(interval[0], interval[1] + 1))

    expected = set(range(1, total + 1))
    if len(covered) != len(set(covered)) or set(covered) != expected:
        problemas.append(f"matérias não cobrem 1..{total} exatamente")
    return problemas


def validar_entry(provider: str, entry: dict) -> list[str]:
    problemas = []
    if entry.get("revision") not in ("final", "rectified"):
        problemas.append("gabarito não final")
    if entry.get("variantRelation") != "reordered":
        problemas.append("relação de variantes não suportada")
    if entry.get("canonicalVariant") not in {v["id"] for v in entry["variants"]}:
        problemas.append("variante canônica ausente")
    if not entry.get("answerKeyUrl", "").startswith("https://www.fab.mil.br/"):
        problemas.append("gabarito não oficial")
    if entry.get("parserVersion") != PARSER_VERSION:
        problemas.append("versão de parser incompatível")
    problemas.extend(validar_sequencia(entry))
    problemas.extend(validar_materias(entry))
    if problemas:
        return [f"{provider} {entry.get('edition')}: {problem}" for problem in problemas]
    return []


def carregar(provider: str) -> dict:
    path = RAIZ / "src" / "lib" / "providers" / provider / "answer-keys.generated.json"
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=PROVIDERS)
    parser.add_argument("--year", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    providers = (args.provider,) if args.provider else PROVIDERS
    invalid: list[str] = []
    accepted: dict[str, dict[str, dict]] = {}

    for provider in providers:
        entries = carregar(provider)
        output: dict[str, dict] = {}
        for edition, entry in sorted(entries.items(), reverse=True):
            if args.year is not None and entry["year"] != args.year:
                continue
            problems = validar_entry(provider, entry)
            if problems:
                invalid.extend(problems)
                print(f"{entry['edition']}: RECUSADA — {'; '.join(problems)}")
                continue
            output[edition] = entry
            print(f"{provider} {edition}: ACEITA — {entry['total']} questões, versão A canônica")
        accepted[provider] = output

    if invalid:
        print(f"\n{len(invalid)} problema(s); nada foi escrito.", file=sys.stderr)
        return 1
    if args.dry_run:
        print("\n--dry-run: nada foi escrito.")
        return 0

    for provider, entries in accepted.items():
        path = RAIZ / "src" / "lib" / "providers" / provider / "answer-keys.generated.json"
        path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("\ncatálogos FAB escritos de forma determinística.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
