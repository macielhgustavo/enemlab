#!/usr/bin/env python3
"""Orquestra descoberta já validada -> PDF -> NativePack revisável.

A ideia é ter uma única porta de entrada para o acervo existente e para novas
provas. Este arquivo NÃO inventa gabaritos nem publica automaticamente: ele
reaproveita catálogos/providers já validados, baixa somente o caderno objetivo,
fixa o SHA-256 e delega a extração visual/semântica a native_pipeline.py.

Uso:
  python scripts/native_orchestrator.py inventory
  python scripts/native_orchestrator.py prepare unesp 2026
  python scripts/native_orchestrator.py prepare fuvest 2026
  python scripts/native_orchestrator.py prepare-all --provider unesp

Saída privada/local: .native-out/<provider>/<edition>/<phase>/
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import ssl
import sys
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = ROOT / "src" / "lib" / "providers"
OUT = ROOT / ".native-out"
LETTERS = ("A", "B", "C", "D", "E")
HTTP_HEADERS = {"User-Agent": "studium-native-ingestion/1.0"}

# Providers whose app identity uses editionId explicitly.
NAMED_EDITION_PROVIDERS = {"acafe", "udesc", "eear", "fatec", "unioeste", "esa"}

# Explicit defense-in-depth. Current EEAR corpus was already curated, but the
# orchestrator must not make it easy to reintroduce weapon/security-specific
# specialty material in future refreshes.
SENSITIVE_EEAR_TERMS = (
    "armamento",
    "armas",
    "municao",
    "munições",
    "seguranca",
    "segurança",
    "guarda e seguranca",
    "guarda e segurança",
)


class NativeOrchestratorError(ValueError):
    pass


@dataclass(frozen=True)
class NativeTarget:
    provider_id: str
    year: int
    phase: str
    edition_id: str | None
    label: str
    total: int
    option_ids: tuple[str, ...]
    exam_url: str | None
    source_kind: str
    status: str
    reason: str | None = None
    marker_pattern: str | None = None

    @property
    def identity(self) -> str:
        edition = self.edition_id or str(self.year)
        return f"{self.provider_id}:{edition}:{self.phase}"

    @property
    def output_dir(self) -> Path:
        edition = self.edition_id or str(self.year)
        return OUT / self.provider_id / edition / self.phase


def _load_native_pipeline():
    path = ROOT / "scripts" / "native_pipeline.py"
    spec = importlib.util.spec_from_file_location("studium_native_pipeline", path)
    if spec is None or spec.loader is None:
        raise NativeOrchestratorError("não foi possível carregar native_pipeline.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _final_revision(record: dict[str, Any]) -> bool:
    revision = str(record.get("revision") or "final").lower()
    return revision not in {"preliminary", "provisional", "provisorio", "provisório"}


def _canonical_exam_url(record: dict[str, Any]) -> str | None:
    direct = record.get("examUrl")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    canonical = record.get("canonicalVariant")
    variants = record.get("variants")
    if canonical and isinstance(variants, list):
        for variant in variants:
            if isinstance(variant, dict) and variant.get("id") == canonical:
                url = variant.get("examUrl")
                return str(url).strip() if url else None
    return None


def _option_ids(record: dict[str, Any]) -> tuple[str, ...]:
    raw = record.get("optionIds")
    values = tuple(str(item).upper() for item in raw) if isinstance(raw, list) else LETTERS
    if len(values) < 2 or len(set(values)) != len(values):
        raise NativeOrchestratorError("conjunto de alternativas inválido")
    if any(value not in LETTERS for value in values):
        raise NativeOrchestratorError("somente resposta única A-E é suportada")
    return values


def _ready_or_blocked(
    *,
    provider_id: str,
    year: int,
    phase: str,
    edition_id: str | None,
    label: str,
    total: int,
    option_ids: tuple[str, ...],
    exam_url: str | None,
    source_kind: str,
    reason: str | None = None,
    marker_pattern: str | None = None,
) -> NativeTarget:
    if reason:
        status = "blocked"
    elif not exam_url:
        status = "blocked"
        reason = "caderno objetivo sem URL no catálogo"
    elif not re.match(r"^https?://", exam_url, re.IGNORECASE):
        status = "blocked"
        reason = "URL do caderno não é HTTP(S)"
    elif total < 1:
        status = "blocked"
        reason = "total de questões inválido"
    else:
        status = "ready"
    return NativeTarget(
        provider_id=provider_id,
        year=year,
        phase=phase,
        edition_id=edition_id,
        label=label,
        total=total,
        option_ids=option_ids,
        exam_url=exam_url,
        source_kind=source_kind,
        status=status,
        reason=reason,
        marker_pattern=marker_pattern,
    )


def _generic_json_targets(provider_id: str, path: Path) -> list[NativeTarget]:
    raw = _read_json(path)
    if not isinstance(raw, dict):
        return []
    targets: list[NativeTarget] = []
    for key, value in raw.items():
        if not isinstance(value, dict) or "total" not in value or "year" not in value:
            continue
        if "days" in value:  # EsPCEx is handled separately.
            continue
        if not _final_revision(value):
            continue
        year = int(value["year"])
        edition = str(value.get("edition") or key)
        edition_id = edition if provider_id in NAMED_EDITION_PROVIDERS else None
        phase = str(value.get("phase") or ("first" if provider_id in {"fuvest", "ita"} else "single"))
        try:
            options = _option_ids(value)
        except NativeOrchestratorError as error:
            targets.append(
                _ready_or_blocked(
                    provider_id=provider_id,
                    year=year,
                    phase=phase,
                    edition_id=edition_id,
                    label=f"{provider_id.upper()} {edition}",
                    total=int(value["total"]),
                    option_ids=LETTERS,
                    exam_url=None,
                    source_kind="provider-json",
                    reason=str(error),
                )
            )
            continue
        targets.append(
            _ready_or_blocked(
                provider_id=provider_id,
                year=year,
                phase=phase,
                edition_id=edition_id,
                label=str(value.get("label") or f"{provider_id.upper()} {edition}"),
                total=int(value["total"]),
                option_ids=options,
                exam_url=_canonical_exam_url(value),
                source_kind="provider-json",
            )
        )
    return targets


def _espcex_targets(path: Path) -> list[NativeTarget]:
    raw = _read_json(path)
    targets: list[NativeTarget] = []
    for _, record in raw.items():
        if not isinstance(record, dict):
            continue
        year = int(record["year"])
        for phase in ("day1", "day2"):
            day = (record.get("days") or {}).get(phase)
            if not isinstance(day, dict):
                continue
            targets.append(
                _ready_or_blocked(
                    provider_id="espcex",
                    year=year,
                    phase=phase,
                    edition_id=None,
                    label=f"EsPCEx {year} {phase}",
                    total=int(day["total"]),
                    option_ids=LETTERS,
                    exam_url=day.get("examUrl"),
                    source_kind="espcex-json",
                )
            )
    return targets


def _esa_targets(path: Path) -> list[NativeTarget]:
    raw = _read_json(path)
    targets: list[NativeTarget] = []
    for _, record in raw.items():
        if not isinstance(record, dict):
            continue
        year = int(record["year"])
        variant = str(record.get("variant") or "A").lower()
        edition = f"{year}-geral-{variant}"
        url = record.get("examUrl")
        # O acervo atual da ESA usa páginas HTML do QConcursos em algumas
        # edições. O native pipeline exige o PDF real e falha fechado aqui.
        reason = None
        if isinstance(url, str) and url and not re.search(r"\.pdf(?:$|[?#])", url, re.I):
            reason = "fonte atual é página HTML; localizar PDF antes de nativar"
        targets.append(
            _ready_or_blocked(
                provider_id="esa",
                year=year,
                phase="single",
                edition_id=edition,
                label=f"ESA {year} área geral",
                total=int(record["total"]),
                option_ids=LETTERS,
                exam_url=url if isinstance(url, str) else None,
                source_kind="esa-json",
                reason=reason,
            )
        )
    return targets


def _ita_targets(path: Path) -> list[NativeTarget]:
    raw = _read_json(path)
    targets: list[NativeTarget] = []
    for _, record in raw.items():
        if not isinstance(record, dict):
            continue
        year = int(record["year"])
        targets.append(
            _ready_or_blocked(
                provider_id="ita",
                year=year,
                phase="first",
                edition_id=None,
                label=f"ITA {year} 1ª fase",
                total=int(record["total"]),
                option_ids=LETTERS,
                exam_url=f"https://www.vestibular.ita.br/provas/{year}_fase1.pdf",
                source_kind="ita-template",
                reason="PDF digitalizado: preparar requer OCR/revisão visual" if year else None,
            )
        )
    return targets


def _eear_targets() -> list[NativeTarget]:
    targets: list[NativeTarget] = []
    for path in sorted((PROVIDERS / "eear").glob("eear-*-*.generated.ts")):
        text = path.read_text(encoding="utf-8")
        # Os arquivos gerados são arrays JSON válidos seguidos de `as const`.
        start = text.find("[")
        end = text.rfind("]")
        if start < 0 or end < start:
            continue
        try:
            specs = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            continue
        for spec in specs:
            if not isinstance(spec, dict):
                continue
            label = str(spec.get("label") or spec.get("id") or "EEAR")
            specialty = str(spec.get("specialty") or "")
            searchable = f"{label} {specialty}".lower()
            if any(term in searchable for term in SENSITIVE_EEAR_TERMS):
                continue
            canonical = spec.get("canonical") or {}
            targets.append(
                _ready_or_blocked(
                    provider_id="eear",
                    year=int(spec["year"]),
                    phase="single",
                    edition_id=str(spec["id"]),
                    label=label,
                    total=int(spec["total"]),
                    option_ids=("A", "B", "C", "D"),
                    exam_url=canonical.get("examUrl") if isinstance(canonical, dict) else None,
                    source_kind="eear-generated-ts",
                )
            )
    return targets


def _fatec_targets() -> list[NativeTarget]:
    path = PROVIDERS / "fatec" / "data.ts"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    targets: list[NativeTarget] = []
    # Transitional adapter. Future importers should emit NativeTarget directly.
    pattern = re.compile(
        r'id:\s*"(?P<id>[^"]+)".*?year:\s*(?P<year>\d+).*?label:\s*"(?P<label>[^"]+)".*?total:\s*(?P<total>\d+).*?examUrl:\s*"(?P<url>[^"]+)"',
        re.S,
    )
    for match in pattern.finditer(text):
        targets.append(
            _ready_or_blocked(
                provider_id="fatec",
                year=int(match.group("year")),
                phase="single",
                edition_id=match.group("id"),
                label=match.group("label"),
                total=int(match.group("total")),
                option_ids=LETTERS,
                exam_url=match.group("url"),
                source_kind="fatec-generated-ts",
            )
        )
    return targets


def _unioeste_targets() -> list[NativeTarget]:
    path = PROVIDERS / "unioeste" / "data.ts"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    targets: list[NativeTarget] = []
    # Each edition stores one exam URL and yields morning/afternoon sessions in
    # the provider. We produce one NativeTarget per executable phase.
    pattern = re.compile(
        r'id:\s*"(?P<id>[^"]+)".*?year:\s*(?P<year>\d+).*?label:\s*"(?P<label>[^"]+)".*?examUrl:\s*"(?P<url>[^"]+)".*?morningTotal:\s*(?P<morning>\d+).*?afternoonTotal:\s*(?P<afternoon>\d+)',
        re.S,
    )
    for match in pattern.finditer(text):
        for phase, field in (("morning", "morning"), ("afternoon", "afternoon")):
            total = int(match.group(field))
            if total <= 0:
                continue
            targets.append(
                _ready_or_blocked(
                    provider_id="unioeste",
                    year=int(match.group("year")),
                    phase=phase,
                    edition_id=match.group("id"),
                    label=f"{match.group('label')} {phase}",
                    total=total,
                    option_ids=LETTERS,
                    exam_url=match.group("url"),
                    source_kind="unioeste-generated-ts",
                )
            )
    return targets


def discover_targets() -> list[NativeTarget]:
    targets: list[NativeTarget] = []
    for provider_dir in sorted(PROVIDERS.iterdir()):
        if not provider_dir.is_dir():
            continue
        provider_id = provider_dir.name
        path = provider_dir / "answer-keys.generated.json"
        if not path.exists():
            continue
        if provider_id == "espcex":
            targets.extend(_espcex_targets(path))
        elif provider_id == "esa":
            targets.extend(_esa_targets(path))
        elif provider_id == "ita":
            targets.extend(_ita_targets(path))
        else:
            targets.extend(_generic_json_targets(provider_id, path))
    targets.extend(_eear_targets())
    targets.extend(_fatec_targets())
    targets.extend(_unioeste_targets())

    unique: dict[str, NativeTarget] = {}
    for target in targets:
        # If a provider adapter accidentally sees the same executable identity
        # twice, stop instead of choosing one source silently.
        if target.identity in unique and unique[target.identity] != target:
            raise NativeOrchestratorError(f"alvo nativo duplicado: {target.identity}")
        unique[target.identity] = target
    return sorted(
        unique.values(),
        key=lambda target: (target.provider_id, -target.year, target.edition_id or "", target.phase),
    )


def _download_pdf(url: str, destination: Path) -> Path:
    request = urllib.request.Request(url, headers=HTTP_HEADERS)
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, context=context, timeout=90) as response:
        data = response.read()
    if not data.lstrip().startswith(b"%PDF"):
        raise NativeOrchestratorError("fonte não retornou um PDF")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return destination


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_spec(target: NativeTarget, pdf: Path, path: Path) -> Path:
    payload: dict[str, Any] = {
        "providerId": target.provider_id,
        "year": target.year,
        "phase": target.phase,
        **({"editionId": target.edition_id} if target.edition_id else {}),
        "total": target.total,
        "optionIds": list(target.option_ids),
        "sourceSha256": _sha256(pdf),
        "sourceUrl": target.exam_url,
    }
    if target.marker_pattern:
        payload["markerPattern"] = target.marker_pattern
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def prepare(target: NativeTarget, *, pdf_override: Path | None = None) -> dict[str, Any]:
    if target.status != "ready" and not pdf_override:
        raise NativeOrchestratorError(f"{target.identity} bloqueado: {target.reason}")
    output = target.output_dir
    output.mkdir(parents=True, exist_ok=True)
    pdf = pdf_override or output / "source.pdf"
    if pdf_override is None:
        assert target.exam_url
        _download_pdf(target.exam_url, pdf)
    elif not pdf.exists():
        raise NativeOrchestratorError(f"PDF local não encontrado: {pdf}")

    spec_path = _write_spec(target, pdf, output / "spec.json")
    pipeline = _load_native_pipeline()
    spec = pipeline._load_spec(spec_path)
    pack = pipeline.build_pack(spec, pdf, output)
    return pack


def _select_target(targets: Iterable[NativeTarget], provider: str, selector: str, phase: str | None) -> NativeTarget:
    candidates = [
        target
        for target in targets
        if target.provider_id == provider
        and selector in {str(target.year), target.edition_id or ""}
        and (phase is None or target.phase == phase)
    ]
    if not candidates:
        raise NativeOrchestratorError(f"alvo não encontrado: {provider} {selector} {phase or ''}".strip())
    if len(candidates) > 1:
        options = ", ".join(target.identity for target in candidates)
        raise NativeOrchestratorError(f"alvo ambíguo; informe --phase. Opções: {options}")
    return candidates[0]


def _inventory_payload(targets: list[NativeTarget]) -> dict[str, Any]:
    providers = sorted({target.provider_id for target in targets})
    ready = [target for target in targets if target.status == "ready"]
    blocked = [target for target in targets if target.status != "ready"]
    return {
        "schemaVersion": 1,
        "providers": len(providers),
        "targets": len(targets),
        "ready": len(ready),
        "blocked": len(blocked),
        "objectiveQuestionsReady": sum(target.total for target in ready),
        "items": [asdict(target) | {"identity": target.identity} for target in targets],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Orquestra acervo existente -> NativePack revisável.")
    sub = parser.add_subparsers(dest="command", required=True)

    inventory = sub.add_parser("inventory")
    inventory.add_argument("--json", action="store_true", help="imprime JSON completo")
    inventory.add_argument("--write", type=Path, help="grava inventário em arquivo")

    one = sub.add_parser("prepare")
    one.add_argument("provider")
    one.add_argument("selector", help="ano ou editionId")
    one.add_argument("--phase")
    one.add_argument("--pdf", type=Path, help="PDF local; evita download e mantém SHA calculado")

    many = sub.add_parser("prepare-all")
    many.add_argument("--provider")
    many.add_argument("--limit", type=int, default=0)

    args = parser.parse_args(argv)
    targets = discover_targets()

    if args.command == "inventory":
        payload = _inventory_payload(targets)
        if args.write:
            args.write.parent.mkdir(parents=True, exist_ok=True)
            args.write.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(
                f"{payload['providers']} providers | {payload['targets']} alvos | "
                f"{payload['ready']} prontos | {payload['blocked']} bloqueados | "
                f"{payload['objectiveQuestionsReady']} questões prontas para pipeline"
            )
            for target in targets:
                suffix = f" — {target.reason}" if target.reason else ""
                print(f"[{target.status.upper():7}] {target.identity} ({target.total}){suffix}")
        return 0

    if args.command == "prepare":
        target = _select_target(targets, args.provider, args.selector, args.phase)
        pack = prepare(target, pdf_override=args.pdf)
        summary = pack["reviewSummary"]
        print(
            f"{target.identity}: {summary['markers']}/{summary['expected']} marcadores; "
            f"{summary['needsReview']} exceções semânticas."
        )
        print(f"Revisar em /data/native-review após abrir {target.output_dir / 'native-pack.json'}")
        return 0

    selected = [target for target in targets if target.status == "ready"]
    if args.provider:
        selected = [target for target in selected if target.provider_id == args.provider]
    if args.limit:
        selected = selected[: args.limit]
    failures = 0
    for target in selected:
        try:
            prepare(target)
            print(f"OK {target.identity}")
        except Exception as error:  # noqa: BLE001 - batch must continue and report every exception.
            failures += 1
            print(f"FAIL {target.identity}: {error}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
