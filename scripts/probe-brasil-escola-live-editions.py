#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import importlib.util
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "harvest-brasil-escola.py"
RANK_SCRIPT = SCRIPT_DIR / "rank-brasil-escola-national.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


base = load_module("probe_live_brasil_escola_base", BASE_SCRIPT)
ranker = load_module("probe_live_brasil_escola_ranker", RANK_SCRIPT)

RANGE_BYTES = 8191
SUPPORTED_SUFFIXES = {".zip": "zip", ".pdf": "pdf", ".rar": "rar", ".7z": "7z"}


def detect_probe_format(data: bytes, content_type: str = "", resolved_url: str = "") -> str | None:
    if data.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        return "zip"
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"Rar!\x1a\x07"):
        return "rar"
    if data.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7z"
    suffix = Path(resolved_url.split("?", 1)[0]).suffix.lower()
    if suffix in SUPPORTED_SUFFIXES:
        return SUPPORTED_SUFFIXES[suffix]
    normalized = content_type.lower()
    if "application/pdf" in normalized:
        return "pdf"
    if "zip" in normalized:
        return "zip"
    if "rar" in normalized:
        return "rar"
    if "7z" in normalized or "7-zip" in normalized:
        return "7z"
    return None


def role_hint(title: str) -> str:
    value = base.deaccent(title)
    has_exam = bool(re.search(r"\bprova(?:s)?\b|\bcaderno(?:s)?\b", value))
    has_key = "gabarito" in value or "respostas" in value
    if has_exam and has_key:
        return "combined"
    if has_exam:
        return "exam"
    if has_key:
        return "answer-key"
    return "unknown"


def select_candidates(ranking: dict, *, top: int, excluded: set[str]) -> list[dict]:
    selected = []
    for row in ranking.get("ranking", []):
        slug = str(row.get("institutionSlug") or "")
        if not slug or slug in excluded:
            continue
        selected.append(row)
        if len(selected) >= max(0, top):
            break
    return selected


def probe_entry(entry: dict, *, timeout: float) -> dict:
    url = str(entry.get("downloadUrl") or "")
    referer = str(entry.get("institutionPageUrl") or "")
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": base.USER_AGENT,
            "Accept": "application/pdf,application/zip,application/octet-stream;q=0.9,*/*;q=0.1",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
            "Referer": referer,
            "Range": f"bytes=0-{RANGE_BYTES}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            resolved_url = response.geturl()
            if not base.allowed_download_response_url(resolved_url):
                raise ValueError(f"redirect outside Brasil Escola allowlist: {resolved_url}")
            data = response.read(RANGE_BYTES + 1)
            headers = {key.lower(): value for key, value in response.headers.items()}
            detected = detect_probe_format(data, headers.get("content-type", ""), resolved_url)
            return {
                "availability": "available" if detected else "unsupported",
                "httpStatus": getattr(response, "status", None),
                "resolvedDownloadUrl": resolved_url,
                "contentType": headers.get("content-type"),
                "detectedFormat": detected,
                "sampleBytes": len(data),
            }
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            return {"availability": "unavailable", "httpStatus": int(error.code)}
        if error.code in (401, 403, 429):
            return {"availability": "blocked", "httpStatus": int(error.code), "error": str(error)}
        return {"availability": "error", "httpStatus": int(error.code), "error": str(error)}
    except Exception as error:
        return {"availability": "error", "exceptionType": type(error).__name__, "error": str(error)}


def institution_summary(candidate: dict, entries: list[dict], observations: list[dict]) -> dict:
    edition_roles: dict[str, set[str]] = {}
    live_editions: set[str] = set()
    formats: dict[str, int] = {}
    counts = {"available": 0, "unavailable": 0, "blocked": 0, "unsupported": 0, "error": 0}
    records = []
    for entry, observation in zip(entries, observations):
        state = str(observation.get("availability") or "error")
        counts[state] = counts.get(state, 0) + 1
        edition = ranker.edition_key(str(entry.get("title") or ""), entry.get("year"))
        role = role_hint(str(entry.get("title") or ""))
        if state == "available" and edition:
            live_editions.add(edition)
            edition_roles.setdefault(edition, set()).add(role)
            detected = observation.get("detectedFormat")
            if detected:
                formats[str(detected)] = formats.get(str(detected), 0) + 1
        records.append({
            "downloadId": entry.get("downloadId"),
            "title": entry.get("title"),
            "year": entry.get("year"),
            "editionKey": edition,
            "roleHint": role,
            **observation,
        })

    usable_editions = set()
    exam_bearing = set()
    key_bearing = set()
    for edition, roles in edition_roles.items():
        if "combined" in roles or "exam" in roles:
            exam_bearing.add(edition)
        if "combined" in roles or "answer-key" in roles:
            key_bearing.add(edition)
        if "combined" in roles or ({"exam", "answer-key"} <= roles):
            usable_editions.add(edition)

    return {
        "region": candidate.get("region"),
        "institution": candidate.get("institution"),
        "institutionSlug": candidate.get("institutionSlug"),
        "cataloguedEditionSignals": candidate.get("editionSignals", 0),
        "cataloguedEntries": len(entries),
        "liveEntries": counts.get("available", 0),
        "liveEditionSignals": len(live_editions),
        "usableEditionSignals": len(usable_editions),
        "examBearingEditionSignals": len(exam_bearing),
        "keyBearingEditionSignals": len(key_bearing),
        "unavailableEntries": counts.get("unavailable", 0),
        "blockedEntries": counts.get("blocked", 0),
        "unsupportedEntries": counts.get("unsupported", 0),
        "errorEntries": counts.get("error", 0),
        "formats": dict(sorted(formats.items())),
        "liveEditionKeys": sorted(live_editions),
        "usableEditionKeys": sorted(usable_editions),
        "records": records,
    }


