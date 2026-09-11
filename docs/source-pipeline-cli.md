# Source pipeline CLI

The generic source pipeline persists discovery/acquisition/extraction state under `.ingestion-cache/` so repeated runs do not redownload or re-extract unchanged official PDFs.

## Run

```sh
npm run ingest:source -- --list
npm run ingest:source -- --source ufpr
```

Optional flags:

```sh
npm run ingest:source -- --source ufpr --concurrency 2
npm run ingest:source -- --source ufpr --cache-dir D:/enemlab-cache
npm run ingest:source -- --source ufpr --report .cache/ufpr-report.json
```

The default cache layout is:

```text
.ingestion-cache/source-pipeline/
├── blobs/
│   └── sha256/ab/<sha256>.bin
└── sources/<source-id>/
    ├── inventory.json
    ├── checkpoints/
    └── last-run.json
```

Physical bytes are addressed only by SHA-256. Warm runs use conditional GET when the official server exposes ETag/Last-Modified; HTTP 304 reuses the local blob. Servers without validators are downloaded and compared by SHA, preserving fail-closed change detection.

Extraction checkpoints are persistent too. A matching physical document SHA plus importer version skips deterministic extraction on a warm run.

## UFPR benchmark

`ufpr` now runs in `ingestion` mode for the verified PS2016–PS2026 first-phase window.

The adapter has an explicit expected objective count per edition:

- PS2016–PS2018: 80;
- PS2019–PS2020: 90;
- PS2021–PS2022: 60;
- PS2023–PS2026: 90.

The first deterministic benchmark uses English as the canonical foreign-language variant. Shared booklets can repeat the same language-question numbers several times; the extractor selects the English occurrence instead of treating those blocks as duplicate questions. PS2021 publishes a separate first-phase booklet per language, so the adapter acquires only its English definitive booklet for ingestion.

The Python extractor receives already-acquired bytes through stdin. It does not download URLs itself. It verifies the supplied SHA-256 before parsing and returns `enemlab-extraction/v1` bound to that exact physical PDF.

It fails closed when it cannot recover:

- every expected question number;
- exactly alternatives A–E for a non-annulled question;
- one marked correct alternative for every non-annulled question;
- an unambiguous requested language occurrence when a number repeats.

Starred questions and explicit global annulment notes are recorded as annulled instead of requiring an answer. Visual references are marked as missing media for later review; OCR/vision is intentionally not part of this first benchmark.

`rightsStatus` stays `official-reference`: extracting official PDFs for this personal study pipeline does not make a claim that UFPR content may be redistributed.

The extractor requires Python with `pypdf`, consistent with the repository's existing PDF ingestion scripts.

## Reports

Every run writes a compact JSON report instead of serializing full question bodies. It includes:

- cold/warm/mixed cache state;
- editions and logical documents discovered;
- unique document URLs;
- network and conditional request counts;
- HTTP 304 count;
- downloaded document/byte totals;
- changed-document count;
- acquisition failures;
- extraction checkpoint hits/misses;
- ready/blocked job counts;
- questions extracted and questions needing fallback;
- compact validation/engine issue summaries.

This makes the horizontal scaling target measurable: a warm unchanged source should converge toward metadata requests plus checkpoint hits, while parser failures become explicit exception classes rather than manual per-exam ingestion.
