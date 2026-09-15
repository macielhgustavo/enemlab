#!/usr/bin/env python3
"""Autonomous NativePack fleet runner.

Plans ready targets, prepares one target with the audited native engine, renders
content-addressed pages/crops, and publishes through the OIDC-protected Supabase
broker. No Supabase service key is ever present in GitHub Actions.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

import native_ingest as ingest
import native_orchestrator as core

REVISION = "native-fleet@1"
OIDC_AUDIENCE = "studium-native-publisher-v1"
DEFAULT_PUBLISHER_URL = (
    "https://srpohfgqqrzpilalemar.supabase.co/functions/v1/native-fleet-publisher"
)
ALLOWED_EXTRACTION_ISSUE_PREFIXES = (
    "alternativas semânticas não foram reconhecidas integralmente;",
)


class NativeFleetError(RuntimeError):
    pass


def _base36(value: int) -> str:
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    out = ""
    while value:
        value, rem = divmod(value, 36)
        out = alphabet[rem] + out
    return out


def _js_round_positive(value: float) -> int:
    return math.floor(value + 0.5)


def _rect_fingerprint(rect: dict[str, Any]) -> str:
    values = [rect["x"], rect["y"], rect["width"], rect["height"]]
    return "-".join(
        _base36(_js_round_positive(float(value) * 1_000_000)) for value in values
    )


def _page_path(root: str, page: int) -> str:
    return f"{root}/pages/page-{page:03d}.webp"


def _region_path(root: str, page: int, rect: dict[str, Any]) -> str:
    return f"{root}/regions/page-{page:03d}-{_rect_fingerprint(rect)}.webp"


def _valid_rect(rect: dict[str, Any]) -> bool:
    try:
        x = float(rect["x"])
        y = float(rect["y"])
        width = float(rect["width"])
        height = float(rect["height"])
    except (KeyError, TypeError, ValueError):
        return False
    return (
        0 <= x <= 1
        and 0 <= y <= 1
        and 0 < width <= 1
        and 0 < height <= 1
        and x + width <= 1.000001
        and y + height <= 1.000001
    )


def _allowed_extraction_issues(issues: Iterable[Any]) -> bool:
    return all(
        any(str(issue).startswith(prefix) for prefix in ALLOWED_EXTRACTION_ISSUE_PREFIXES)
        for issue in issues
    )


def _automation_gate(target: core.NativeTarget, pack: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    documents = pack.get("documents") or []
    questions = pack.get("questions") or []
    if len(documents) != 1:
        return ["fleet exige exatamente um documento por pack"]
    document = documents[0]
    if len(questions) != target.total:
        problems.append(f"quantidade de questões divergente: {len(questions)}/{target.total}")

    expected_keys = [ingest.question_key_for(target, number) for number in range(1, target.total + 1)]
    actual_keys = [str(question.get("questionKey") or "") for question in questions]
    if actual_keys != expected_keys:
        problems.append("questionKey/ordem diverge do provider auditado")

    numbers = [question.get("number") for question in questions]
    if numbers != list(range(1, target.total + 1)):
        problems.append("numeração não é contínua e única")

    page_count = int(document.get("pageCount") or 0)
    for question in questions:
        number = question.get("number")
        extraction = question.get("extraction") or {}
        completeness = extraction.get("visualCompleteness") or {}
        if not extraction.get("markerDetected"):
            problems.append(f"Q{number}: marcador não confirmado")
        if not completeness.get("resolved"):
            problems.append(f"Q{number}: completude visual não resolvida")
        if not _allowed_extraction_issues(extraction.get("issues") or []):
            problems.append(f"Q{number}: exceção de extração não autorizada para automação")
        regions = question.get("visualRegions") or []
        if not regions:
            problems.append(f"Q{number}: sem região visual")
        for region in regions:
            page = int(region.get("page") or 0)
            if page < 1 or page > page_count or not _valid_rect(region.get("rect") or {}):
                problems.append(f"Q{number}: região visual inválida")
                break
    return problems


def _content_root(document: dict[str, Any]) -> str:
    edition = document.get("editionId") or document["year"]
    return (
        f"native/{document['providerId']}/{edition}/{document['phase']}/"
        f"{str(document['sourceSha256'])[:16]}"
    )


def _render_bundle(target: core.NativeTarget, pack: dict[str, Any], bundle_dir: Path) -> dict[str, Any]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise NativeFleetError("Pillow ausente; instale pymupdf pillow") from exc

    problems = _automation_gate(target, pack)
    if problems:
        raise NativeFleetError("; ".join(problems[:12]))

    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
    bundle_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = bundle_dir / "assets"
    source_dir = target.output_dir / "pages"
    document = pack["documents"][0]
    root = _content_root(document)
    document["pageAssetPattern"] = f"{root}/pages/page-{{page:03d}}.webp"

    assets: dict[str, dict[str, Any]] = {}
    page_images: dict[int, Any] = {}
    try:
        for page in range(1, int(document["pageCount"]) + 1):
            source = source_dir / f"page-{page:03d}.webp"
            if not source.exists():
                raise NativeFleetError(f"página renderizada ausente: {source.name}")
            storage_path = _page_path(root, page)
            destination = assets_dir / storage_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            assets[storage_path] = {
                "path": storage_path,
                "localPath": str(destination.relative_to(bundle_dir)),
                "bytes": destination.stat().st_size,
            }

        for question in pack["questions"]:
            question["status"] = "approved"
            for region in question["visualRegions"]:
                page = int(region["page"])
                rect = region["rect"]
                storage_path = _region_path(root, page, rect)
                region["assetPath"] = storage_path
                if storage_path in assets:
                    continue
                image = page_images.get(page)
                if image is None:
                    image = Image.open(source_dir / f"page-{page:03d}.webp").convert("RGB")
                    page_images[page] = image
                x0 = max(0, round(float(rect["x"]) * image.width))
                y0 = max(0, round(float(rect["y"]) * image.height))
                x1 = min(image.width, round((float(rect["x"]) + float(rect["width"])) * image.width))
                y1 = min(image.height, round((float(rect["y"]) + float(rect["height"])) * image.height))
                if x1 <= x0 or y1 <= y0:
                    raise NativeFleetError(f"Q{question['number']}: crop degenerado")
                destination = assets_dir / storage_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                image.crop((x0, y0, x1, y1)).save(
                    destination,
                    format="WEBP",
                    quality=84,
                    method=4,
                )
                assets[storage_path] = {
                    "path": storage_path,
                    "localPath": str(destination.relative_to(bundle_dir)),
                    "bytes": destination.stat().st_size,
                }
    finally:
        for image in page_images.values():
            image.close()

    pack_path = bundle_dir / "native-pack.json"
    pack_path.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    bundle = {
        "schemaVersion": 1,
        "revision": REVISION,
        "identity": target.identity,
        "packFile": "native-pack.json",
        "assetCount": len(assets),
        "assets": list(assets.values()),
    }
    (bundle_dir / "bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return bundle


def _github_oidc_token() -> str:
    request_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
    request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not request_url or not request_token:
        raise NativeFleetError("GitHub OIDC indisponível; job precisa de id-token: write")
    separator = "&" if "?" in request_url else "?"
    url = f"{request_url}{separator}audience={urllib.parse.quote(OIDC_AUDIENCE)}"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {request_token}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    token = payload.get("value")
    if not token:
        raise NativeFleetError("GitHub não retornou token OIDC")
    return str(token)


def _broker(payload: dict[str, Any], publisher_url: str) -> dict[str, Any]:
    token = _github_oidc_token()
    request = urllib.request.Request(
        publisher_url,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise NativeFleetError(f"publisher HTTP {error.code}: {body[:1000]}") from error


def _upload_signed(url: str, path: Path) -> None:
    data = path.read_bytes()
    last_error: Exception | None = None
    for attempt in range(3):
        request = urllib.request.Request(
            url,
            data=data,
            method="PUT",
            headers={
                "Content-Type": "image/webp",
                "Cache-Control": "max-age=31536000",
                "x-upsert": "true",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                if 200 <= response.status < 300:
                    return
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in {408, 409, 425, 429, 500, 502, 503, 504}:
                raise
        except OSError as error:
            last_error = error
        time.sleep(2**attempt)
    raise NativeFleetError(f"upload falhou após retries: {path.name}: {last_error}")


def _publish_bundle(bundle_dir: Path, publisher_url: str) -> dict[str, Any]:
    bundle = json.loads((bundle_dir / "bundle.json").read_text(encoding="utf-8"))
    pack = json.loads((bundle_dir / bundle["packFile"]).read_text(encoding="utf-8"))
    asset_records = bundle["assets"]
    begin = _broker(
        {
            "action": "begin",
            "revision": bundle["revision"],
            "pack": pack,
            "assets": [{"path": record["path"], "bytes": record["bytes"]} for record in asset_records],
        },
        publisher_url,
    )
    if begin.get("skip"):
        return {"status": "skipped", "reason": begin.get("reason")}

    signed_by_path = {row["path"]: row["signedUrl"] for row in begin.get("uploads") or []}
    if set(signed_by_path) != {record["path"] for record in asset_records}:
        raise NativeFleetError("publisher não assinou exatamente o conjunto esperado de assets")
    for index, record in enumerate(asset_records, start=1):
        local_path = bundle_dir / record["localPath"]
        _upload_signed(signed_by_path[record["path"]], local_path)
        if index % 25 == 0:
            print(f"uploaded {index}/{len(asset_records)}", file=sys.stderr)

    finalized = _broker(
        {
            "action": "finalize",
            "revision": bundle["revision"],
            "pack": pack,
            "assets": [{"path": record["path"], "bytes": record["bytes"]} for record in asset_records],
        },
        publisher_url,
    )
    if not finalized.get("published"):
        raise NativeFleetError(f"publisher não confirmou finalização: {finalized}")
    return finalized


def _plan(provider: str | None, limit: int) -> dict[str, Any]:
    targets = [target for target in ingest.discover_targets() if target.status == "ready"]
    if provider:
        targets = [target for target in targets if target.provider_id == provider]
    if limit:
        targets = targets[:limit]
    return {
        "include": [
            {
                "provider": target.provider_id,
                "selector": target.edition_id or str(target.year),
                "phase": target.phase,
                "identity": target.identity,
                "questions": target.total,
            }
            for target in targets
        ]
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NativePack fleet automation")
    sub = parser.add_subparsers(dest="command", required=True)

    plan = sub.add_parser("plan")
    plan.add_argument("--provider")
    plan.add_argument("--limit", type=int, default=0)

    prepare = sub.add_parser("prepare")
    prepare.add_argument("provider")
    prepare.add_argument("selector")
    prepare.add_argument("--phase", required=True)
    prepare.add_argument("--out", type=Path, required=True)

    publish = sub.add_parser("publish")
    publish.add_argument("--bundle", type=Path, required=True)
    publish.add_argument("--publisher-url", default=os.environ.get("NATIVE_PUBLISHER_URL", DEFAULT_PUBLISHER_URL))

    args = parser.parse_args(argv)
    if args.command == "plan":
        print(json.dumps(_plan(args.provider, args.limit), separators=(",", ":")))
        return 0
    if args.command == "prepare":
        targets = ingest.discover_targets()
        target = core._select_target(targets, args.provider, args.selector, args.phase)
        if target.status != "ready":
            raise NativeFleetError(f"{target.identity} bloqueado: {target.reason}")
        pack = ingest._prepare(target)
        bundle = _render_bundle(target, pack, args.out)
        print(json.dumps({"identity": target.identity, "assets": bundle["assetCount"], "revision": REVISION}))
        return 0
    result = _publish_bundle(args.bundle, args.publisher_url)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (NativeFleetError, core.NativeOrchestratorError) as error:
        print(f"native-fleet: {error}", file=sys.stderr)
        raise SystemExit(1)
