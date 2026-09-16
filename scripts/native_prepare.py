#!/usr/bin/env python3
"""Provider-aware preparation entrypoint for the autonomous NativePack fleet.

Keeps provider-specific layout/source knowledge outside the generic extraction
core. Profiles may only change visual marker hints or transport mechanics;
identity, source contents, answer keys and publication gates remain authoritative
and fail closed elsewhere.
"""

from __future__ import annotations

import argparse
import json
import ssl
import subprocess
import urllib.error
from dataclasses import replace
from pathlib import Path

import native_fleet as fleet
import native_ingest as ingest
import native_orchestrator as core

# Modern EEAR objective booklets print questions 01..09 with a mandatory leading
# zero, then 10..99 and 100 normally. Internal numbered lists often use `1 –`,
# `2 –`, etc.; requiring the leading zero for single-digit questions prevents
# those list items from being mistaken for question markers.
EEAR_MARKER_PATTERN = r"(?m)^\s*(0[1-9]|[1-9]\d|100)\s*[–—-]\s+"

# The 2017 EAGS PDFs expose some printed numbers in the text layer with spaces
# between digits (`0 1 -`, `2 0 -`, `1 0 0 -`). This profile is deliberately
# year-scoped so newer EEAR layouts keep the stricter contiguous marker rule.
EEAR_2017_MARKER_PATTERN = r"(?m)^\s*(0\s*[1-9]|[1-9]\s*\d|1\s*0\s*0)\s*[–—-]\s+"

PROVIDER_MARKER_PATTERNS: dict[str, str] = {
    "eear": EEAR_MARKER_PATTERN,
}


def apply_layout_profile(target: core.NativeTarget) -> core.NativeTarget:
    if target.provider_id == "eear" and target.year == 2017:
        return replace(target, marker_pattern=EEAR_2017_MARKER_PATTERN)
    marker_pattern = PROVIDER_MARKER_PATTERNS.get(target.provider_id)
    if not marker_pattern:
        return target
    return replace(target, marker_pattern=marker_pattern)


def _download_espcex_with_verified_fallback(target: core.NativeTarget) -> Path:
    if not target.exam_url:
        raise fleet.NativeFleetError("EsPCEx sem URL do caderno objetivo")
    destination = target.output_dir / "source.pdf"
    try:
        return core._download_pdf(target.exam_url, destination)
    except urllib.error.URLError as error:
        if not isinstance(error.reason, ssl.SSLCertVerificationError):
            raise

    # Some EsPCEx mirrors have a certificate chain that Python/OpenSSL on the
    # hosted runner cannot build although the system TLS stack can. Curl is a
    # second *verified* client here: no -k/--insecure and no custom trust bypass.
    temporary = destination.with_suffix(destination.suffix + ".curl")
    temporary.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            [
                "curl",
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--max-time",
                "90",
                "--user-agent",
                core.HTTP_HEADERS["User-Agent"],
                "--output",
                str(temporary),
                target.exam_url,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=100,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "curl falhou").strip()
            raise fleet.NativeFleetError(
                f"EsPCEx: fallback TLS verificado falhou ({result.returncode}): {detail[:500]}"
            )
        data = temporary.read_bytes()
        if not data.lstrip().startswith(b"%PDF"):
            raise fleet.NativeFleetError("EsPCEx: fallback TLS não retornou um PDF")
        destination.write_bytes(data)
        return destination
    finally:
        temporary.unlink(missing_ok=True)


def prepare(provider: str, selector: str, phase: str, out: Path) -> dict[str, object]:
    targets = ingest.discover_targets()
    target = core._select_target(targets, provider, selector, phase)
    if target.status != "ready":
        raise fleet.NativeFleetError(f"{target.identity} bloqueado: {target.reason}")

    profiled = apply_layout_profile(target)
    pdf_override = None
    if profiled.provider_id == "espcex":
        pdf_override = _download_espcex_with_verified_fallback(profiled)
    pack = ingest._prepare(profiled, pdf_override=pdf_override)
    bundle = fleet._render_bundle(profiled, pack, out)
    return {
        "identity": profiled.identity,
        "assets": bundle["assetCount"],
        "revision": fleet.REVISION,
        "markerProfile": (
            "eear-2017" if profiled.provider_id == "eear" and profiled.year == 2017
            else profiled.provider_id if profiled.marker_pattern
            else "default"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare one fleet target with provider layout profiles")
    parser.add_argument("provider")
    parser.add_argument("selector")
    parser.add_argument("--phase", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.provider, args.selector, args.phase, args.out), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
