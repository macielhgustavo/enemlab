#!/usr/bin/env python3
"""Refina exceções semânticas FUVEST de página para questão/linha.

O extrator primário é propositalmente conservador e registra sinais de corrupção
na camada bruta do PDF antes da limpeza. Historicamente esses sinais eram
atribuídos por página, o que pode bloquear várias questões quando somente uma
linha da página contém o glifo suspeito.

Este worker NÃO corrige texto e NÃO aumenta confiança. Ele apenas repete a
varredura sobre as linhas brutas enquanto acompanha os boundaries numéricos já
recuperados pelo parser. Assim, control/replacement/private-use são mantidos
somente nas questões que realmente atravessam uma linha contendo o sinal.
Qualquer edição cujos boundaries não possam ser reconstruídos deterministicamente
continua intocada e deve seguir para outro fallback.
"""

from __future__ import annotations

import argparse
import json
import runpy
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))
WORKER_NAME = "fuvest-semantic-attribution"
WORKER_VERSION = "fuvest-semantic-attribution@0.1.0"
RAW_CODES = {"control-character", "replacement-character", "private-use-character"}


def raw_line_findings(value: str) -> list[tuple[str, int]]:
    controls = sum(
        1
        for char in value
        if unicodedata.category(char) in {"Cc", "Cf"}
        and char not in {"\n", "\r", "\t", "\u00ad"}
    )
    private_use = sum(unicodedata.category(char) == "Co" for char in value)
    findings: list[tuple[str, int]] = []
    if controls:
        findings.append(("control-character", controls))
    if "\ufffd" in value:
        findings.append(("replacement-character", value.count("\ufffd")))
    if private_use:
        findings.append(("private-use-character", private_use))
    return findings


def precise_raw_semantic_issues(
    pages: list[str],
    expected_count: int,
    canonical_variant: str | None,
) -> list[dict[str, Any]]:
    """Mapeia sinais brutos à questão ativa, em vez de à página inteira."""
    expected = 1
    current_question: int | None = None
    counts: dict[tuple[str, int, int], int] = defaultdict(int)
    variant = (canonical_variant or "").strip().upper()

    for page_number, page_text in enumerate(pages, start=1):
        raw_lines = page_text.splitlines()
        for raw_line in raw_lines:
            cleaned = QUESTIONS["clean_line"](raw_line)
            rest = QUESTIONS["question_start"](cleaned, expected)
            if rest is not None:
                current_question = expected
                expected += 1

            if current_question is None:
                continue
            # A marca de variante no rodapé não faz parte da questão.
            if variant and cleaned.upper() == variant:
                continue

            for code, count in raw_line_findings(raw_line):
                counts[(code, current_question, page_number)] += count

    if expected != expected_count + 1:
        raise ValueError(
            "boundaries numéricos não puderam ser reconstruídos para atribuição semântica precisa"
        )

    issues: list[dict[str, Any]] = []
    for (code, question_number, page_number), count in sorted(
        counts.items(), key=lambda item: (item[0][1], item[0][2], item[0][0])
    ):
        if code == "control-character":
            message = (
                f"linha bruta atribuída à questão contém {count} caractere(s) de controle "
                "removidos antes da estruturação"
            )
        elif code == "replacement-character":
            message = (
                f"linha bruta atribuída à questão contém {count} ocorrência(s) de U+FFFD "
                "(glifo perdido)"
            )
        else:
            message = (
                f"linha bruta atribuída à questão contém {count} glifo(s) Unicode de uso privado"
            )
        issues.append(
            {
                "code": code,
                "severity": "error",
                "questionNumber": question_number,
                "page": page_number,
                "message": message,
            }
        )
    return issues


def refine_envelope(
    envelope: dict[str, Any],
    pages: list[str],
    canonical_variant: str | None,
) -> dict[str, Any]:
    if envelope.get("protocolVersion") != "enemlab-extraction/v1":
        raise ValueError("unsupported extraction protocol")
    extraction = envelope.get("extraction")
    if not isinstance(extraction, dict):
        raise ValueError("extraction envelope is malformed")
    questions = extraction.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError("extraction has no questions")

    precise = precise_raw_semantic_issues(pages, len(questions), canonical_variant)
    retained = [
        dict(issue)
        for issue in extraction.get("semanticFidelityIssues", [])
        if issue.get("code") not in RAW_CODES
    ]
    refined_extraction = dict(extraction)
    refined_extraction["semanticFidelityIssues"] = retained + precise
    warnings = list(refined_extraction.get("warnings", []))
    warnings.append(
        f"{WORKER_VERSION}: sinais brutos control/replacement/private-use reatribuídos por linha/questão; nenhuma correção de conteúdo aplicada"
    )
    refined_extraction["warnings"] = warnings

    refined = dict(envelope)
    refined["extraction"] = refined_extraction
    refinements = list(refined.get("refinements", []))
    refinements.append(
        {
            "name": WORKER_NAME,
            "version": WORKER_VERSION,
            "mode": "attribution-only",
        }
    )
    refined["refinements"] = refinements
    return refined


def affected_questions(envelope: dict[str, Any], codes: set[str] = RAW_CODES) -> set[int]:
    return {
        int(issue["questionNumber"])
        for issue in envelope.get("extraction", {}).get("semanticFidelityIssues", [])
        if issue.get("code") in codes
        and issue.get("severity") != "warning"
        and issue.get("questionNumber") is not None
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--metrics", action="store_true")
    args = parser.parse_args(argv)

    manifest = QUESTIONS["load_manifest"]()
    entry, exam_bytes, key_bytes, pages = QUESTIONS["load_year_documents"](args.year, manifest)
    try:
        envelope = QUESTIONS["build_envelope"](entry, exam_bytes, key_bytes, pages)
    except Exception as error:  # noqa: BLE001
        print(
            f"FUVEST {args.year}: REFINAMENTO BLOQUEADO — extração primária não fechou: {error}",
            file=sys.stderr,
        )
        return 1

    before = affected_questions(envelope)
    try:
        refined = refine_envelope(
            envelope,
            pages,
            str(entry.get("canonicalVariant") or ""),
        )
    except Exception as error:  # noqa: BLE001
        print(f"FUVEST {args.year}: REFINAMENTO BLOQUEADO — {error}", file=sys.stderr)
        return 1
    after = affected_questions(refined)

    payload = json.dumps(refined, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)

    if args.metrics:
        print(
            json.dumps(
                {
                    "year": args.year,
                    "rawSemanticAffectedBefore": len(before),
                    "rawSemanticAffectedAfter": len(after),
                    "removedFalsePositiveQuestionAssignments": len(before - after),
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
