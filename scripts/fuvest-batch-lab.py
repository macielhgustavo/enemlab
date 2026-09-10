#!/usr/bin/env python3
"""Executa backfill FUVEST em lote com checkpoints persistentes por conteúdo.

O laboratório baixa os documentos oficiais para verificar o SHA atual, mas não
repete parsing/recovery/media quando os bytes e as versões dos extratores são
idênticos a um checkpoint existente. O cache é desempenho, nunca autoridade:
qualquer troca de SHA ou versão cria uma chave nova.

Antes do parser, glifos semanticamente suspeitos podem passar por recuperação
determinística baseada na própria fonte embutida. A página reparada só é usada
quando existe evidência positiva e o parser continua fechando; caso contrário,
o texto nativo original é preservado e os gates semânticos continuam bloqueando.

Depois da extração estrutural, layouts explicitamente suportados podem passar por
OCR regional local. Esse fallback usa a geometria oficial para fixar a identidade
da questão e só aplica uma substituição quando recupera enunciado + A-E completos.
Conteúdo OCR continua semanticamente bloqueado até revisão e nunca altera gabarito.

A concorrência do pipeline e a concorrência de OCR são orçamentos separados.
Downloads/parsing podem continuar paralelos enquanto recoveries pesados de
Tesseract/PyMuPDF são limitados independentemente para evitar oversubscription.

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
from threading import BoundedSemaphore
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = runpy.run_path(str(Path(__file__).with_name("extract-fuvest-questions.py")))
RECOVERY = runpy.run_path(str(Path(__file__).with_name("recover-fuvest-ocr.py")))
FONTMAP = runpy.run_path(str(Path(__file__).with_name("recover-fuvest-font-map.py")))
REGIONAL = runpy.run_path(str(Path(__file__).with_name("recover-fuvest-region-ocr.py")))
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


def validate_concurrency(value: int, name: str) -> int:
    if value < 1 or value > 8:
        raise ValueError(f"{name} must be between 1 and 8")
    return value


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


def pages_have_suspicious_glyphs(pages: list[str]) -> bool:
    detector = FONTMAP["is_suspicious"]
    return any(detector(char) for page in pages for char in page)


def attempt_proven_font_recovery(
    pdf_bytes: bytes,
    native_pages: list[str],
) -> tuple[list[str], dict[str, Any]]:
    base = {
        "workerVersion": FONTMAP["WORKER_VERSION"],
        "attempted": False,
        "applied": False,
        "resolvedOccurrences": 0,
        "unresolvedOccurrences": 0,
        "provenMappings": [],
        "unresolvedClusters": [],
    }
    if not pages_have_suspicious_glyphs(native_pages):
        return native_pages, base

    repaired_pages, report = FONTMAP["repair_pdf_pages"](pdf_bytes)
    normalized = {**base, **report, "attempted": True, "applied": False}
    if len(repaired_pages) != len(native_pages):
        normalized["rejectedReason"] = "page-count-changed"
        return native_pages, normalized
    if int(report.get("resolvedOccurrences", 0)) <= 0:
        normalized["rejectedReason"] = "no-proven-mapping"
        return native_pages, normalized
    normalized["applied"] = True
    return repaired_pages, normalized


def attach_font_recovery_metadata(
    envelope: dict[str, Any], report: dict[str, Any]
) -> dict[str, Any]:
    envelope["fontMapRecovery"] = report
    return envelope


def empty_regional_report(envelope: dict[str, Any]) -> dict[str, Any]:
    return {
        "workerVersion": REGIONAL["WORKER_VERSION"],
        "attempted": False,
        "applied": False,
        "targetedQuestions": [],
        "appliedQuestions": [],
        "unresolvedQuestions": [],
        "attemptsByMode": {},
        "regions": [],
    }


def regional_result_is_cacheable(report: dict[str, Any]) -> bool:
    reason = str(report.get("rejectedReason", ""))
    dependency_failures = {
        "tesseract-not-installed",
        "tesseract-language-probe-failed",
        "tesseract-portuguese-language-missing",
        "pymupdf-not-installed",
        "PyMuPDF is required for regional OCR geometry",
    }
    return reason not in dependency_failures


def run_boundary_recovery(
    failure: dict[str, Any],
    entry: dict[str, Any],
    manifest: dict[str, dict[str, Any]],
    exam_bytes: bytes,
    key_bytes: bytes,
    ocr_limiter: BoundedSemaphore,
) -> dict[str, Any]:
    _, target_pages = RECOVERY["validate_failure_envelope"](failure, manifest)
    with ocr_limiter:
        recovered_pages, labels, geometry = RECOVERY["reconstruct_target_pages"](
            exam_bytes,
            target_pages,
            int(entry["total"]),
        )
    return RECOVERY["build_recovery_envelope"](
        failure,
        entry,
        exam_bytes,
        key_bytes,
        recovered_pages,
        boundary_labels=labels,
        geometry=geometry,
    )


def extraction_for_year(
    year: int,
    entry: dict[str, Any],
    manifest: dict[str, dict[str, Any]],
    cache_dir: Path,
    ocr_limiter: BoundedSemaphore,
) -> tuple[dict[str, Any], bytes, bool, float]:
    started = time.perf_counter()
    exam_bytes = QUESTIONS["fetch"](entry["examUrl"])
    key_bytes = QUESTIONS["fetch"](entry["answerKeyUrl"])
    QUESTIONS["verify_answer_key_hash"](entry, key_bytes)
    exam_sha = QUESTIONS["sha256_bytes"](exam_bytes)
    key_sha = QUESTIONS["sha256_bytes"](key_bytes)

    version = (
        f"{QUESTIONS['EXTRACTOR_VERSION']}|"
        f"{FONTMAP['WORKER_VERSION']}|"
        f"{RECOVERY['WORKER_VERSION']}|"
        f"{REGIONAL['WORKER_VERSION']}"
    )
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

    native_pages = QUESTIONS["extract_pdf_pages"](exam_bytes)
    candidate_pages, font_report = attempt_proven_font_recovery(exam_bytes, native_pages)

    try:
        envelope = QUESTIONS["build_envelope"](
            entry, exam_bytes, key_bytes, candidate_pages
        )
    except Exception as repaired_error:
        if bool(font_report.get("applied")):
            font_report["applied"] = False
            font_report["rejectedReason"] = "parser-regression"
            font_report["parserRegression"] = str(repaired_error)
            try:
                envelope = QUESTIONS["build_envelope"](
                    entry, exam_bytes, key_bytes, native_pages
                )
            except Exception as primary_error:
                failure = QUESTIONS["build_failure_envelope"](
                    entry, exam_bytes, key_bytes, native_pages, primary_error
                )
                envelope = run_boundary_recovery(
                    failure,
                    entry,
                    manifest,
                    exam_bytes,
                    key_bytes,
                    ocr_limiter,
                )
        else:
            failure = QUESTIONS["build_failure_envelope"](
                entry, exam_bytes, key_bytes, native_pages, repaired_error
            )
            envelope = run_boundary_recovery(
                failure,
                entry,
                manifest,
                exam_bytes,
                key_bytes,
                ocr_limiter,
            )

    attach_font_recovery_metadata(envelope, font_report)

    regional_report = empty_regional_report(envelope)
    if REGIONAL["should_attempt_region_recovery"](envelope, entry):
        with ocr_limiter:
            envelope, regional_report = REGIONAL["recover_envelope"](
                envelope, entry, exam_bytes, key_bytes
            )
    envelope["regionalContentRecovery"] = regional_report

    if regional_result_is_cacheable(regional_report):
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
    ocr_limiter: BoundedSemaphore,
) -> dict[str, Any]:
    QUESTIONS["validate_manifest_entry"](entry, year)
    envelope, exam_bytes, extraction_hit, elapsed = extraction_for_year(
        year, entry, manifest, cache_dir, ocr_limiter
    )
    extraction_metrics = QUESTIONS["metrics"](envelope)
    font_map = envelope.get("fontMapRecovery", {})
    regional = envelope.get("regionalContentRecovery", {})
    result: dict[str, Any] = {
        "year": year,
        "questions": extraction_metrics["questions"],
        "completeStructure": extraction_metrics["structurallyComplete"],
        "missingMedia": extraction_metrics["missingMedia"],
        "semanticIssues": extraction_metrics["semanticUnsafe"],
        "needsTextReview": extraction_metrics["needsTextReview"],
        "recovered": bool(envelope.get("recovery")),
        "fontMapAttempted": bool(font_map.get("attempted")),
        "fontMapApplied": bool(font_map.get("applied")),
        "fontMapResolvedOccurrences": int(font_map.get("resolvedOccurrences", 0)),
        "fontMapUnresolvedOccurrences": int(font_map.get("unresolvedOccurrences", 0)),
        "regionalRecoveryAttempted": bool(regional.get("attempted")),
        "regionalRecoveryApplied": bool(regional.get("applied")),
        "regionalRecoveryTargetedQuestions": len(regional.get("targetedQuestions", [])),
        "regionalRecoveryAppliedQuestions": len(regional.get("appliedQuestions", [])),
        "regionalRecoveryUnresolvedQuestions": len(regional.get("unresolvedQuestions", [])),
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
        "fontMapAttemptedEditions": sum(bool(item.get("fontMapAttempted")) for item in ordered),
        "fontMapAppliedEditions": sum(bool(item.get("fontMapApplied")) for item in ordered),
        "fontMapResolvedOccurrences": sum(
            int(item.get("fontMapResolvedOccurrences", 0)) for item in ordered
        ),
        "fontMapUnresolvedOccurrences": sum(
            int(item.get("fontMapUnresolvedOccurrences", 0)) for item in ordered
        ),
        "regionalRecoveryAttemptedEditions": sum(
            bool(item.get("regionalRecoveryAttempted")) for item in ordered
        ),
        "regionalRecoveryAppliedEditions": sum(
            bool(item.get("regionalRecoveryApplied")) for item in ordered
        ),
        "regionalRecoveryTargetedQuestions": sum(
            int(item.get("regionalRecoveryTargetedQuestions", 0)) for item in ordered
        ),
        "regionalRecoveryAppliedQuestions": sum(
            int(item.get("regionalRecoveryAppliedQuestions", 0)) for item in ordered
        ),
        "regionalRecoveryUnresolvedQuestions": sum(
            int(item.get("regionalRecoveryUnresolvedQuestions", 0)) for item in ordered
        ),
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
    parser.add_argument(
        "--ocr-concurrency",
        type=int,
        default=1,
        help="recoveries OCR pesados simultâneos; padrão: 1",
    )
    parser.add_argument("--no-media", action="store_true")
    args = parser.parse_args(argv)

    validate_concurrency(args.concurrency, "concurrency")
    validate_concurrency(args.ocr_concurrency, "ocr-concurrency")

    manifest = QUESTIONS["load_manifest"]()
    years = parse_years(args.years, manifest)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    ocr_limiter = BoundedSemaphore(args.ocr_concurrency)

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
                ocr_limiter,
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
    summary["pipelineConcurrency"] = args.concurrency
    summary["ocrConcurrency"] = args.ocr_concurrency
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
