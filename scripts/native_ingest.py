#!/usr/bin/env python3
"""Porta pública única do pipeline nativo do Studium.

`native_orchestrator.py` contém a engine/adapters básicos. Este módulo aplica a
política fail-closed do produto: só deixa `ready` o que possui identidade de
questão compatível com o provider executável e fonte de caderno adequada.

Assim, `npm run native:inventory` é a lista real do que podemos nativar agora;
providers custom sem adapter explícito aparecem bloqueados, nunca com chave
inventada.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import replace
from pathlib import Path
from typing import Any

import native_orchestrator as core

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = ROOT / "src" / "lib" / "providers"

# Estes providers foram auditados contra a implementação real de questionKey
# no app. Novos providers NÃO entram aqui por semelhança de formato: precisam
# ser conferidos antes, porque a chave alimenta histórico, SRS e mastery.
AUDITED_REFERENCE_IDENTITIES = {"unesp", "fatec", "eear"}
AUDITED_YEAR_PHASE_IDENTITIES = {"espcex", "ita"}

CUSTOM_IDENTITY_BLOCKED = {
    "afa": "provider usa identidade custom; adapter nativo ainda não declarou a chave",
    "epcar": "provider usa identidade custom; adapter nativo ainda não declarou a chave",
    "ime": "questionKey histórica inclui objective; não usar fórmula genérica",
}


def _normalize_key_segment(value: str) -> str:
    """Espelha `buildQuestionKey()` do app para formatos já auditados."""
    lowered = unicodedata.normalize("NFD", value.lower())
    without_marks = "".join(char for char in lowered if unicodedata.category(char) != "Mn")
    normalized = re.sub(r"[^a-z0-9-]+", "-", without_marks).strip("-")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", normalized):
        raise core.NativeOrchestratorError(f"segmento de questionKey inválido: {value!r}")
    return normalized


def _build_question_key_format(
    *,
    provider_id: str,
    edition_id: str,
    phase: str,
    language: str | None = None,
) -> str:
    parts = [provider_id, edition_id, phase]
    if language:
        parts.append(language)
    return "-".join(_normalize_key_segment(part) for part in parts) + "-{number}"


def _question_key_format(target: core.NativeTarget) -> str | None:
    """Retorna formato somente quando a identidade foi auditada contra o app."""
    if target.provider_id in AUDITED_REFERENCE_IDENTITIES:
        return _build_question_key_format(
            provider_id=target.provider_id,
            edition_id=target.edition_id or str(target.year),
            phase=target.phase,
        )
    if target.provider_id in AUDITED_YEAR_PHASE_IDENTITIES:
        return _build_question_key_format(
            provider_id=target.provider_id,
            edition_id=str(target.year),
            phase=target.phase,
        )
    if target.provider_id == "unioeste":
        # O provider acrescenta idioma a toda a sessão da manhã antes de
        # `referenceQuestionKey()`. A tarde não recebe esse segmento.
        return _build_question_key_format(
            provider_id="unioeste",
            edition_id=str(target.year),
            phase=target.phase,
            language="ingles" if target.phase == "morning" else None,
        )
    return None


def question_key_for(target: core.NativeTarget, number: int) -> str:
    if not 1 <= number <= target.total:
        raise core.NativeOrchestratorError(f"número fora do alvo: {number}")
    pattern = _question_key_format(target)
    if not pattern:
        raise core.NativeOrchestratorError(
            f"{target.identity}: questionKey não comprovada contra o provider executável"
        )
    return pattern.replace("{number}", str(number))


def _blocked_custom_targets(provider_id: str, reason: str) -> list[core.NativeTarget]:
    path = PROVIDERS / provider_id / "answer-keys.generated.json"
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    out: list[core.NativeTarget] = []
    for key, record in raw.items():
        if not isinstance(record, dict) or "year" not in record or "total" not in record:
            continue
        out.append(
            core.NativeTarget(
                provider_id=provider_id,
                year=int(record["year"]),
                phase="first",
                edition_id=str(record.get("edition") or key) if provider_id == "ime" else None,
                label=f"{provider_id.upper()} {record.get('edition') or record['year']}",
                total=int(record["total"]),
                option_ids=core.LETTERS,
                exam_url=core._canonical_exam_url(record),
                source_kind="custom-identity-pending",
                status="blocked",
                reason=reason,
            )
        )
    return out


def _unioeste_targets() -> list[core.NativeTarget]:
    path = PROVIDERS / "unioeste" / "data.ts"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    # SPECS are intentionally one-line records, which makes the transitional
    # adapter deterministic without executing TypeScript.
    pattern = re.compile(
        r'\{\s*year:\s*(?P<year>\d+),\s*morning:\s*"(?P<morning>[A-EX]+)",\s*afternoon:\s*"(?P<afternoon>[A-EX]+)",\s*morningExamUrl:\s*"(?P<morning_url>[^"]+)",\s*afternoonExamUrl:\s*"(?P<afternoon_url>[^"]+)"',
        re.S,
    )
    out: list[core.NativeTarget] = []
    for match in pattern.finditer(text):
        year = int(match.group("year"))
        for phase, seq_field, url_field in (
            ("morning", "morning", "morning_url"),
            ("afternoon", "afternoon", "afternoon_url"),
        ):
            sequence = match.group(seq_field)
            out.append(
                core._ready_or_blocked(
                    provider_id="unioeste",
                    year=year,
                    phase=phase,
                    edition_id=str(year),
                    label=f"UNIOESTE {year} {phase}",
                    total=len(sequence),
                    option_ids=core.LETTERS,
                    exam_url=match.group(url_field),
                    source_kind="unioeste-generated-ts",
                )
            )
    return out


def discover_targets() -> list[core.NativeTarget]:
    base = core.discover_targets()
    filtered = [
        target
        for target in base
        if target.provider_id not in {*CUSTOM_IDENTITY_BLOCKED.keys(), "unioeste"}
    ]
    for provider_id, reason in CUSTOM_IDENTITY_BLOCKED.items():
        filtered.extend(_blocked_custom_targets(provider_id, reason))
    filtered.extend(_unioeste_targets())

    unique: dict[str, core.NativeTarget] = {}
    for target in filtered:
        if target.identity in unique and unique[target.identity] != target:
            raise core.NativeOrchestratorError(f"alvo nativo duplicado: {target.identity}")
        unique[target.identity] = target

    # `ready` significa que o comando prepare pode realmente produzir chaves
    # iguais às usadas pelo app. Sem adapter auditado, o alvo é bloqueado mesmo
    # se URL/gabarito/formato estiverem corretos.
    gated: list[core.NativeTarget] = []
    for target in unique.values():
        if target.status == "ready" and _question_key_format(target) is None:
            target = replace(
                target,
                status="blocked",
                reason="questionKey ainda não auditada contra o provider executável",
            )
        gated.append(target)

    return sorted(
        gated,
        key=lambda target: (target.provider_id, -target.year, target.edition_id or "", target.phase),
    )


def _payload(targets: list[core.NativeTarget]) -> dict[str, Any]:
    ready = [target for target in targets if target.status == "ready"]
    blocked = [target for target in targets if target.status != "ready"]
    return {
        "schemaVersion": 2,
        "providers": len({target.provider_id for target in targets}),
        "targets": len(targets),
        "ready": len(ready),
        "blocked": len(blocked),
        "objectiveQuestionsReady": sum(target.total for target in ready),
        "items": [
            core.asdict(target)
            | {
                "identity": target.identity,
                "identityValid": _question_key_format(target) is not None,
                "questionKeyFormat": _question_key_format(target),
            }
            for target in targets
        ],
    }


def _prepare(target: core.NativeTarget, *, pdf_override: Path | None = None) -> dict[str, Any]:
    if target.status != "ready" and not pdf_override:
        raise core.NativeOrchestratorError(f"{target.identity} bloqueado: {target.reason}")

    question_key_format = _question_key_format(target)
    if not question_key_format:
        raise core.NativeOrchestratorError(
            f"{target.identity} bloqueado: questionKey não comprovada contra o provider executável"
        )

    output = target.output_dir
    output.mkdir(parents=True, exist_ok=True)
    pdf = pdf_override or output / "source.pdf"
    if pdf_override is None:
        if not target.exam_url:
            raise core.NativeOrchestratorError("caderno objetivo sem URL no catálogo")
        core._download_pdf(target.exam_url, pdf)
    elif not pdf.exists():
        raise core.NativeOrchestratorError(f"PDF local não encontrado: {pdf}")

    spec_path = core._write_spec(target, pdf, output / "spec.json")
    payload = json.loads(spec_path.read_text(encoding="utf-8"))
    payload["questionKeyFormat"] = question_key_format
    spec_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    pipeline = core._load_native_pipeline()
    spec = pipeline._load_spec(spec_path)
    return pipeline.build_pack(spec, pdf, output)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Studium: descobrir → validar → preparar → revisar → publicar.")
    sub = parser.add_subparsers(dest="command", required=True)

    inventory = sub.add_parser("inventory")
    inventory.add_argument("--json", action="store_true")
    inventory.add_argument("--write", type=Path)

    one = sub.add_parser("prepare")
    one.add_argument("provider")
    one.add_argument("selector")
    one.add_argument("--phase")
    one.add_argument("--pdf", type=Path)

    many = sub.add_parser("prepare-all")
    many.add_argument("--provider")
    many.add_argument("--limit", type=int, default=0)

    args = parser.parse_args(argv)
    targets = discover_targets()

    if args.command == "inventory":
        payload = _payload(targets)
        if args.write:
            args.write.parent.mkdir(parents=True, exist_ok=True)
            args.write.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(
                f"{payload['providers']} providers | {payload['targets']} alvos | "
                f"{payload['ready']} prontos | {payload['blocked']} bloqueados | "
                f"{payload['objectiveQuestionsReady']} questões prontas"
            )
            for target in targets:
                detail = f" — {target.reason}" if target.reason else ""
                print(f"[{target.status.upper():7}] {target.identity} ({target.total}){detail}")
        return 0

    if args.command == "prepare":
        target = core._select_target(targets, args.provider, args.selector, args.phase)
        pack = _prepare(target, pdf_override=args.pdf)
        summary = pack["reviewSummary"]
        print(
            f"{target.identity}: {summary['markers']}/{summary['expected']} marcadores; "
            f"{summary['needsReview']} exceções semânticas."
        )
        print(f"Próximo gate: /data/native-review → {target.output_dir / 'native-pack.json'}")
        return 0

    selected = [target for target in targets if target.status == "ready"]
    if args.provider:
        selected = [target for target in selected if target.provider_id == args.provider]
    if args.limit:
        selected = selected[: args.limit]
    failures = 0
    for target in selected:
        try:
            _prepare(target)
            print(f"OK {target.identity}")
        except Exception as error:  # batch deliberately reports all failures.
            failures += 1
            print(f"FAIL {target.identity}: {error}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
