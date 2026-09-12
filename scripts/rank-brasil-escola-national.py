#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "harvest-brasil-escola.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


base = load_module("rank_brasil_escola_base", BASE_SCRIPT)

REGIONS = {
    "centro-oeste": f"{base.BASE_URL}/downloads/centrooeste.htm",
    "nordeste": f"{base.BASE_URL}/downloads/nordeste.htm",
    "norte": f"{base.BASE_URL}/downloads/norte.htm",
    "sudeste": f"{base.BASE_URL}/downloads/sudeste.htm",
    "sul": f"{base.BASE_URL}/downloads/sul.htm",
}
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
TERM_AFTER_YEAR_RE = re.compile(
    r"(?<!\d)((?:19|20)\d{2})\s*(?:[/.-]\s*([12]))(?!\d)", re.I
)
TERM_WORD_RE = re.compile(
    r"\b([12])\s*(?:[º°oªa]\s*)?(?:sem(?:estre)?|fase|etapa)\b", re.I
)


def edition_key(title: str, fallback_year: int | None = None) -> str | None:
    normalized = base.deaccent(title)
    direct = TERM_AFTER_YEAR_RE.search(normalized)
    if direct:
        return f"{direct.group(1)}-{direct.group(2)}"
    year_match = YEAR_RE.search(normalized)
    year = int(year_match.group(1)) if year_match else fallback_year
    if year is None:
        return None
    tail = normalized[year_match.end():] if year_match else normalized
    term = TERM_WORD_RE.search(tail)
    if term:
        return f"{year}-{term.group(1)}"
    return str(year)


def summarize_institution(region: str, institution: dict) -> dict:
    entries = institution.get("entries", [])
    edition_keys = sorted({
        key for entry in entries
        if (key := edition_key(str(entry.get("title") or ""), entry.get("year")))
    })
    years = sorted({int(key[:4]) for key in edition_keys if len(key) >= 4 and key[:4].isdigit()})
    recent = [key for key in edition_keys if key[:4].isdigit() and int(key[:4]) >= 2018]
    return {
        "region": region,
        "institution": institution.get("name"),
        "institutionSlug": institution.get("slug"),
        "cataloguedEntries": len(entries),
        "editionSignals": len(edition_keys),
        "recentEditionSignals": len(recent),
        "distinctYears": len(years),
        "minYear": min(years) if years else None,
        "maxYear": max(years) if years else None,
        "editionKeys": edition_keys,
        "sampleTitles": [str(item.get("title") or "") for item in entries[:8]],
    }


def rank_rows(rows: list[dict]) -> list[dict]:
    return sorted(
        rows,
        key=lambda row: (
            -int(row.get("editionSignals") or 0),
            -int(row.get("recentEditionSignals") or 0),
            -int(row.get("distinctYears") or 0),
            -int(row.get("cataloguedEntries") or 0),
            str(row.get("institutionSlug") or ""),
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rank Brasil Escola vestibular mirrors nationally by catalogued edition signals."
    )
    parser.add_argument("--output", default=".cache/national-ranking/ranking.json")
    parser.add_argument("--catalog-dir", default=".cache/national-ranking/catalogs")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--top", type=int, default=40)
    args = parser.parse_args()

    workers = max(1, min(args.workers, 8))
    base.REGIONS.update(REGIONS)
    catalog_dir = Path(args.catalog_dir)
    catalog_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    issues: list[dict] = []
    region_summaries: list[dict] = []
    for region in REGIONS:
        try:
            catalog = base.catalog_region(region, workers=workers, timeout=args.timeout)
        except Exception as error:
            issues.append({"region": region, "exceptionType": type(error).__name__, "error": str(error)})
            continue
        base.write_catalog(catalog, catalog_dir / f"{region}.json")
        region_summaries.append({
            "region": region,
            "institutionCount": catalog.get("institutionCount", 0),
            "entryCount": catalog.get("entryCount", 0),
            "knownYearRange": catalog.get("knownYearRange"),
            "issues": len(catalog.get("issues", [])),
        })
        issues.extend({"region": region, **item} for item in catalog.get("issues", []))
        rows.extend(summarize_institution(region, institution) for institution in catalog.get("institutions", []))

    ranked = rank_rows(rows)
    payload = {
        "version": 1,
        "providerId": base.PROVIDER_ID,
        "purpose": "national-edition-priority-ranking",
        "regions": region_summaries,
        "institutionCount": len(rows),
        "issues": issues,
        "ranking": ranked,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "regions": region_summaries,
        "institutionsRanked": len(ranked),
        "issues": len(issues),
        "top": ranked[: max(0, args.top)],
    }, ensure_ascii=False, indent=2))
    return 1 if not ranked else 0


if __name__ == "__main__":
    raise SystemExit(main())
