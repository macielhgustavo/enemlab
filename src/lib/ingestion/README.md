# ENEMLab Ingestion Engine

The ingestion engine exists to make question-bank growth a throughput problem instead of a hand-coding problem.

The target is not "support one more exam". The target is to ingest thousands of official exam documents through a repeatable pipeline without writing code for each edition.

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
PRIMARY EXTRACTOR
      ↓
STRUCTURE + SEMANTIC FIDELITY + MEDIA CHECKS
      ↓
┌──────────────────┬────────────────────────────┐
│                  │                            │
clean         targeted exception                │
│                  ↓                            │
│          selective recovery / media review    │
│                  ↓                            │
└──────────────> CANONICAL VALIDATOR <──────────┘
                       ↓
            BLOCKED / READY FOR REVIEW
                       ↓
                  HUMAN REVIEW
                       ↓
           EXISTING PUBLICATION GATES
```

A successful engine job is **not published**. It is only staged for review and the existing reviewed/verified + rights gates remain authoritative.

## Why adapters

Every institution has different archives and PDF layouts. That variability belongs in a small `IngestionAdapter`:

1. `discovery` finds official editions;
2. `plan()` turns one edition into logical exams (phase/day/variant);
3. `extract()` converts already-downloaded documents into neutral `ExtractedExamData`;
4. optional `fallbackExtract()` receives only concrete unresolved question/page targets.

Everything else is shared infrastructure. A FUVEST adapter describes **how FUVEST works**, not a separate implementation for every year.

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
- extraction checkpoints keyed by document SHA + importer version.

## FUVEST laboratory

FUVEST is the first high-volume benchmark because the reviewed manifest contains 22 editions from 2005–2026, totaling 2,000 objective references.

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

### Earlier layout benchmark

| Edition | Questions | Structurally complete | Missing media | Text review | Result |
|---|---:|---:|---:|---:|---|
| 2025 | 90 | 88 | 29 | 2 | passed |
| 2018 | 90 | 84 after recovery | 19 | 6 | recovered |
| 2010 | 90 | 87 | 13 | 3 | passed |
| 2005 | 100 | 97 | 23 | 3 | passed |

## Raster-boundary recovery: FUVEST 2018

FUVEST 2018 preserves much of the body text but rasterizes question-number labels. The primary text parser found only 28/90 trustworthy numeric boundaries despite 85 complete A–E sequences.

`scripts/recover-fuvest-ocr.py` now:

- verifies the SHA-bound failure envelope;
- renders only recovery-target pages;
- masks glyphs already represented by the native text layer;
- detects raster labels by stable geometry/density;
- requires exactly the reviewed question count before assigning structural sequence 1..N;
- reconstructs the body from native PDF text rather than OCRing the whole exam;
- never derives or changes the answer key;
- keeps recovered content semantic-review-gated.

Real result:

- **90/90 boundaries recovered**;
- **84/90 structurally complete**;
- **6/90 text/structure review**;
- **19/90 media pending**;
- **26 pages selectively reconstructed**;
- all 90 remain semantic-review-gated;
- **0 hosted OCR/LLM API calls** for boundary recovery.

## Semantic Fidelity Gate

Structure is not semantic correctness. The gate detects today:

- disallowed control characters;
- `U+FFFD` replacement characters;
- Unicode private-use glyphs;
- extractor-reported formula/layout ambiguity;
- impossible metadata such as an issue targeting a nonexistent question.

`nativeContentCandidate` requires rights `allowed`, non-reference-only source, complete structure, no unresolved media and no blocking semantic issue. Even then it is only a **candidate for human review**.

## Media extraction and association

`scripts/extract-fuvest-media.py` consumes a SHA-bound extraction envelope and produces `enemlab-media/v1`.

```bash
npm run ingest:fuvest:media -- \
  --extraction /tmp/fuvest-2025.json \
  --media-dir /tmp/fuvest-2025-media \
  --manifest-output /tmp/fuvest-2025-media.json \
  --metrics
