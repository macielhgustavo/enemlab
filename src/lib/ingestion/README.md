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
│          selective OCR/AI/media recovery      │
│                  ↓                            │
└──────────────> CANONICAL VALIDATOR <──────────┘
                       ↓
            BLOCKED / READY FOR REVIEW
                       ↓
                  HUMAN REVIEW
                       ↓
           EXISTING PUBLICATION GATES
```

A successful engine job is **not published**. It is only staged as `ready-for-review` and the existing reviewed/verified + rights gates remain authoritative.

## Why adapters

Every institution has different archives and PDF layouts. That variability belongs in a small `IngestionAdapter`:

1. `discovery` finds official editions.
2. `plan()` turns one edition into one or more logical objective exams (phase/day/variant).
3. `extract()` parses already-downloaded documents into the neutral `ExtractedExamData` shape.
4. optional `fallbackExtract()` receives only concrete unresolved question/page targets.

Everything else is shared infrastructure.

This means a FUVEST adapter should describe **how FUVEST works**, not contain a separate implementation for every FUVEST year.

## First slice

This implementation focuses on objective exams and already provides:

- bounded batch concurrency;
- stable logical job identity including phase and variant;
- allowlist enforcement before download;
- official document download through an injected fetcher;
- SHA-256 provenance for every fetched document;
- detection of silent upstream document changes;
- neutral extracted-question representation, including text, alternatives, media, page and confidence;
- canonical fail-closed count/number/answer-key validation;
- duplicate logical-job blocking;
- separation between native-content candidates and reference-only data;
- semantic-fidelity findings and native-candidacy gating;
- exception-driven fallback requests by question/page;
- review queue generation;
- run-level throughput, extraction, semantic-fidelity and fallback metrics;
- a versioned success protocol (`enemlab-extraction/v1`);
- a versioned SHA-bound failure/recovery protocol (`enemlab-extraction-failure/v1`).

## FUVEST laboratory

FUVEST is the first high-volume benchmark because the reviewed manifest already contains 22 continuous editions (2005-2026), totaling 2,000 objective references.

Two adapters intentionally coexist:

- `createFuvestManifestAdapter()` proves that all 22 reviewed editions can cross the generic engine as reference data;
- `createFuvestExternalAdapter()` is the question-text laboratory and only accepts editions with a canonical official exam PDF.

The current reviewed manifest has no canonical `examUrl` for FUVEST 2022. That edition remains valid as reference-only data, but is excluded from text extraction. Therefore the current extraction laboratory covers 21 editions / 1,910 objective questions.

### Deterministic extractor

`scripts/extract-fuvest-questions.py` reads one official first-phase booklet and emits `enemlab-extraction/v1` when deterministic extraction succeeds.

```bash
npm run ingest:fuvest:questions -- --year 2025 --metrics
npm run ingest:fuvest:questions -- --year 2010 --output /tmp/fuvest-2010.json --metrics
python scripts/extract-fuvest-questions.py --year 2018 --failure-output /tmp/fuvest-2018.failure.json
```

The extractor deliberately does less rather than inventing structure:

- question boundaries must be sequential and complete;
- legacy `a)`, modern `(A)` and modern `{01}` question-marker layouts are supported;
- alternatives only become structured when A-E are all recovered in order;
- incomplete alternative recovery stays staged for review;
- known separators such as `#####` do not contaminate alternative E;
- `Note e adote:` is preserved as question context instead of being appended to an alternative;
- references to figures, graphs, maps, images and similar media are flagged in `questionsMissingMedia`;
- the downloaded answer-key SHA-256 must still equal the reviewed manifest fingerprint;
- Unicode text cleanup uses NFC, not NFKC, so meaningful typography such as `²` is not silently rewritten as `2`;
- control/replacement/private-use glyph corruption is recorded before cleanup can hide it;
- no extraction result publishes itself.

The output is then consumed through the external protocol. Provider/source/edition/year/phase, document set and every SHA-256 must match the documents fetched by the engine. A stale or misrouted extractor response is rejected.

### Real benchmark — 2026-09-09 (America/Sao_Paulo)

A temporary GitHub Actions laboratory downloaded the official documents and ran the deterministic parser against four generations of FUVEST layout. The temporary network-dependent job was removed after collecting the measurements.

| Edition | Questions | Structurally complete | Structurally complete without missing media | Missing media | Needs text review | Approx. parser time | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| 2025 | 90 | 88 | 60 | 29 | 2 | 12 s | passed |
| 2018 | 90 | — | — | — | — | 6 s | blocked |
| 2010 | 90 | 87 | 75 | 13 | 3 | 4 s | passed |
| 2005 | 100 | 97 | 76 | 23 | 3 | 4 s | passed |

FUVEST 2018 is the useful failure. The PDF text layer preserved enough content to detect **85 complete A-E sequences**, but only **28 trustworthy numeric question boundaries**. It also emitted corrupted control-code glyphs and damaged mathematical notation. The deterministic parser therefore refuses to infer question identity from alternative groups.

The CLI can now preserve this failure as a `enemlab-extraction-failure/v1` artifact without changing the nonzero exit status. Only pages containing objective-question evidence are selected as recovery targets; cover/instruction pages are not blindly sent to recovery. The failure artifact is bound to the same exam and answer-key SHA-256 values as a successful extraction.

The table remains a **structural benchmark, not a publication or semantic-fidelity approval**. `Structurally complete without missing media` means the parser recovered a statement and the expected alternative domain and did not detect an unresolved media dependency. It does not prove that every mathematical symbol, formula, column relationship or typographic distinction survived PDF extraction.