def sort_live(rows: list[dict]) -> list[dict]:
    return sorted(
        rows,
        key=lambda row: (
            -int(row.get("usableEditionSignals") or 0),
            -int(row.get("liveEditionSignals") or 0),
            -int(row.get("examBearingEditionSignals") or 0),
            -int(row.get("cataloguedEditionSignals") or 0),
            str(row.get("institutionSlug") or ""),
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe live Brasil Escola packages for top-ranked vestibular institutions without downloading full files.")
    parser.add_argument("--ranking", required=True)
    parser.add_argument("--catalog-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--top-candidates", type=int, default=12)
    parser.add_argument("--exclude-slug", action="append", default=[])
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args()

    ranking = json.loads(Path(args.ranking).read_text(encoding="utf-8"))
    candidates = select_candidates(ranking, top=args.top_candidates, excluded=set(args.exclude_slug))
    catalogs = {}
    for path in Path(args.catalog_dir).glob("*.json"):
        catalogs[path.stem] = json.loads(path.read_text(encoding="utf-8"))

    candidate_entries: list[tuple[dict, list[dict]]] = []
    for candidate in candidates:
        region = str(candidate.get("region") or "")
        slug = str(candidate.get("institutionSlug") or "")
        catalog = catalogs.get(region) or {}
        institution = next((item for item in catalog.get("institutions", []) if item.get("slug") == slug), None)
        entries = list((institution or {}).get("entries", []))
        candidate_entries.append((candidate, entries))

    tasks = []
    for candidate_index, (_, entries) in enumerate(candidate_entries):
        for entry_index, entry in enumerate(entries):
            tasks.append((candidate_index, entry_index, entry))

    observations: list[list[dict | None]] = [[None] * len(entries) for _, entries in candidate_entries]
    workers = max(1, min(args.workers, 24))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {
            pool.submit(probe_entry, entry, timeout=args.timeout): (candidate_index, entry_index)
            for candidate_index, entry_index, entry in tasks
        }
        for future in concurrent.futures.as_completed(future_map):
            candidate_index, entry_index = future_map[future]
            try:
                observations[candidate_index][entry_index] = future.result()
            except Exception as error:
                observations[candidate_index][entry_index] = {
                    "availability": "error",
                    "exceptionType": type(error).__name__,
                    "error": str(error),
                }

    summaries = []
    for index, (candidate, entries) in enumerate(candidate_entries):
        observed = [item or {"availability": "error", "error": "missing observation"} for item in observations[index]]
        summaries.append(institution_summary(candidate, entries, observed))
    ranked_live = sort_live(summaries)

    totals = {
        "candidates": len(ranked_live),
        "selectedEntries": sum(row.get("cataloguedEntries", 0) for row in ranked_live),
        "liveEntries": sum(row.get("liveEntries", 0) for row in ranked_live),
        "unavailableEntries": sum(row.get("unavailableEntries", 0) for row in ranked_live),
        "blockedEntries": sum(row.get("blockedEntries", 0) for row in ranked_live),
        "unsupportedEntries": sum(row.get("unsupportedEntries", 0) for row in ranked_live),
        "errorEntries": sum(row.get("errorEntries", 0) for row in ranked_live),
    }
    payload = {
        "version": 1,
        "providerId": base.PROVIDER_ID,
        "purpose": "live-edition-priority-probe",
        "excludedSlugs": sorted(set(args.exclude_slug)),
        "totals": totals,
        "ranking": ranked_live,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"totals": totals, "ranking": [{key: row[key] for key in (
        "region", "institution", "institutionSlug", "cataloguedEditionSignals", "liveEditionSignals",
        "usableEditionSignals", "examBearingEditionSignals", "liveEntries", "unavailableEntries",
        "blockedEntries", "unsupportedEntries", "errorEntries", "formats"
    )} for row in ranked_live]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
