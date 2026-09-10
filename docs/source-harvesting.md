# Generic source harvesting

This layer sits before extraction.

```text
official archive page
      ↓
source recipe
      ↓
HTML link harvesting
      ↓
host allowlist + year/role matching
      ↓
document inventory
      ↓
existing ingestion engine
```

The goal is to amortize institution-specific work across many editions. A new institution should preferably need one small declarative recipe instead of one importer per year.

## Recipe

```ts
const recipe: OfficialSourceRecipe = {
  sourceId: "example-official",
  institution: "EXAMPLE",
  archiveUrls: ["https://example.edu/vestibular/provas-antigas"],
  allowedHosts: ["example.edu"],
  minYear: 2005,
  edition: {
    year: /(?:^|\D)(20\d{2})(?:\D|$)/,
  },
  documents: [
    { role: "answer-key", match: /gabarito/i, phase: "first" },
    { role: "objective-exam", match: /prova|caderno/i, phase: "first" },
  ],
};
```

Recipes contain only source knowledge:

- official archive entry pages;
- allowed official/static hosts;
- edition/year extraction;
- document role patterns;
- optional phase/subject/variant metadata;
- optional year bounds and candidate filtering.

They do not parse PDFs and do not change publication authority.

## Document inventory

`DocumentInventory` is intentionally independent from extraction checkpoints.

It records a durable union of documents seen across runs, including:

- institution/source;
- edition/year;
- document role, phase, subject and variant;
- canonical URL;
- first/last discovery time and sightings;
- fetch attempts;
- SHA-256, size, ETag and Last-Modified after acquisition;
- last fetch error.

A transient archive failure does not remove older records. Discovery knowledge should become stale when a source is unavailable, not disappear.

The shared code exposes a JSON-backed storage adapter without importing Node `fs`, so CLIs can persist to JSON/SQLite/object storage while browser callers can use IndexedDB.

## Trust boundary

The harvester only creates `DiscoveredEdition`/`DiscoveredDocument` candidates.

It does not:

- publish questions;
- trust aggregators as content authority;
- infer answers;
- use LLMs to guess document roles;
- crawl outside recipe allowlists;
- bypass the current ingestion/review/rights gates.

The existing ingestion engine remains responsible for download fingerprints, extraction, semantic/media validation and review staging.

## Next institution benchmark

Before further FUVEST-specific recovery work, add recipes for institutions with materially different archive layouts. Track:

- lines of institution-specific recipe/adapter code;
- editions discovered per recipe;
- documents discovered per minute;
- percentage entering ingestion without manual URL work;
- structural completion after generic extraction;
- exception clusters per 1,000 questions.

The target is horizontal economics: adding 10–20 years of a new institution should become a small source-configuration task plus exception reduction, not a new scraping/extraction project per edition.
