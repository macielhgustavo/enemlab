#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable

PROVIDER_ID = "brasil-escola"
SCHEMA = "enemlab-third-party-catalog/v1"
BASE_URL = "https://vestibular.brasilescola.uol.com.br"
ALLOWED_HOST = "vestibular.brasilescola.uol.com.br"
STATIC_HOST_SUFFIX = ".static.brasilescola.uol.com.br"
REGIONS = {
    "nordeste": f"{BASE_URL}/downloads/nordeste.htm",
}
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 ENEMLab/1.0"
)
MAX_HTML_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
DOWNLOAD_RE = re.compile(r"^/baixar/(\d+)$")
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
DOWNLOAD_COUNT_RE = re.compile(r"\s+(\d[\d.]*)\s+downloads?\s+realizados?\s*$", re.IGNORECASE)


def compact_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def deaccent(value: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFD", value)
        if unicodedata.category(char) != "Mn"
    ).lower()


def slugify(value: str) -> str:
    value = deaccent(value)
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "unknown"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def allowed_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.hostname == ALLOWED_HOST


def allowed_download_response_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = parsed.hostname or ""
    return (
        parsed.scheme == "https"
        and (
            host == ALLOWED_HOST
            or host == "static.brasilescola.uol.com.br"
            or host.endswith(STATIC_HOST_SUFFIX)
        )
    )


def normalize_site_url(href: str, base_url: str) -> str | None:
    href = compact_space(href)
    if not href:
        return None
    try:
        absolute = urllib.parse.urljoin(base_url, href)
        parsed = urllib.parse.urlsplit(absolute)
    except ValueError:
        return None
    if parsed.scheme != "https" or parsed.hostname != ALLOWED_HOST:
        return None
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, parsed.query, "")
    )


@dataclass(frozen=True)
class Anchor:
    href: str
    text: str


class AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._href: str | None = None
        self._parts: list[str] = []
        self.anchors: list[Anchor] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a" or self._href is not None:
            return
        href = next((value for key, value in attrs if key.lower() == "href"), None)
        if href is None:
            return
        self._href = href
        self._parts = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._href is None:
            return
        self.anchors.append(Anchor(self._href, compact_space(" ".join(self._parts))))
        self._href = None
        self._parts = []


@dataclass(frozen=True)
class Institution:
    name: str
    slug: str
    page_url: str


@dataclass
class CatalogEntry:
    institution: str
    institution_slug: str
    institution_page_url: str
    download_id: int
    title: str
    year: int | None
    listed_downloads: int | None
    download_url: str
    local_path: str | None = None
    sha256: str | None = None
    bytes: int | None = None
    acquisition: str | None = None


def parse_anchors(html: str) -> list[Anchor]:
    parser = AnchorParser()
    parser.feed(html)
    parser.close()
    return parser.anchors


def parse_region_page(html: str, page_url: str) -> list[Institution]:
    output: dict[str, Institution] = {}
    current_path = urllib.parse.urlsplit(page_url).path.rstrip("/")
    for anchor in parse_anchors(html):
        url = normalize_site_url(anchor.href, page_url)
        if url is None:
            continue
        path = urllib.parse.urlsplit(url).path
        if not path.startswith("/downloads/") or not path.endswith(".htm"):
            continue
        if path.rstrip("/") == current_path:
            continue
        basename = path.rsplit("/", 1)[-1]
        if basename in {"nordeste.htm", "norte.htm", "sul.htm", "sudeste.htm", "centro-oeste.htm"}:
            continue
        name = compact_space(anchor.text)
        if not name:
            continue
        slug = basename.removesuffix(".htm")
        output[url] = Institution(name=name, slug=slug, page_url=url)
    return sorted(output.values(), key=lambda item: item.slug)


def parse_download_count(raw_title: str) -> tuple[str, int | None]:
    match = DOWNLOAD_COUNT_RE.search(raw_title)
    if not match:
        return compact_space(raw_title), None
    count = int(match.group(1).replace(".", ""))
    return compact_space(raw_title[: match.start()]), count


