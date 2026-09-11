#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import importlib.util
import io
import json
import re
import sys
import urllib.error
import zipfile
from pathlib import Path

BASE_SCRIPT = Path(__file__).resolve().with_name("harvest-brasil-escola.py")
spec = importlib.util.spec_from_file_location("harvest_brasil_escola_base", BASE_SCRIPT)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

UECE_SLUG = "universidade-estadual-ceara"
SUPPORTED_EXTENSIONS = (".zip", ".pdf", ".rar", ".7z")


def detect_extension(data: bytes, content_type: str = "", resolved_url: str = "") -> str | None:
    if zipfile.is_zipfile(io.BytesIO(data)):
        return ".zip"
    if data.startswith(b"%PDF-"):
        return ".pdf"
    if data.startswith(b"Rar!\x1a\x07"):
        return ".rar"
    if data.startswith(b"7z\xbc\xaf\x27\x1c"):
        return ".7z"
    normalized = content_type.lower()
    suffix = Path(resolved_url.split("?", 1)[0]).suffix.lower()
    if "pdf" in normalized and suffix == ".pdf":
        return ".pdf"
    if "rar" in normalized and suffix == ".rar":
        return ".rar"
    return None


def target_stem(entry) -> str:
    return f"{entry.download_id}-{base.slugify(entry.title)[:100]}"


def cached_target(directory: Path, stem: str) -> Path | None:
    for extension in SUPPORTED_EXTENSIONS:
        candidate = directory / f"{stem}{extension}"
        if candidate.exists():
            return candidate
    return None


def download_entry(entry, *, root: Path, timeout: float, refresh: bool):
    year_part = str(entry.year) if entry.year is not None else "unknown-year"
    directory = root / entry.institution_slug / year_part
    directory.mkdir(parents=True, exist_ok=True)
    stem = target_stem(entry)

    existing = cached_target(directory, stem)
    if existing is not None and not refresh:
        data = existing.read_bytes()
        entry.local_path = str(existing)
        entry.sha256 = base.sha256_bytes(data)
        entry.bytes = len(data)
        entry.acquisition = "cache"
        return entry, existing.suffix.lower()

    data, headers, resolved_url = base.fetch_bytes(
        entry.download_url,
        max_bytes=base.MAX_ARCHIVE_BYTES,
        timeout=timeout,
        extra_headers={"Referer": entry.institution_page_url},
    )
    extension = detect_extension(data, headers.get("content-type", ""), resolved_url)
    if extension is None:
        raise ValueError(
            f"unsupported download format for {entry.download_id} "
            f"(content-type={headers.get('content-type', 'unknown')})"
        )

    target = directory / f"{stem}{extension}"
    target.write_bytes(data)
    entry.local_path = str(target)
    entry.sha256 = base.sha256_bytes(data)
    entry.bytes = len(data)
    entry.acquisition = "network"
    metadata = {
        "schema": "enemlab-third-party-acquisition/v1",
        "providerId": base.PROVIDER_ID,
        "rightsStatus": "third-party-mirror-reference",
        **base.entry_to_json(entry),
        "resolvedDownloadUrl": resolved_url,
        "contentType": headers.get("content-type"),
        "detectedFormat": extension.removeprefix("."),
        "etag": headers.get("etag"),
        "lastModified": headers.get("last-modified"),
    }
    target.with_suffix(target.suffix + ".meta.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return entry, extension


def unavailable(error: Exception) -> int | None:
    if isinstance(error, urllib.error.HTTPError) and error.code in (404, 410):
        return int(error.code)
    match = re.search(r"HTTP Error\s+(404|410)\b", str(error), re.I)
    return int(match.group(1)) if match else None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Acquire UECE mirror files from Brasil Escola without assuming ZIP-only packaging."
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--catalog", default=".ingestion-cache/brasil-escola/nordeste/uece-catalog.json")
    parser.add_argument("--download-root", default=".ingestion-inbox/brasil-escola/nordeste")
    args = parser.parse_args()

    try:
        catalog = base.catalog_region("nordeste", workers=max(1, min(args.workers, 8)), timeout=args.timeout)
    except Exception as error:
        print(f"catalog failed: {error}", file=sys.stderr)
        return 2

    selected = [entry for entry in base.iter_entries(catalog) if entry.institution_slug == UECE_SLUG]
    selected.sort(key=lambda item: (-(item.year or 0), -item.download_id))
    if args.limit is not None:
        selected = selected[: max(0, args.limit)]

    root = Path(args.download_root)
    results = {}
    unavailable_entries: list[dict] = []
    errors: list[dict] = []
    formats: dict[str, int] = {}

    def one(entry):
        return download_entry(entry, root=root, timeout=args.timeout, refresh=args.refresh)

    def record_error(entry, error: Exception) -> None:
        status = unavailable(error)
        payload = {"downloadId": entry.download_id, "title": entry.title}
        if status is not None:
            unavailable_entries.append({**payload, "httpStatus": status})
        else:
            errors.append({**payload, "error": str(error)})

    workers = max(1, min(args.workers, 8))
    if workers == 1:
        for entry in selected:
            try:
                downloaded, extension = one(entry)
                results[downloaded.download_id] = downloaded
                formats[extension] = formats.get(extension, 0) + 1
            except Exception as error:
                record_error(entry, error)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            future_map = {pool.submit(one, entry): entry for entry in selected}
            for future in concurrent.futures.as_completed(future_map):
                entry = future_map[future]
                try:
                    downloaded, extension = future.result()
                    results[downloaded.download_id] = downloaded
                    formats[extension] = formats.get(extension, 0) + 1
                except Exception as error:
                    record_error(entry, error)

    unavailable_by_id = {item["downloadId"]: item for item in unavailable_entries}
    for institution in catalog["institutions"]:
        for payload in institution["entries"]:
            download_id = int(payload["downloadId"])
            if download_id in results:
                payload.update(base.entry_to_json(results[download_id]))
                payload["availability"] = "available"
            elif download_id in unavailable_by_id:
                payload["availability"] = "unavailable"
                payload["httpStatus"] = unavailable_by_id[download_id]["httpStatus"]

    catalog["acquisition"] = {
        "selected": len(selected),
        "acquired": len(results),
        "downloaded": sum(1 for item in results.values() if item.acquisition == "network"),
        "cacheHits": sum(1 for item in results.values() if item.acquisition == "cache"),
        "unavailable": len(unavailable_entries),
        "bytes": sum(item.bytes or 0 for item in results.values()),
        "formats": {key.removeprefix("."): value for key, value in sorted(formats.items())},
        "unavailableEntries": sorted(unavailable_entries, key=lambda item: item["downloadId"], reverse=True),
        "errors": sorted(errors, key=lambda item: item["downloadId"], reverse=True),
    }
    base.write_catalog(catalog, Path(args.catalog))
    print(json.dumps({
        "providerId": base.PROVIDER_ID,
        "institution": "UECE",
        "cataloguedEntries": len([entry for entry in base.iter_entries(catalog) if entry.institution_slug == UECE_SLUG]),
        **catalog["acquisition"],
    }, ensure_ascii=False, indent=2))
    return 1 if args.strict and errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