## Semantic Fidelity Gate

A structurally valid question is not automatically semantically trustworthy. The engine now treats these as separate dimensions.

The machine-verifiable gate currently detects:

- disallowed control characters;
- Unicode replacement characters (`U+FFFD`);
- Unicode private-use glyphs without portable meaning;
- explicit extractor-reported formula/layout ambiguities;
- impossible extractor metadata such as findings for nonexistent question identities.

`semanticFidelityReadyQuestions` counts questions without a blocking semantic-fidelity finding. `questionsNeedingFallback` counts unique question identities that still have a structural, media or semantic exception.

Only an explicit semantic `warning` is non-blocking. Unknown or malformed runtime findings fail closed.

`nativeContentCandidate` now requires all of the following:

1. source rights are `allowed`;
2. source is not `reference-only`;
3. every question has the expected statement/alternative structure;
4. no question still depends on missing media;
5. every question passes the semantic-fidelity gate.

Even then, it is only a **candidate for human review**, never automatic publication.

## Selective fallback and recovery

There are two failure moments and both avoid full-exam AI by default.

### After question identities were recovered

If a primary extraction already knows question identities but some items are incomplete, media-dependent or semantically unsafe, `buildSelectiveFallbackRequest()` produces only those targets. An optional adapter `fallbackExtract()` can replace those questions.

The merge is deliberately restrictive:

- a fallback cannot introduce an unknown question number;
- a fallback cannot replace a question that was not requested;
- duplicate replacements are rejected;
- the canonical answer key is not supplied as mutable fallback output;
- unresolved media and semantic findings remain blocking;
- if fallback fails, the primary extraction is retained with a recorded failure instead of being destroyed.

### Before trustworthy question identities exist

Some PDFs, such as the FUVEST 2018 sample, lose the question-number glyphs before the normal engine can create a valid extraction. For that case the external protocol supports `enemlab-extraction-failure/v1`.

A failure envelope contains:

- exact provider/source/edition/year/phase identity;
- exact document URLs and SHA-256 values;
- the deterministic failure message;
- explicit question/page recovery targets.

`createFuvestExternalAdapter()` can receive an optional recovery loader. It only receives the verified targets from that failure envelope. The recovery worker must then return a normal, complete `enemlab-extraction/v1` payload bound again to the exact same engine-downloaded documents. Only after that does canonical validation continue.

This gives the intended route:

```text
PDF text layer
    ↓
deterministic parser
    ├── success ──> semantic/media gate ──> selective item fallback when needed
    │
    └── structural failure
             ↓
    SHA-bound failure envelope
             ↓
    OCR/AI only on declared pages
             ↓
    complete SHA-bound extraction envelope
             ↓
    canonical validator
```

No OCR vendor or LLM provider is hardcoded in the engine. The protocol is the trust boundary; OCR/AI remains an interchangeable worker.

## Extraction coverage metrics

The engine separates metrics that used to be easy to conflate:

- `questionsExtracted`: question identities that crossed extraction;
- `structurallyCompleteQuestions`: statement plus the exact expected alternative domain recovered;
- `contentReadyQuestions`: structurally complete and not still dependent on missing media; despite the historical field name, this is a structural/media metric only;
- `semanticFidelityReadyQuestions`: no blocking semantic-fidelity finding;
- `questionsNeedingFallback`: unique unresolved structural/media/semantic question identities;
- `questionsMissingMedia`;
- `fallbackAttempts`;
- `fallbackReplacements`.

These metrics are independent of redistribution rights. A FUVEST question can benchmark well while still remaining `official-reference` and therefore not being a native publication candidate.

## AI extraction

AI is a fallback, not the source of truth. A model may recover question boundaries, statements, alternatives, media relationships or damaged formulas, but its output remains untrusted input. Model confidence never becomes `reviewed` or `verified`, and document identity remains cryptographically bound by SHA-256.

This is cheaper and easier to audit than sending every full exam to a model.

## Scale metrics

The useful product metric is not just total questions. Track at least:

- editions discovered;
- jobs planned;
- documents fetched;
- questions extracted;
- structurally complete questions;
- structurally complete questions without missing media;
- semantic-fidelity-ready questions;
- questions needing fallback;
- fallback attempts/replacements;
- percentage ready for review;
- percentage blocked;
- review workload per 1,000 questions;
- average processing time per exam;
- extraction errors by adapter/version.

A healthy future target looks like:

```text
10,000 discovered questions
        ↓
structurally valid deterministic subset
        ↓
semantic-fidelity + media checks
        ↓
OCR/AI only for unresolved segments
        ↓
small review queue
        ↓
reviewed publication when rights allow
```

The exact automation percentage must come from real runs rather than a hard-coded promise.

## Deliberate non-goals of this slice

Still outside this PR:

- an actual OCR/LLM recovery provider;
- automatic visual-object cropping and question-to-image association;
- persistent checkpoints/review storage;
- automatic publication;
- changing redistribution rights based on extraction success.

## Next implementation steps

1. Plug an actual OCR/vision worker into the already-defined recovery loader and run it on FUVEST 2018 failure targets.
2. Add page/image association so visual questions stop at a precise media-review boundary.
3. Persist fingerprints/checkpoints so unchanged documents are skipped.
4. Store staged review artifacts and reviewer decisions.
5. Run the full 21-edition FUVEST extraction laboratory and measure semantic/fallback workload per 1,000 questions.
6. Repeat the adapter pattern for other institutions and compare throughput per 1,000 questions.