```

The extractor uses PDF geometry instead of screenshot OCR by default:

- raster images and vector drawings become candidate rectangles;
- nearby fragments are clustered into one visual object;
- question starts are located against the native text layer;
- a visual is auto-associated only when it lies inside one unambiguous question region;
- continuation-page or ambiguous candidates go to review;
- each crop gets its own SHA-256, page and bounding box;
- generated media remains a staging artifact, not publication content.

The TypeScript association layer checks **provider + source + edition + document URL + document SHA-256** before attaching anything. Low-confidence candidates are never attached automatically.

Crucially, **media detected is not media resolved**. `questionsMissingMedia` is only cleared after an explicit `resolvesMissingMedia=true` assertion for an attached asset. The current FUVEST geometry extractor intentionally emits that flag as `false`; its first job is reliable discovery/association, not pretending it recovered every visual dependency.

## Checkpoints and persistent batch cache

There are two cache layers:

1. `withExtractionCheckpointCache()` wraps any `IngestionAdapter` and caches `ExtractedExamData` by provider/source/job + importer version + exact document SHA-256 values.
2. `scripts/fuvest-batch-lab.py` persists extraction and media envelopes on disk for historical backfills.

A cache hit never bypasses validation. Cached data still crosses the normal engine gates.

If an official institution replaces bytes at the same URL, the SHA changes and the old checkpoint is not reused. Changing the parser/recovery/media version also invalidates the relevant checkpoint.

Cache read/write failure is treated as a performance problem rather than permission to skip validation: extraction falls back to real work.

The persistent runner intentionally re-downloads official documents to verify current bytes before reuse. Therefore warm-cache execution still pays network cost, but avoids PDF parsing, raster recovery, media geometry analysis and image recropping.

Local generated artifacts are ignored by Git:

```text
.ingestion-cache/
.ingestion-media/
```

## Full 21-edition benchmark — 2026-09-10

A temporary GitHub Actions laboratory **processed** every FUVEST edition currently eligible for extraction: **21 editions / 1,910 questions**. Here, processed means the documents produced a staged extraction result; it does not mean every question is structurally or semantically publishable. Those remain separate gates.

Aggregate cold-pass result:

| Metric | Result |
|---|---:|
| Editions processed | **21/21** |
| Questions extracted | **1,910** |
| Structurally complete | **1,722 (90.2%)** |
| Needs text/structure review | **188 (9.8%)** |
| Questions flagged missing media | **427** |
| Questions with blocking semantic finding | **1,000** |
| Editions requiring raster recovery | **1** |
| Media candidates cropped | **1,676** |
| Media candidates auto-associated | **1,053** |
| Media candidates requiring association review | **623** |
| Questions receiving at least one auto-associated visual | **562** |

`questionsMissingMedia=427` and `questionsWithAutomaticMedia=562` intentionally measure different things. The first comes from text cues saying that a question depends on visual context; the second says a geometric candidate was confidently associated. Neither number proves that the full visual dependency has been recovered, and the extractor does not automatically clear the missing-media gate.

The semantic count is intentionally conservative and shows why structural success must not be confused with publication readiness. Several historical FUVEST PDFs, especially 2012–2021, expose font/layout corruption that makes a large fraction of questions unsafe without a semantic fallback or review.

FUVEST 2021 is the main structural outlier: the runner identifies all 90 question identities but **0/90** currently satisfy the full statement + A–E structural gate. That edition is now a concrete target for a dedicated recovery strategy rather than a reason to weaken the validator.

### Cache proof

The immediate second pass returned:

- **21/21 extraction cache hits**;
- **21/21 media cache hits**;
- identical 1,910-question and 1,722-complete outputs;
- no parser/recovery/media recomputation for unchanged document bytes and extractor versions.

Network verification still occurs on the warm pass by design. A future HTTP conditional-fetch/document-byte cache can reduce that cost without trusting stale remote content.

## Full batch command

```bash
npm run ingest:fuvest:batch
npm run ingest:fuvest:batch -- --years 2005,2010,2018,2025 --concurrency 4
```

The runner defaults to all currently eligible FUVEST editions, supports concurrency 1–8, writes optional JSON metrics and returns nonzero only when an edition cannot produce a staged extraction result. Structural, media and semantic readiness remain independently reported.

## Scale interpretation

This benchmark changes the bottleneck:

```text
1,910 historical questions
       ↓
1,722 structurally complete without per-year hand coding
       ↓
media + semantic gates expose exceptions
       ↓
only the exception set receives specialized recovery / review
```

The engine now demonstrates the core property needed for Glau-scale growth: **adding volume is a batch-data operation, not a new coding project for every exam edition**.

The next optimization target is no longer basic question identity. It is reducing exception workload, especially:

1. FUVEST 2021 structural recovery;
2. semantic repair/verification for historical PDF font corruption;
3. precise proof that all required visual content for a question has been recovered;
4. persistent review decisions so accepted corrections are never reviewed twice;
5. conditional HTTP/document caching to remove repeated download cost;
6. repeat the same adapter pattern for the next institution.

## AI / vision policy

AI is fallback, not source of truth. A model may help recover damaged formulas, ambiguous layout or visual relationships, but its output remains untrusted input and must retain exact document provenance.

The preferred cost order remains:

```text
native PDF text/geometry
       ↓
deterministic recovery
       ↓
local OCR / vision for exceptions
       ↓
hosted LLM/vision only for unresolved cases
       ↓
human review where confidence remains insufficient
```

This keeps volume cheap while preserving a fail-closed publication boundary.
