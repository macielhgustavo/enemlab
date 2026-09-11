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
- independent heavy-OCR concurrency budget so Tesseract/PyMuPDF cannot oversubscribe the batch worker pool;
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

## Regional content recovery: FUVEST 2016, 2017 and 2021

`scripts/recover-fuvest-region-ocr.py` handles editions whose trustworthy question identities survive but whose body text is structurally incomplete or heavily corrupted. Support is deliberately profile-gated per measured layout; a new year does not enter this fallback merely because it looks similar.

The worker treats official geometric labels as immutable anchors and OCRs only the rendered region belonging to unresolved questions. It does not derive question numbers from OCR and never touches the canonical answer key.

The worker is fail-closed:

- geometry must close exactly at the reviewed sequence 1..N;
- label font and positional bands must match the explicit profile for that edition;
- only structurally incomplete questions are targeted;
- a question is replaced only when OCR recovers a non-empty statement plus exactly A–E in order;
- OCR modes are attempted adaptively only while a region remains unresolved;
- unresolved regions keep their previous blocked representation;
- every OCR-applied question remains semantic-review-gated;
- missing Tesseract/PyMuPDF is reported as worker unavailability rather than cached as a successful recovery.

Measured structural recovery after the bounded continuation and strict-label stages:

| Edition | Before | After regional OCR | Targeted | Regional applied | Regional unresolved |
|---|---:|---:|---:|---:|---:|
| 2016 | 72/90 | **87/90** | 18 | 15 | 3 |
| 2017 | 78/90 | **87/90** | 12 | 9 | 3 |
| 2021 | 0/90 | **87/90** | 90 | 87 | 3 |

The remaining nine regions are questions whose alternatives are predominantly graphical. `scripts/recover-fuvest-visual-alternatives.py` handles that class after regional OCR. It requires unambiguous A–E marker geometry, supports proven one-row and 3+2 grid layouts, and represents each alternative as an independently hashed image crop. It never infers answer content or the answer key. These crops remain in `questionsMissingMedia`, and every touched question keeps an `extractor-reported` semantic error until review.

| Edition | Visual targets | Visual applied | Final structure |
|---|---:|---:|---:|
| 2016 | 3 | 3 | **90/90** |
| 2017 | 3 | 3 | **90/90** |
| 2021 | 3 | 3 | **90/90** |

The combined recovery therefore closes **120/120 targeted questions**, with 111 recovered as text and 9 represented by 45 provenance-bound visual alternative crops. FUVEST 2021 preserves all 90 question identities but its native body text contains **37,134 suspicious control-code occurrences**; recovery does not rewrite that native layer or declare it semantically trustworthy.

The isolated 2021 benchmark recorded a cold extraction checkpoint of **122.1 s** and a warm checkpoint hit of **8.34 s**, with identical extraction output.

The improvement is structural recovery, not semantic approval. All OCR-touched content remains review-gated.

## OCR concurrency budget

The batch runner separates cheap pipeline parallelism from expensive OCR parallelism:

```bash
python scripts/fuvest-batch-lab.py \
  --concurrency 4 \
  --ocr-concurrency 1 \
  --no-media
```

`--concurrency` controls edition-level download/parsing work. `--ocr-concurrency` controls both raster-boundary recovery and regional Tesseract/PyMuPDF fallback through a shared bounded semaphore. Both accept 1–8, but the default OCR budget is **1** because the measured workers are CPU/memory-heavy.

This fixes a real oversubscription failure mode. Before the separate budget, running 2016 and 2017 concurrently inside the same process exceeded **19 minutes** and hit the benchmark timeout even though each edition completed quickly in isolation. With `pipelineConcurrency=2` and `ocrConcurrency=1`, the same pair completed in **60 s** with identical structural output: **173/180 complete, 23/30 targeted questions recovered, 7 unresolved**.

The full 21-edition benchmark with `pipelineConcurrency=4` and `ocrConcurrency=1` completed in **235 s (~3m55s)**.

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

The FUVEST batch cache includes the question extractor, proof-aware font recovery, raster-boundary recovery, regional-OCR and visual-alternative worker versions in the extraction key. A cached visual recovery is accepted only when every referenced asset still exists and matches its recorded SHA-256. This prevents an older or incomplete checkpoint from masking a newer recovery rule.

## Full 21-edition text/semantic benchmark — 2026-09-10

A temporary GitHub Actions benchmark ran the current integrated pipeline against every FUVEST edition with a canonical exam PDF: **21 editions / 1,910 questions**. The run used `--no-media` so these numbers measure extraction, structural closure and semantic pressure; media cropping/association was intentionally not recomputed in this pass. The temporary workflow was removed after capture.

