#!/usr/bin/env python3
"""Provider-aware preparation entrypoint for the autonomous NativePack fleet.

Keeps provider-specific layout/source knowledge outside the generic extraction
core. Identity, answer keys and publication gates remain authoritative and
fail closed. Archived source fallback is allowed only when the catalog pins the
exact official URL snapshot, SHA-256 and byte length.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import replace
from pathlib import Path

import native_fleet as fleet
import native_ingest as ingest
import native_orchestrator as core

# EEAR objective booklets print questions 01..09 with a mandatory leading zero,
# then 10..99 and 100 normally. Internal numbered lists often use `1 –`, `2 –`,
# etc.; requiring the leading zero for single-digit questions prevents those
# list items from being mistaken for question markers. Opening answer-key pages
# also lack this dash-based question format.
EEAR_MARKER_PATTERN = r"(?m)^\s*(0[1-9]|[1-9]\d|100)\s*[–—-]\s+"

PROVIDER_MARKER_PATTERNS: dict[str, str] = {
    "eear": EEAR_MARKER_PATTERN,
}

# These providers have an audited reason to use archived copies of their exact
# official PDF URLs when the live host is unavailable to GitHub Actions. Adding
# a provider here never bypasses integrity checks: metadata must still prove the
# exact URL + digest + byte length for each edition.
PINNED_ARCHIVE_PROVIDERS = {"ime", "afa", "epcar"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def apply_layout_profile(target: core.NativeTarget) -> core.NativeTarget:
    marker_pattern = PROVIDER_MARKER_PATTERNS.get(target.provider_id)
    if not marker_pattern:
        return target
    return replace(target, marker_pattern=marker_pattern)


def _catalog_record(target: core.NativeTarget) -> dict[str, object] | None:
    if target.provider_id not in PINNED_ARCHIVE_PROVIDERS:
        return None
    path = core.PROVIDERS / target.provider_id / "answer-keys.generated.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    key = target.edition_id if target.edition_id else str(target.year)
    record = raw.get(key)
    return record if isinstance(record, dict) else None


def _pinned_archive_metadata(target: core.NativeTarget) -> tuple[str, str, int] | None:
    record = _catalog_record(target)
    if not record:
        return None

    archive = record.get("examArchiveUrl")
    digest = record.get("examSha256")
    byte_length = record.get("examBytes")
    present = [archive is not None, digest is not None, byte_length is not None]
    if any(present) and not all(present):
        raise fleet.NativeFleetError(f"{target.identity}: metadados de fonte pinada incompletos")
    if not all(present):
        return None

    if not target.exam_url:
        raise fleet.NativeFleetError(f"{target.identity}: fonte pinada sem URL oficial")
    archive = str(archive)
    digest = str(digest).lower()
    try:
        byte_length = int(byte_length)
    except (TypeError, ValueError) as error:
        raise fleet.NativeFleetError(f"{target.identity}: examBytes inválido") from error

    expected_archive = re.compile(
        r"^https://web\.archive\.org/web/\d{14}id_/" + re.escape(target.exam_url) + r"$"
    )
    if not expected_archive.fullmatch(archive):
        raise fleet.NativeFleetError(
            f"{target.identity}: snapshot não corresponde exatamente à URL oficial"
        )
    if not SHA256_RE.fullmatch(digest):
        raise fleet.NativeFleetError(f"{target.identity}: examSha256 inválido")
    if byte_length < 1:
        raise fleet.NativeFleetError(f"{target.identity}: examBytes inválido")
    return archive, digest, byte_length


def _verified_pdf_override(target: core.NativeTarget) -> Path | None:
    pinned = _pinned_archive_metadata(target)
    if not pinned:
        return None
    archive_url, expected_sha, expected_bytes = pinned

    destination = target.output_dir / "source-pinned.pdf"
    temporary = target.output_dir / "source-pinned.tmp"
    target.output_dir.mkdir(parents=True, exist_ok=True)
    temporary.unlink(missing_ok=True)

    try:
        # Normal TLS verification remains enabled here. The archive is not
        # trusted by name alone; it becomes usable only after both pinned
        # integrity checks below pass.
        core._download_pdf(archive_url, temporary)
        actual_sha = core._sha256(temporary)
        actual_bytes = temporary.stat().st_size
        if actual_sha != expected_sha:
            raise fleet.NativeFleetError(
                f"{target.identity}: SHA do snapshot diverge do audit ({actual_sha})"
            )
        if actual_bytes != expected_bytes:
            raise fleet.NativeFleetError(
                f"{target.identity}: tamanho do snapshot diverge do audit "
                f"({actual_bytes}/{expected_bytes})"
            )
        temporary.replace(destination)
        return destination
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def prepare(provider: str, selector: str, phase: str, out: Path) -> dict[str, object]:
    targets = ingest.discover_targets()
    target = core._select_target(targets, provider, selector, phase)
    if target.status != "ready":
        raise fleet.NativeFleetError(f"{target.identity} bloqueado: {target.reason}")

    profiled = apply_layout_profile(target)
    pdf_override = _verified_pdf_override(profiled)
    pack = ingest._prepare(profiled, pdf_override=pdf_override)
    bundle = fleet._render_bundle(profiled, pack, out)
    return {
        "identity": profiled.identity,
        "assets": bundle["assetCount"],
        "revision": fleet.REVISION,
        "markerProfile": profiled.provider_id if profiled.marker_pattern else "default",
        "sourceProfile": "pinned-archive" if pdf_override else "default",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare one fleet target with provider layout/source profiles")
    parser.add_argument("provider")
    parser.add_argument("selector")
    parser.add_argument("--phase", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.provider, args.selector, args.phase, args.out), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
