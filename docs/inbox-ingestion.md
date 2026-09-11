# Local vestibular inbox

The inbox is the fast path for growing the personal question corpus from ZIPs already downloaded by the user. It deliberately bypasses web discovery while preserving deterministic SHA-bound staging.

## Usage

Put archives under the ignored root:

```text
.ingestion-inbox/
├── UNIOESTE_2009.zip
├── UNIOESTE_2010.zip
└── UNIOESTE_2021.zip
```

Then run:

```bash
npm run ingest:inbox
```

Custom files/directories can be repeated:

```bash
npm run ingest:inbox -- --input ~/vestibulares --input ~/Downloads/UNIOESTE_2021.zip
```

Outputs stay local under `.ingestion-cache/inbox/`:

```text
.ingestion-cache/inbox/
├── summary.json
├── blobs/sha256/ab/<sha>.pdf
└── unioeste/<year>/bundle.json
```

`bundle.json` contains the locally extracted question text, A–E alternatives, answer/annulment, subject, source page and exact PDF SHA. The full statements are not written into the public repository.

## Archive rules

The scanner reads ZIPs without trusting archive paths. It supports ZIP-inside-ZIP up to a bounded depth, caps expanded entry/archive sizes, deduplicates PDFs by SHA-256, and writes selected physical documents into the local content-addressed blob store.

For UNIOESTE the first profile understands three historical layouts:

- 2009–2013: one 71-question general exam; English is the canonical foreign-language variant.
- 2014–2016: 49-question first day plus 28-question second day; English is preferred on day two.
- 2018–2021: 21-question morning plus 56-question afternoon. English is preferred in the morning, with a content-verified fallback to Spanish when the archive is mislabeled.

Gabaritos marked definitive are preferred as-is. Provisional keys remain staged but emit an explicit `answer-key-status:provisional` issue. Annulled questions and changed answers such as `**B` are parsed rather than guessed.

The extractor is fail-open per question but fail-visible: a broken PDF layout does not discard the other recovered questions, and every missing identity is listed as `question-extraction-missing:<numbers>`. OCR/AI is not part of this fast path.

## Current real-corpus benchmark

The 12 supplied UNIOESTE archives covering 2009–2016 and 2018–2021 contain 894 expected objective questions. The deterministic inbox recovered 872 (97.5%) in the first pass, with no archive failures. The remaining 22 identities are explicit exception work for the later ingestion-engine refinement.

The 2015 nested archive is deduplicated by SHA. The supplied 2018 file named `MANHÃ - INGLÊS` actually contains the afternoon exam; selection is based on PDF content, so the profile rejects that label and uses the valid Spanish morning booklet instead.