def parse_institution_page(
    html: str,
    institution: Institution,
) -> list[CatalogEntry]:
    output: dict[int, CatalogEntry] = {}
    for anchor in parse_anchors(html):
        url = normalize_site_url(anchor.href, institution.page_url)
        if url is None:
            continue
        path = urllib.parse.urlsplit(url).path
        match = DOWNLOAD_RE.fullmatch(path)
        if not match:
            continue
        download_id = int(match.group(1))
        title, count = parse_download_count(anchor.text)
        if not title:
            title = f"{institution.name} download {download_id}"
        year_match = YEAR_RE.search(title)
        year = int(year_match.group(1)) if year_match else None
        output[download_id] = CatalogEntry(
            institution=institution.name,
            institution_slug=institution.slug,
            institution_page_url=institution.page_url,
            download_id=download_id,
            title=title,
            year=year,
            listed_downloads=count,
            download_url=f"{BASE_URL}/baixar/{download_id}",
        )
    return sorted(
        output.values(),
        key=lambda item: (
            -(item.year or 0),
            -item.download_id,
        ),
    )


def fetch_bytes(
    url: str,
    *,
    max_bytes: int,
    timeout: float,
    retries: int = 2,
    extra_headers: dict[str, str] | None = None,
) -> tuple[bytes, dict[str, str], str]:
    if not allowed_url(url):
        raise ValueError(f"URL outside Brasil Escola allowlist: {url}")
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            headers = {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/zip,application/octet-stream;q=0.9,*/*;q=0.1",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
            }
            if extra_headers:
                headers.update(extra_headers)
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                final_url = response.geturl()
                if not allowed_download_response_url(final_url):
                    raise ValueError(f"redirect outside Brasil Escola allowlist: {final_url}")
                data = response.read(max_bytes + 1)
                if len(data) > max_bytes:
                    raise ValueError(f"response exceeds {max_bytes} bytes: {url}")
                headers = {key.lower(): value for key, value in response.headers.items()}
                return data, headers, final_url
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last_error = error
            if attempt >= retries:
                break
            time.sleep(0.5 * (attempt + 1))
    assert last_error is not None
    raise last_error


def fetch_text(url: str, *, timeout: float) -> str:
    data, headers, _ = fetch_bytes(url, max_bytes=MAX_HTML_BYTES, timeout=timeout)
    content_type = headers.get("content-type", "")
    if content_type and "html" not in content_type and "text/" not in content_type:
        raise ValueError(f"expected HTML/text from {url}, got {content_type}")
    charset = "utf-8"
    match = re.search(r"charset=([A-Za-z0-9._-]+)", content_type, re.IGNORECASE)
    if match:
        charset = match.group(1)
    return data.decode(charset, errors="replace")


def discover_institution(
    institution: Institution,
    *,
    timeout: float,
) -> tuple[Institution, list[CatalogEntry], str | None]:
    try:
        html = fetch_text(institution.page_url, timeout=timeout)
        return institution, parse_institution_page(html, institution), None
    except Exception as error:
        return institution, [], str(error)


def catalog_region(
    region: str,
    *,
    workers: int,
    timeout: float,
) -> dict:
    page_url = REGIONS[region]
    region_html = fetch_text(page_url, timeout=timeout)
    institutions = parse_region_page(region_html, page_url)
    results: list[tuple[Institution, list[CatalogEntry], str | None]]
    if workers <= 1:
        results = [
            discover_institution(institution, timeout=timeout)
            for institution in institutions
        ]
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [
                pool.submit(discover_institution, institution, timeout=timeout)
                for institution in institutions
            ]
            results = [future.result() for future in futures]

    issues: list[dict] = []
    institution_payloads: list[dict] = []
    all_entries: list[CatalogEntry] = []
    for institution, entries, error in sorted(results, key=lambda item: item[0].slug):
        if error:
            issues.append(
                {
                    "institution": institution.name,
                    "institutionSlug": institution.slug,
                    "pageUrl": institution.page_url,
                    "error": error,
                }
            )
        all_entries.extend(entries)
        institution_payloads.append(
            {
                "name": institution.name,
                "slug": institution.slug,
                "pageUrl": institution.page_url,
                "entries": [entry_to_json(entry) for entry in entries],
            }
        )

    known_years = sorted({entry.year for entry in all_entries if entry.year is not None})
    return {
        "schema": SCHEMA,
        "providerId": PROVIDER_ID,
        "rightsStatus": "third-party-mirror-reference",
        "region": region,
        "catalogUrl": page_url,
        "institutionCount": len(institutions),
        "entryCount": len(all_entries),
        "knownYearRange": (
            {"min": min(known_years), "max": max(known_years)}
            if known_years
            else None
        ),
        "unknownYearEntries": sum(1 for entry in all_entries if entry.year is None),
        "issues": issues,
        "institutions": institution_payloads,
    }


def entry_to_json(entry: CatalogEntry) -> dict:
    return {
        "institution": entry.institution,
        "institutionSlug": entry.institution_slug,
        "institutionPageUrl": entry.institution_page_url,
        "downloadId": entry.download_id,
        "title": entry.title,
        "year": entry.year,
        "listedDownloads": entry.listed_downloads,
        "downloadUrl": entry.download_url,
        "localPath": entry.local_path,
        "sha256": entry.sha256,
        "bytes": entry.bytes,
        "acquisition": entry.acquisition,
    }


def entry_from_json(payload: dict) -> CatalogEntry:
    return CatalogEntry(
        institution=payload["institution"],
        institution_slug=payload["institutionSlug"],
        institution_page_url=payload["institutionPageUrl"],
        download_id=int(payload["downloadId"]),
        title=payload["title"],
        year=payload.get("year"),
        listed_downloads=payload.get("listedDownloads"),
        download_url=payload["downloadUrl"],
        local_path=payload.get("localPath"),
        sha256=payload.get("sha256"),
        bytes=payload.get("bytes"),
        acquisition=payload.get("acquisition"),
    )


def iter_entries(catalog: dict) -> Iterable[CatalogEntry]:
    for institution in catalog["institutions"]:
        for payload in institution["entries"]:
            yield entry_from_json(payload)


def safe_archive_name(entry: CatalogEntry) -> str:
    title_slug = slugify(entry.title)[:100]
    return f"{entry.download_id}-{title_slug}.zip"


def download_entry(
    entry: CatalogEntry,
    *,
    download_root: Path,
    timeout: float,
    refresh: bool,
) -> CatalogEntry:
    year_part = str(entry.year) if entry.year is not None else "unknown-year"
    directory = download_root / entry.institution_slug / year_part
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / safe_archive_name(entry)

    if target.exists() and not refresh:
        data = target.read_bytes()
        if not zipfile.is_zipfile(io.BytesIO(data)):
            raise ValueError(f"cached file is not a ZIP: {target}")
        entry.local_path = str(target)
        entry.sha256 = sha256_bytes(data)
        entry.bytes = len(data)
        entry.acquisition = "cache"
        return entry

    data, headers, resolved_url = fetch_bytes(
        entry.download_url,
        max_bytes=MAX_ARCHIVE_BYTES,
        timeout=timeout,
        extra_headers={"Referer": entry.institution_page_url},
    )
    if not zipfile.is_zipfile(io.BytesIO(data)):
        content_type = headers.get("content-type", "")
        raise ValueError(
            f"download {entry.download_id} is not a ZIP "
            f"(content-type={content_type or 'unknown'})"
        )
    target.write_bytes(data)
    entry.local_path = str(target)
    entry.sha256 = sha256_bytes(data)
    entry.bytes = len(data)
    entry.acquisition = "network"

    metadata = {
        "schema": "enemlab-third-party-acquisition/v1",
        "providerId": PROVIDER_ID,
        "rightsStatus": "third-party-mirror-reference",
        **entry_to_json(entry),
        "resolvedDownloadUrl": resolved_url,
        "contentType": headers.get("content-type"),
        "etag": headers.get("etag"),
        "lastModified": headers.get("last-modified"),
    }
    target.with_suffix(target.suffix + ".meta.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return entry


def selection_matches(
    entry: CatalogEntry,
    institution_filters: list[str],
    years: set[int],
) -> bool:
    if institution_filters:
        haystack = f"{entry.institution_slug} {deaccent(entry.institution)}"
        if not any(deaccent(value) in haystack for value in institution_filters):
            return False
    if years and entry.year not in years:
        return False
    return True


def apply_downloads(
    catalog: dict,
    *,
    download_root: Path,
    institution_filters: list[str],
    years: set[int],
    limit: int | None,
    workers: int,
    timeout: float,
    refresh: bool,
) -> tuple[dict, list[dict]]:
    selected = [
        entry
        for entry in iter_entries(catalog)
        if selection_matches(entry, institution_filters, years)
    ]
    selected.sort(
        key=lambda item: (
            item.institution_slug,
            -(item.year or 0),
            -item.download_id,
        )
    )
    if limit is not None:
        selected = selected[: max(0, limit)]

    errors: list[dict] = []

    def one(entry: CatalogEntry) -> CatalogEntry:
        return download_entry(
            entry,
            download_root=download_root,
            timeout=timeout,
            refresh=refresh,
        )

    results: dict[int, CatalogEntry] = {}
    if workers <= 1:
        for entry in selected:
            try:
                downloaded = one(entry)
                results[downloaded.download_id] = downloaded
            except Exception as error:
                errors.append({"downloadId": entry.download_id, "title": entry.title, "error": str(error)})
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            future_map = {pool.submit(one, entry): entry for entry in selected}
            for future in concurrent.futures.as_completed(future_map):
                entry = future_map[future]
                try:
                    downloaded = future.result()
                    results[downloaded.download_id] = downloaded
                except Exception as error:
                    errors.append({"downloadId": entry.download_id, "title": entry.title, "error": str(error)})

    for institution in catalog["institutions"]:
        for payload in institution["entries"]:
            download_id = int(payload["downloadId"])
            if download_id in results:
                payload.update(entry_to_json(results[download_id]))

    catalog["acquisition"] = {
        "selected": len(selected),
        "downloaded": sum(1 for item in results.values() if item.acquisition == "network"),
        "cacheHits": sum(1 for item in results.values() if item.acquisition == "cache"),
        "bytes": sum(item.bytes or 0 for item in results.values()),
        "errors": errors,
    }
    return catalog, errors


def write_catalog(catalog: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def print_summary(catalog: dict) -> None:
    acquisition = catalog.get("acquisition") or {}
    summary = {
        "providerId": catalog["providerId"],
        "region": catalog["region"],
        "institutions": catalog["institutionCount"],
        "entries": catalog["entryCount"],
        "knownYearRange": catalog["knownYearRange"],
        "unknownYearEntries": catalog["unknownYearEntries"],
        "catalogIssues": len(catalog["issues"]),
        "downloadsSelected": acquisition.get("selected", 0),
        "downloadsNetwork": acquisition.get("downloaded", 0),
        "downloadsCache": acquisition.get("cacheHits", 0),
        "downloadBytes": acquisition.get("bytes", 0),
        "downloadErrors": len(acquisition.get("errors", [])),
        "acquisitionErrors": acquisition.get("errors", []),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Catalog and acquire vestibular ZIP mirrors from Brasil Escola."
    )
    parser.add_argument("--region", choices=sorted(REGIONS), default="nordeste")
    parser.add_argument(
        "--catalog",
        default=".ingestion-cache/brasil-escola/nordeste/catalog.json",
        help="catalog JSON output",
    )
    parser.add_argument(
        "--download-root",
        default=".ingestion-inbox/brasil-escola/nordeste",
        help="ZIP destination root",
    )
    parser.add_argument("--download", action="store_true", help="download selected ZIPs")
    parser.add_argument("--institution", action="append", default=[], help="institution slug/name filter; repeatable")
    parser.add_argument("--year", action="append", type=int, default=[], help="year filter; repeatable")
    parser.add_argument("--limit", type=int, default=None, help="maximum ZIP downloads after filtering")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--refresh", action="store_true", help="redownload existing ZIPs")
    parser.add_argument("--strict", action="store_true", help="exit nonzero on catalog/download issues")
    args = parser.parse_args()

    workers = max(1, min(args.workers, 8))
    try:
        catalog = catalog_region(args.region, workers=workers, timeout=args.timeout)
    except Exception as error:
        print(f"catalog failed: {error}", file=sys.stderr)
        return 2

    download_errors: list[dict] = []
    if args.download:
        catalog, download_errors = apply_downloads(
            catalog,
            download_root=Path(args.download_root),
            institution_filters=args.institution,
            years=set(args.year),
            limit=args.limit,
            workers=workers,
            timeout=args.timeout,
            refresh=args.refresh,
        )

    write_catalog(catalog, Path(args.catalog))
    print_summary(catalog)
    if args.strict and (catalog["issues"] or download_errors):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
