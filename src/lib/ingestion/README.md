# ENEMLab Ingestion Engine

The ingestion engine exists to make question-bank growth a throughput problem instead of a hand-coding problem.

The target is not "support one more exam". The target is to ingest thousands of official exam documents through a repeatable, provenance-bound pipeline without writing code for each edition.

## Pipeline

```text
OFFICIAL SOURCE
      ↓
  DISCOVERY
      ↓
    PLAN
      ↓
DOWNLOAD + SHA-256
      ↓
PDF TEXT / GEOMETRY
      ↓
PROOF-AWARE FONT RECOVERY
      ↓
PRIMARY EXTRACTOR
      ↓
STRUCTURE + SEMANTIC FIDELITY + MEDIA CHECKS
      ↓
TARGETED FALLBACK FOR EXCEPTIONS
      ↓
CANONICAL VALIDATOR
      ↓
BLOCKED / READY FOR REVIEW
      ↓
HUMAN REVIEW
      ↓
EXISTING PUBLICATION GATES
```

A successful engine job is **not published**. It is only staged for review and the existing reviewed/verified + rights gates remain authoritative.

## Core guarantees

The current engine provides:

- bounded batch concurrency;
- stable logical identity by provider/edition/phase/variant;
- allowlist enforcement before download;
- SHA-256 provenance for every fetched document;
- silent upstream document-change detection;
- fail-closed count/number/answer-key validation;
- duplicate-job blocking;
- separation of native candidates from reference-only data;
- semantic-fidelity findings and publication gating;
- selective fallback requests by question/page;
- explicit review queue;
- no automatic publication;
- external success protocol `enemlab-extraction/v1`;
- SHA-bound failure/recovery protocol `enemlab-extraction-failure/v1`;
- media protocol `enemlab-media/v1`;
- extraction checkpoints keyed by document SHA + extractor/recovery versions.

## FUVEST laboratory

FUVEST is the first high-volume benchmark. The reviewed manifest contains 22 editions from 2005–2026, totaling 2,000 objective references.

Two adapters intentionally coexist:

- `createFuvestManifestAdapter()`: 22 editions / 2,000 reference questions;
- `createFuvestExternalAdapter()`: 21 editions / 1,910 questions with a canonical official exam PDF.

FUVEST 2022 currently has no canonical `examUrl` in the reviewed manifest, so it remains valid as reference-only data but does not enter text/media extraction.

FUVEST remains `reference-only` + `official-reference`. Technical extraction success does **not** change redistribution rights or authorize native publication.

## Deterministic question extractor

`scripts/extract-fuvest-questions.py` reads an official first-phase booklet and emits `enemlab-extraction/v1` when deterministic extraction succeeds.

```bash
npm run ingest:fuvest:questions -- --year 2025 --metrics
python scripts/extract-fuvest-questions.py --year 2018 --failure-output /tmp/fuvest-2018.failure.json
```

Important rules:

- question boundaries must be sequential and complete;
- legacy `a)`, modern `(A)` and modern `{01}` layouts are supported;
- alternatives become structured only when A–E are recovered in order;
- incomplete alternatives remain staged for review;
- `Note e adote:` stays question context;
- media references are flagged in `questionsMissingMedia`;
- answer-key SHA must match the reviewed manifest fingerprint;
- Unicode cleanup uses NFC, not NFKC, so `²` is not rewritten to `2`;
- corrupted control/replacement/private-use glyphs are recorded before cleanup;
- no extraction result publishes itself.

## Raster-boundary recovery: FUVEST 2018

FUVEST 2018 preserves much of the body text but rasterizes question-number labels. The primary text parser found only 28/90 trustworthy numeric boundaries despite 85 complete A–E sequences.

`scripts/recover-fuvest-ocr.py`:

