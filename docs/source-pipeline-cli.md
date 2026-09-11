# Source pipeline CLI

The generic source pipeline persists discovery/acquisition state under `.ingestion-cache/` so repeated runs do not redownload unchanged official PDFs.

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

Physical bytes are addressed only by SHA-256, so two URLs serving the same file share one blob. Replacing a PDF at the same URL creates a new blob instead of destroying the old bytes.

The inventory stores the URL-to-SHA relationship plus ETag/Last-Modified metadata. Warm runs use conditional GET when possible. HTTP 304 reuses the local blob and downloads no PDF body. Servers without validators are downloaded again and compared by SHA, preserving the fail-closed behavior.

Extraction checkpoints are also persistent. Once a source has an `IngestionAdapter`, the runner automatically executes `IngestionEngine` with the recipe-based discovery bridge and the persistent checkpoint store. A matching SHA + importer version can therefore skip extraction on a warm run.

## Current registry

`ufpr` is deliberately `acquisition-only` for now. The source recipe can discover/acquire the verified PS2016–PS2026 window, but no UFPR extractor is being claimed until question/answer extraction is proven against the official PDFs.

Registering an adapter on the same source definition changes the runner to `ingestion` mode without changing the command or cache format.

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
- extraction checkpoint hits/misses when ingestion is enabled;
- compact ingestion job status/validation summaries.

This makes the scaling target measurable: warm runs should converge toward metadata requests plus only the bytes whose official source actually changed.