The final benchmark used `pipelineConcurrency=4` and the independent `ocrConcurrency=1` budget. Its GitHub Actions benchmark step completed in **3m56s**.

| Metric | Result |
|---|---:|
| Editions processed | **21/21** |
| Failures | **0** |
| Questions extracted | **1,910** |
| Structurally complete | **1,842 (96.4%)** |
| Needs text/structure review | **68 (3.6%)** |
| Questions flagged missing media | **484 (25.3%)** |
| Questions with blocking semantic finding | **783 (41.0%)** |
| Editions requiring recovery | **4** |
| Editions with regional OCR attempted/applied | **3 / 3** |
| Regional OCR questions applied | **111/120 targeted** |
| Regional OCR unresolved questions | **9/120 targeted** |
| Visual-alternative questions applied | **9/9 targeted** |
| Visual-alternative assets | **45** |
| Combined structural recovery | **120/120 targeted; 0 unresolved** |
| Editions where font-map was attempted | **16** |
| Editions where a proven font-map was applied | **7** |
| Suspicious glyph occurrences proven/repaired | **25,303** |
| Suspicious glyph occurrences still unresolved | **41,692** |
| Full cold batch benchmark step | **3m56s** |

Operational pressure per 1,000 questions:

- semantic-fidelity blocks: **409.9 / 1,000**;
- text/structure review: **35.6 / 1,000**;
- missing-media flags: **253.4 / 1,000**.

Compared with the benchmark before regional OCR work:

- structure: **1,722 → 1,802 → 1,825 → 1,842**;
- text/structure review: **188 → 108 → 85 → 68**;
- semantic blocks: **783 → 783 → 783**.

That is the intended behavior: structural recovery reduces manual exception volume without weakening the independent semantic gate.

The font worker reduced the measured suspicious-glyph occurrence pool from 66,995 to 41,692: **25,303 occurrences removed with source-level proof (~37.8%)**. This is an occurrence reduction, not a claim that 37.8% of questions became publishable.

### Current hotspots

| Edition | Structure | Semantic blocks | Text review | Unresolved suspicious glyphs | Route |
|---|---:|---:|---:|---:|---|
| 2019 | 82/90 | 90/90 | 8/90 | 45 | targeted semantic/layout repair |
| 2018 | 84/90 | 90/90 | 6/90 | 1,677 | boundary recovery done; semantic regions next |
| 2006 | 94/100 | 0/100 | 6/100 | 0 | deterministic structural parser improvement |
| 2020 | 85/90 | 90/90 | 5/90 | 34 | targeted semantic/layout repair |
| 2012 | 88/90 | 90/90 | 2/90 | 88 | targeted semantic repair |
| 2016 | **90/90** | 88/90 | **0/90** | 802 | structural recovery closed; semantic review |
| 2017 | **90/90** | 90/90 | **0/90** | 1,565 | structural recovery closed; semantic review |
| 2021 | **90/90** | **90/90** | **0/90** | **37,134** | structural recovery closed; semantic review |

The reusable regional and visual rules close the original 120-question recovery queue without question-number conditionals. The next structural targets are edition-level parser/layout clusters such as 2019/2018/2006. Semantic recovery remains a separate problem: all **783** blocking questions are intentionally unchanged by these structural gains and should be reduced by root-cause clusters through the Exception Reducer.

## Full batch command

```bash
npm run ingest:fuvest:batch
npm run ingest:fuvest:batch -- \
  --years 2005,2010,2018,2025 \
  --concurrency 4 \
  --ocr-concurrency 1
```

The runner defaults to all currently eligible FUVEST editions. Edition-level pipeline concurrency and heavy-OCR concurrency are independently bounded from 1–8; OCR defaults to 1. The runner can write JSON metrics, and structural, media and semantic readiness remain independently reported.

## Scale interpretation

```text
1,910 historical questions
       ↓
1,825 structurally complete without per-year hand coding
       ↓
font proof removes cheap deterministic corruption
       ↓
regional OCR handles only measured structural exceptions
       ↓
media + semantic gates expose the remaining exception set
       ↓
vision / human review only where required
```

The engine now demonstrates the core property needed for large question-bank growth: **adding volume is a batch-data operation, not a new coding project for every exam edition**.

The next optimization targets are:

1. resolve the 17 regional-OCR exceptions left across 2016, 2017 and 2021, prioritizing the 10 in 2021;
2. targeted semantic recovery for the large 2016–2021 semantic clusters without weakening provenance;
3. improve deterministic structure for small no-semantic-corruption clusters such as 2006;
4. precise proof that all required visual content for a question has been recovered;
5. persistent review decisions so accepted corrections are never reviewed twice;
6. conditional HTTP/document caching to reduce repeated download cost;
7. repeat the adapter pattern for the next institution.

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