- verifies the SHA-bound failure envelope;
- renders only recovery-target pages;
- masks glyphs already represented by the native text layer;
- detects raster labels by stable geometry/density;
- requires exactly the reviewed question count before assigning structural sequence 1..N;
- reconstructs the body from native PDF text rather than OCRing the whole exam;
- never derives or changes the answer key;
- keeps recovered content semantic-review-gated.

Real result: 90/90 boundaries recovered, 84/90 structurally complete, 6/90 requiring text/structure review, 19/90 with media pending and zero hosted OCR/LLM API calls for boundary recovery.

## Semantic Fidelity Gate

Structure is not semantic correctness. The gate detects:

- disallowed control characters;
- `U+FFFD` replacement characters;
- Unicode private-use glyphs;
- extractor-reported formula/layout ambiguity;
- impossible metadata such as an issue targeting a nonexistent question.

`contentReadyQuestions` is only a structural/media metric. It does not certify formulas, symbols, typography or text semantics.

`nativeContentCandidate` requires rights `allowed`, non-reference-only source, complete structure, no unresolved media and no blocking semantic issue. Even then it is only a **candidate for human review**.

## Proof-aware embedded-font recovery

`scripts/recover-fuvest-font-map.py` reduces semantic exceptions only when the PDF/font itself proves the replacement. It does **not** implement global substitutions such as `U+0003 -> space`.

Two proof paths are supported:

1. Type0 / Identity-H / CIDFontType2: CID → GID → embedded TrueType glyph → exactly one portable Unicode code point in the font's own cmap.
2. Type0 / Identity-H / Adobe-Identity CFF: exact CID → embedded CFF charstring with **zero drawing commands** and **positive advance width** → whitespace (`U+0020`).

If any proof step is missing or ambiguous, the character is left untouched and remains review/fallback-gated. Type3 fonts without sufficient mapping evidence are never guessed.

The first real CFF proof was FUVEST 2014–2015. CID 3 in the relevant embedded Calibri/Cambria subsets is a blank advancing glyph. The worker proved and normalized **25,129 occurrences** across those two editions while both exams continued to close at 90/90 question identities.

The batch runner applies a proven font repair only if the parser still closes structurally. A parser regression automatically restores the untouched native text layer before any further fallback.

## Media extraction and association

`scripts/extract-fuvest-media.py` consumes a SHA-bound extraction envelope and produces `enemlab-media/v1`.

```bash
npm run ingest:fuvest:media -- \
  --extraction /tmp/fuvest-2025.json \
  --media-dir /tmp/fuvest-2025-media \
  --manifest-output /tmp/fuvest-2025-media.json \
  --metrics
```

The extractor uses PDF geometry by default. Raster images and vector drawings become candidate rectangles; nearby fragments are clustered; a visual is auto-associated only when it lies inside one unambiguous question region. Ambiguous candidates remain review items. Each crop retains SHA-256, page and bounding box provenance.

Crucially, **media detected is not media resolved**. A geometric association does not by itself prove that every visual dependency of a question was recovered.

## Checkpoints and persistent batch cache

There are two cache layers:

1. `withExtractionCheckpointCache()` caches `ExtractedExamData` by provider/source/job + importer version + exact document SHA-256 values.
2. `scripts/fuvest-batch-lab.py` persists extraction and media envelopes on disk for historical backfills.

A cache hit never bypasses validation. If source bytes or any parser/recovery version changes, the relevant extraction key changes and old output is not reused.

The FUVEST batch cache now includes the proof-aware font-recovery worker version as part of the extraction key. This prevents a pre-font-repair checkpoint from masking a newer deterministic recovery rule.

## Full 21-edition text/semantic benchmark — 2026-09-10

A temporary GitHub Actions benchmark ran the current integrated pipeline against every FUVEST edition with a canonical exam PDF: **21 editions / 1,910 questions**. The run used `--no-media` so these numbers measure extraction, structural closure and semantic pressure; media cropping/association was intentionally not recomputed in this pass. The temporary workflow was removed after capture.

