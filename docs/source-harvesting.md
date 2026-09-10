# Generic source harvesting

This layer sits before extraction.

```text
official archive page
      ↓
source recipe
      ↓
bounded HTML crawl (optional)
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
  crawl: {
    maxDepth: 1,
    maxPages: 40,
    follow: [/\/vestibular\/20\d{2}/i],
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
- optional year bounds and candidate filtering;
- optional bounded child-page traversal.

They do not parse PDFs and do not change publication authority.

### Bounded crawling

Some official archives are not a flat list of PDFs. The generic crawler can follow intermediary pages, but only when a recipe opts in.

Two independent limits are mandatory for multi-page crawling:

- `maxDepth`: at most five hops, normally one or two;
- `maxPages`: hard fetch-attempt budget, at most 500.

In addition, every child URL must:

1. stay inside `allowedHosts`;
2. match one of the recipe's explicit `follow` patterns;
3. pass `acceptPage`, when the recipe defines one.

This prevents a source recipe from silently turning into an open-site crawler.

The page that exposed a link is retained as discovery context. That matters for archives where the PDF is called only `prova.pdf` or `Geral.pdf`: the year can be inherited from a page such as `/vestibular/2025` without guessing from document contents.

### Multi-role documents

A document rule may expose more than one role for one URL:

```ts
{
  role: ["objective-exam", "answer-key"],
  match: /definitivo\/Geral\.pdf/i,
}
```

This is intentional. Some institutions publish a definitive booklet with the correct alternatives marked in the same PDF. The inventory keeps the logical roles separate while acquisition can still deduplicate the physical bytes by URL/SHA.

## First horizontal benchmark: UFPR

`src/lib/discovery/recipes/ufpr.ts` is the first real recipe built specifically to test horizontal scale rather than extend the FUVEST pipeline.

The official historical index exposes two site generations:

- modern `PortalNC/Concurso?concurso=PSYYYY` pages;
- legacy `/concursos_institucionais/ufpr/psYYYY/*.htm` pages.

The same recipe follows both at depth 1. It currently targets the first-phase general booklet only and intentionally ignores second-phase/discursive material.

The verified discovery window is `PS2003` through `PS2026`. The upper bound is explicit so a future edition does not silently enter the pipeline without the recipe being rechecked.

Modern and known legacy definitive first-phase booklets may contain the marked correct alternatives in the booklet itself, so those URLs are represented as both `objective-exam` and `answer-key`. Preliminary material remains a separate `answer-key-preliminary` role.

This changes the UFPR status only at the **discovery** layer. It does not make UFPR publishable in the question catalog yet; extraction, variant handling, semantic validation and review gates remain unchanged.

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

## Benchmark metrics

`runSourceHarvest()` now reports crawl throughput directly:

- page fetch attempts;
- pages fetched successfully;
- links seen;
- editions discovered;
- matched logical documents;
- durable inventory size;
- source issues.

For each new institution also track:

- lines of institution-specific recipe/adapter code;
- editions discovered per recipe;
- percentage entering ingestion without manual URL work;
- structural completion after generic extraction;
- exception clusters per 1,000 questions;
- hosted-AI calls and cost per 1,000 questions.

The target is horizontal economics: adding 10–20 years of a new institution should become a small source-configuration task plus exception reduction, not a new scraping/extraction project per edition.
