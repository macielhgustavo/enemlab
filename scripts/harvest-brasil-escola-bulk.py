#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import importlib.util
import json
import sys
from pathlib import Path

BASE_SCRIPT = Path(__file__).resolve().with_name("harvest-brasil-escola.py")
MIRROR_SCRIPT = Path(__file__).resolve().with_name("harvest-uece-brasil-escola.py")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


base = load_module("harvest_brasil_escola_bulk_base", BASE_SCRIPT)
mirror = load_module("harvest_brasil_escola_bulk_mirror", MIRROR_SCRIPT)

REGIONS = {
    "centro-oeste": f"{base.BASE_URL}/downloads/centrooeste.htm",
    "nordeste": f"{base.BASE_URL}/downloads/nordeste.htm",
    "norte": f"{base.BASE_URL}/downloads/norte.htm",
    "sudeste": f"{base.BASE_URL}/downloads/sudeste.htm",
    "sul": f"{base.BASE_URL}/downloads/sul.htm",
}
DEFAULT_INSTITUTIONS = ("UPE", "URCA", "UEMA", "UFPE")


def matches(entry, filters: list[str]) -> bool:
    if not filters:
        return True
    haystack = base.deaccent(f"{entry.institution} {entry.institution_slug}")
    return any(base.deaccent(value) in haystack for value in filters)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bulk-acquire vestibular mirrors from Brasil Escola across Brazilian regions."
    )
    parser.add_argument("--region", choices=sorted(REGIONS), default="nordeste")
    parser.add_argument("--institution", action="append", default=[], help="institution name/slug filter; repeatable")
    parser.add_argument("--limit-per-institution", type=int, default=None)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--catalog", default=None)
    parser.add_argument("--download-root", default=None)
    args = parser.parse_args()

    base.REGIONS.update(REGIONS)
    filters = args.institution or (list(DEFAULT_INSTITUTIONS) if args.region == "nordeste" else [])
    workers = max(1, min(args.workers, 8))
    catalog_path = Path(args.catalog or f".ingestion-cache/brasil-escola/{args.region}/bulk-catalog.json")
    root = Path(args.download_root or f".ingestion-inbox/brasil-escola/{args.region}")
    try:
        catalog = base.catalog_region(args.region, workers=workers, timeout=args.timeout)
    except Exception as error:
        print(f"catalog failed: {error}", file=sys.stderr)
        return 2

    grouped = {}
    for entry in base.iter_entries(catalog):
        if matches(entry, filters):
            grouped.setdefault(entry.institution_slug, []).append(entry)

    selected = []
    for slug, entries in grouped.items():
        entries.sort(key=lambda item: (-(item.year or 0), -item.download_id))
        if args.limit_per_institution is not None:
            entries = entries[: max(0, args.limit_per_institution)]
        selected.extend(entries)
    selected.sort(key=lambda item: (item.institution_slug, -(item.year or 0), -item.download_id))

    results = {}
    unavailable_entries: list[dict] = []
    errors: list[dict] = []
    formats: dict[str, int] = {}

    def one(entry):
        return mirror.download_entry(entry, root=root, timeout=args.timeout, refresh=args.refresh)

    def record_error(entry, error: Exception) -> None:
        status = mirror.unavailable(error)
        payload = {
            "institution": entry.institution,
            "institutionSlug": entry.institution_slug,
            "downloadId": entry.download_id,
            "title": entry.title,
        }
        if status is not None:
            unavailable_entries.append({**payload, "httpStatus": status})
        else:
            errors.append({**payload, "error": str(error)})

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
    selected_ids = {entry.download_id for entry in selected}
    for institution in catalog["institutions"]:
        for payload in institution["entries"]:
            download_id = int(payload["downloadId"])
            if download_id not in selected_ids:
                continue
            if download_id in results:
                payload.update(base.entry_to_json(results[download_id]))
                payload["availability"] = "available"
                payload["detectedFormat"] = Path(payload["localPath"]).suffix.lower().removeprefix(".")
            elif download_id in unavailable_by_id:
                payload["availability"] = "unavailable"
                payload["httpStatus"] = unavailable_by_id[download_id]["httpStatus"]
            else:
                payload["availability"] = "error"

    per_institution = []
    for slug, entries in sorted(grouped.items()):
        selected_here = [entry for entry in selected if entry.institution_slug == slug]
        selected_here_ids = {entry.download_id for entry in selected_here}
        acquired_here = [item for key, item in results.items() if key in selected_here_ids]
        unavailable_here = [item for item in unavailable_entries if item["downloadId"] in selected_here_ids]
        errors_here = [item for item in errors if item["downloadId"] in selected_here_ids]
        format_counts: dict[str, int] = {}
        for item in acquired_here:
            extension = Path(item.local_path or "").suffix.lower().removeprefix(".") or "unknown"
            format_counts[extension] = format_counts.get(extension, 0) + 1
        per_institution.append({
            "institution": entries[0].institution if entries else slug,
            "institutionSlug": slug,
            "catalogued": len(entries),
            "selected": len(selected_here),
            "acquired": len(acquired_here),
            "unavailable": len(unavailable_here),
            "errors": len(errors_here),
            "bytes": sum(item.bytes or 0 for item in acquired_here),
            "formats": dict(sorted(format_counts.items())),
        })

    acquisition = {
        "region": args.region,
        "filters": filters,
        "selected": len(selected),
        "acquired": len(results),
        "downloaded": sum(1 for item in results.values() if item.acquisition == "network"),
        "cacheHits": sum(1 for item in results.values() if item.acquisition == "cache"),
        "unavailable": len(unavailable_entries),
        "bytes": sum(item.bytes or 0 for item in results.values()),
        "formats": {key.removeprefix("."): value for key, value in sorted(formats.items())},
        "institutions": per_institution,
        "unavailableEntries": sorted(unavailable_entries, key=lambda item: (item["institutionSlug"], -item["downloadId"])),
        "errors": sorted(errors, key=lambda item: (item["institutionSlug"], -item["downloadId"])),
    }
    catalog["bulkAcquisition"] = acquisition
    base.write_catalog(catalog, catalog_path)
    print(json.dumps({
        "providerId": base.PROVIDER_ID,
        **acquisition,
    }, ensure_ascii=False, indent=2))

    if args.strict and errors:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
