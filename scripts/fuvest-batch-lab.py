#!/usr/bin/env python3
"""Executa backfill FUVEST em lote com checkpoints persistentes por conteúdo.

O laboratório baixa os documentos oficiais para verificar o SHA atual, mas não
repete parsing/recovery/media quando os bytes e as versões dos extratores são
idênticos a um checkpoint existente. O cache é desempenho, nunca autoridade:
qualquer troca de SHA ou versão cria uma chave nova.

Por padrão cobre todas as edições revisadas com caderno canônico. FUVEST 2022 é
naturalmente excluída porque só possui referência/gabarito no manifesto atual.

`editions` no resumo significa edições processadas pelo pipeline. Não significa
que todas as questões da edição estejam prontas para publicação; cobertura
estrutural, mídia e fidelidade semântica permanecem métricas/gates separados.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import runpy
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))
RECOVERY = runpy.run_path(str(Path(__file__).with_name("recover-fuvest-ocr.py")))
MEDIA = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-media.py")))


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_cache_key(namespace: str, version: str, *parts: str) -> str:
    material = "\n".join([namespace, version, *parts]).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def load_valid_extraction_cache(
    path: Path,
    year: int,
    exam_url: str,
    exam_sha: str,
    key_url: str,
    key_sha: str,
) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        envelope = json.loads(path.read_text(encoding="utf-8"))
        if envelope.get("protocolVersion") != "enemlab-extraction/v1":
            return None
        identity = envelope.get("identity", {})
        if identity.get("year") != year or identity.get("editionId") != str(year):
            return None
        documents = {
            str(document.get("url")): str(document.get("sha256", "")).lower()
            for document in envelope.get("documents", [])
            if isinstance(document, dict)
        }
        if documents != {exam_url: exam_sha, key_url: key_sha}:
            return None
        return envelope
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def extraction_for_year(
    year: int,
    entry: dict[str, Any],
    manifest: dict[str, dict[str, Any]],
    cache_dir: Path,
) -> tuple[dict[str, Any], bytes, bool, float]:
    started = time.perf_counter()
    exam_bytes = QUESTIONS["fetch"](entry["examUrl"])
    key_bytes = QUESTIONS["fetch"](entry["answerKeyUrl"])
    QUESTIONS["verify_answer_key_hash"](entry, key_bytes)
    exam_sha = QUESTIONS["sha256_bytes"](exam_bytes)
    key_sha = QUESTIONS["sha256_bytes"](key_bytes)

    version = f"{QUESTIONS['EXTRACTOR_VERSION']}|{RECOVERY['WORKER_VERSION']}"
    cache_key = content_cache_key("fuvest-extraction", version, str(year), exam_sha, key_sha)
    cache_path = cache_dir / "extraction" / str(year) / f"{cache_key}.json"
    cached = load_valid_extraction_cache(
        cache_path,
        year,
        entry["examUrl"],
        exam_sha,
        entry["answerKeyUrl"],
        key_sha,
    )
    if cached is not None:
        return cached, exam_bytes, True, time.perf_counter() - started

    pages = QUESTIONS["extract_pdf_pages"](exam_bytes)
    try:
        envelope = QUESTIONS["build_envelope"](entry, exam_bytes, key_bytes, pages)
    except Exception as primary_error:  # fail-closed recovery is still attempted selectively
        failure = QUESTIONS["build_failure_envelope"](
            entry, exam_bytes, key_bytes, pages, primary_error
        )
        _, target_pages = RECOVERY["validate_failure_envelope"](failure, manifest)
        recovered_pages, labels, geometry = RECOVERY["reconstruct_target_pages"](
            exam_bytes,
            target_pages,
            int(entry["total"]),
        )
        envelope = RECOVERY["build_recovery_envelope"](
            failure,
            entry,
            exam_bytes,
            key_bytes,
            recovered_pages,
            boundary_labels=labels,
            geometry=geometry,
        )

    write_json(cache_path, envelope)
    return envelope, exam_bytes, False, time.perf_counter() - started


def media_for_year(
    year: int,
    envelope: dict[str, Any],
    exam_bytes: bytes,
    cache_dir: Path,
    media_dir: Path,
) -> tuple[dict[str, Any], bool]:
    exam_sha = QUESTIONS["sha256_bytes"](exam_bytes)
    extraction_sha = hashlib.sha256(stable_json(envelope["extraction"]).encode("utf-8")).hexdigest()
    cache_key = content_cache_key(
        "fuvest-media",
        MEDIA["EXTRACTOR_VERSION"],
        str(year),
        exam_sha,
        extraction_sha,
    )
    cache_path = cache_dir / "media" / str(year) / f"{cache_key}.json"
    if cache_path.exists():
        try:
            value = json.loads(cache_path.read_text(encoding="utf-8"))
            if (
                value.get("protocolVersion") == "enemlab-media/v1"
                and value.get("editionId") == str(year)
                and value.get("document", {}).get("sha256") == exam_sha
            ):
                return value, True
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass

    output_dir = media_dir / str(year)
    manifest = MEDIA["build_media_manifest"](
        envelope,
        exam_bytes,
        output_dir,
        f"/ingestion-media/fuvest/{year}",
    )
    write_json(cache_path, manifest)
    return manifest, False


def process_year(
    year: int,
    entry: dict[str, Any],
    manifest: dict[str, dict[str, Any]],
    cache_dir: Path,
    media_dir: Path,
    include_media: bool,
) -> dict[str, Any]:
    QUESTIONS["validate_manifest_entry"](entry, year)
    envelope, exam_bytes, extraction_hit, elapsed = extraction_for_year(
        year, entry, manifest, cache_dir
    )
    extraction_metrics = QUESTIONS["metrics"](envelope)
    result: dict[str, Any] = {
        "year": year,
        "questions": extraction_metrics["questions"],
        "completeStructure": extraction_metrics["structurallyComplete"],
        "missingMedia": extraction_metrics["missingMedia"],
        "semanticIssues": extraction_metrics["semanticUnsafe"],
        "needsTextReview": extraction_metrics["needsTextReview"],
        "recovered": bool(envelope.get("recovery")),
        "extractionCacheHit": extraction_hit,
        "elapsedSeconds": round(elapsed, 3),
    }

    if include_media:
        media_manifest, media_hit = media_for_year(
            year, envelope, exam_bytes, cache_dir, media_dir
        )
        media_metrics = MEDIA["metrics"](media_manifest)
        result.update(
            {
                "mediaAssets": media_metrics["assets"],
                "mediaAutomatic": media_metrics["automatic"],
                "mediaReview": media_metrics["review"],
                "questionsWithAutomaticMedia": media_metrics[
                    "questionsWithAutomaticMedia"
                ],
                "mediaCacheHit": media_hit,
            }
        )
    return result


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(results, key=lambda item: int(item["year"]))
    return {
        "editions": len(ordered),
        "questions": sum(int(item["questions"]) for item in ordered),
        "completeStructure": sum(int(item["completeStructure"]) for item in ordered),
        "missingMedia": sum(int(item["missingMedia"]) for item in ordered),
        "semanticIssues": sum(int(item["semanticIssues"]) for item in ordered),
        "needsTextReview": sum(int(item["needsTextReview"]) for item in ordered),
        "recoveredEditions": sum(bool(item["recovered"]) for item in ordered),
        "extractionCacheHits": sum(bool(item["extractionCacheHit"]) for item in ordered),
        "mediaAssets": sum(int(item.get("mediaAssets", 0)) for item in ordered),
        "mediaAutomatic": sum(int(item.get("mediaAutomatic", 0)) for item in ordered),
        "mediaReview": sum(int(item.get("mediaReview", 0)) for item in ordered),
        "questionsWithAutomaticMedia": sum(
            int(item.get("questionsWithAutomaticMedia", 0)) for item in ordered
        ),
        "mediaCacheHits": sum(bool(item.get("mediaCacheHit")) for item in ordered),
        "results": ordered,
    }


def parse_years(raw: str | None, manifest: dict[str, dict[str, Any]]) -> list[int]:
    eligible = sorted(
        int(year)
        for year, entry in manifest.items()
        if entry.get("examUrl") and entry.get("answerKeyUrl")
    )
    if not raw:
        return eligible
    requested = sorted({int(value.strip()) for value in raw.split(",") if value.strip()})
    unknown = [year for year in requested if year not in eligible]
    if unknown:
        raise ValueError(f"edições sem caderno revisado: {unknown}")
    return requested


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", help="lista separada por vírgula; padrão: todas elegíveis")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".ingestion-cache")
    parser.add_argument("--media-dir", type=Path, default=ROOT / ".ingestion-media" / "fuvest")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--no-media", action="store_true")
    args = parser.parse_args(argv)

    if args.concurrency < 1 or args.concurrency > 8:
        raise ValueError("concurrency must be between 1 and 8")

    manifest = QUESTIONS["load_manifest"]()
    years = parse_years(args.years, manifest)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {
            executor.submit(
                process_year,
                year,
                manifest[str(year)],
                manifest,
                args.cache_dir,
                args.media_dir,
                not args.no_media,
            ): year
            for year in years
        }
        for future in as_completed(futures):
            year = futures[future]
            try:
                value = future.result()
                results.append(value)
                print(json.dumps(value, ensure_ascii=False), file=sys.stderr)
            except Exception as error:  # noqa: BLE001
                failures.append({"year": year, "error": str(error)})
                print(f"FUVEST {year}: BLOCKED — {error}", file=sys.stderr)

    summary = summarize(results)
    summary["failures"] = sorted(failures, key=lambda item: int(item["year"]))
    summary["requestedEditions"] = len(years)
    if args.output:
        write_json(args.output, summary)
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"BATCH BLOCKED — {error}", file=sys.stderr)
        raise SystemExit(1)
