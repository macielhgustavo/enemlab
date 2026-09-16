#!/usr/bin/env python3
"""Provider-aware preparation entrypoint for the autonomous NativePack fleet.

Keeps provider-specific layout knowledge outside the generic extraction core.
A profile may only change visual marker/layout hints; identity, source, answer
keys and publication gates remain authoritative and fail closed elsewhere.
"""

from __future__ import annotations

import argparse
import json
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


def apply_layout_profile(target: core.NativeTarget) -> core.NativeTarget:
    marker_pattern = PROVIDER_MARKER_PATTERNS.get(target.provider_id)
    if not marker_pattern:
        return target
    return replace(target, marker_pattern=marker_pattern)


def prepare(provider: str, selector: str, phase: str, out: Path) -> dict[str, object]:
    targets = ingest.discover_targets()
    target = core._select_target(targets, provider, selector, phase)
    if target.status != "ready":
        raise fleet.NativeFleetError(f"{target.identity} bloqueado: {target.reason}")

    profiled = apply_layout_profile(target)
    pack = ingest._prepare(profiled)
    bundle = fleet._render_bundle(profiled, pack, out)
    return {
        "identity": profiled.identity,
        "assets": bundle["assetCount"],
        "revision": fleet.REVISION,
        "markerProfile": profiled.provider_id if profiled.marker_pattern else "default",
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