| Metric | Result |
|---|---:|
| Editions processed | **21/21** |
| Failures | **0** |
| Questions extracted | **1,910** |
| Structurally complete | **1,722 (90.2%)** |
| Needs text/structure review | **188 (9.8%)** |
| Questions flagged missing media | **456 (23.9%)** |
| Questions with blocking semantic finding | **783 (41.0%)** |
| Editions requiring raster-boundary recovery | **1** |
| Editions where font-map was attempted | **16** |
| Editions where a proven font-map was applied | **7** |
| Suspicious glyph occurrences proven/repaired | **25,303** |
| Suspicious glyph occurrences still unresolved | **41,692** |

Operational pressure per 1,000 questions:

- semantic-fidelity blocks: **409.9 / 1,000**;
- text/structure review: **98.4 / 1,000**;
- missing-media flags: **238.7 / 1,000**.

The font worker reduced the measured suspicious-glyph occurrence pool from 66,995 to 41,692: **25,303 occurrences removed with source-level proof (~37.8%)**. This is an occurrence reduction, not a claim that 37.8% of questions became publishable.

### Current hotspots

| Edition | Structure | Semantic blocks | Text review | Unresolved suspicious glyphs | Route |
|---|---:|---:|---:|---:|---|
| 2021 | **0/90** | **90/90** | **90/90** | **37,134** | regional OCR / alternate extraction |
| 2016 | 72/90 | 88/90 | 18/90 | 802 | regional OCR / layout recovery |
| 2017 | 78/90 | 90/90 | 12/90 | 1,565 | regional OCR / layout recovery |
| 2018 | 84/90 | 90/90 | 6/90 | 1,677 | boundary recovery done; semantic regions next |
| 2019 | 82/90 | 90/90 | 8/90 | 45 | targeted semantic/layout repair |
| 2020 | 85/90 | 90/90 | 5/90 | 34 | targeted semantic/layout repair |
| 2012 | 88/90 | 90/90 | 2/90 | 88 | targeted semantic repair |

FUVEST 2021 is the dominant remaining source of raw glyph corruption: its 37,134 unresolved occurrences represent almost 89% of the unresolved suspicious-glyph pool. The PDF does not provide enough embedded-font/ToUnicode evidence for safe deterministic replacement, so weakening the semantic gate would be incorrect. The next specialized worker should operate on selected rendered regions/pages while retaining native text wherever it is trustworthy.

## Full batch command

```bash
npm run ingest:fuvest:batch
npm run ingest:fuvest:batch -- --years 2005,2010,2018,2025 --concurrency 4
```

The runner defaults to all currently eligible FUVEST editions, supports concurrency 1–8 and can write JSON metrics. Structural, media and semantic readiness remain independently reported.

## Scale interpretation

```text
1,910 historical questions
       ↓
1,722 structurally complete without per-year hand coding
       ↓
font proof removes cheap deterministic corruption
       ↓
media + semantic gates expose the exception set
       ↓
regional OCR / vision / human review only where required
```

The engine now demonstrates the core property needed for large question-bank growth: **adding volume is a batch-data operation, not a new coding project for every exam edition**.

The next optimization targets are:

1. FUVEST 2021 regional structural/semantic recovery;
2. FUVEST 2016–2020 targeted semantic/layout recovery;
3. precise proof that all required visual content for a question has been recovered;
4. persistent review decisions so accepted corrections are never reviewed twice;
5. conditional HTTP/document caching to reduce repeated download cost;
6. repeat the adapter pattern for the next institution.

## AI / vision policy

AI is fallback, not source of truth. A model may help recover damaged formulas, ambiguous layout or visual relationships, but its output remains untrusted input and must retain exact document provenance.

Preferred cost order:

```text
native PDF text/geometry
       ↓
proof-aware deterministic recovery
       ↓
local OCR / vision for selected exceptions
       ↓
hosted LLM/vision only for unresolved cases
       ↓
human review where confidence remains insufficient
```

This keeps volume cheap while preserving a fail-closed publication boundary.
