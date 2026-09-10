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
conditional acquisition (ETag / Last-Modified)
      ↓
SHA-256 content-addressed blob store
      ↓
existing extraction checkpoint (SHA + importer version)
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

The effective URL returned after a fetch is checked again against `allowedHosts`, so an allowed URL that redirects to another domain is rejected before its HTML can participate in discovery.

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

The official historical index exposes two site generations in the verified benchmark window:

- modern `PortalNC/Concurso?concurso=PSYYYY` pages;
- legacy `/concursos_institucionais/ufpr/psYYYY/index.htm` pages for PS2016/PS2017.

The same recipe follows both at depth 1. It currently targets the first-phase general booklet only and intentionally ignores second-phase/discursive material.

The verified discovery window is `PS2016` through `PS2026`: 11 editions. The upper and lower bounds are explicit so neither older layouts nor a future edition silently enter the pipeline without the recipe being rechecked.

The official historical index goes further back, but older pages such as PS2011 and PS2003 use an older framed layout that the current HTML-anchor primitive does not yet resolve reliably. They remain outside this recipe rather than being claimed as supported.

Modern and the verified PS2016/PS2017 definitive first-phase booklets contain the marked correct alternatives in the booklet itself, so those URLs are represented as both `objective-exam` and `answer-key`. Preliminary modern material remains a separate `answer-key-preliminary` role.

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

## Content-addressed acquisition

`src/lib/discovery/acquisition.ts` turns an inventory entry into the `DocumentFetcher` already consumed by `IngestionEngine`.

The cache has two separate identities on purpose:

- **logical identity** stays in the inventory: source + edition + role + phase + variant + URL;
- **physical identity** is only the SHA-256 of the bytes.

That means two roles or even two official URLs serving byte-identical PDFs can share the same physical blob without losing provenance.

### Revalidation path

When an inventory record already has cached bytes:

1. if the server supplied `ETag`, acquisition sends `If-None-Match`;
2. if it supplied `Last-Modified`, acquisition also sends `If-Modified-Since`;
3. HTTP `304 Not Modified` returns the local SHA-addressed bytes to the ingestion engine and downloads zero PDF bytes;
4. HTTP `200` hashes the returned body and compares it with the previous SHA;
5. a new SHA is retained as a new blob instead of overwriting the old evidence.

If metadata exists but the corresponding SHA blob is missing, acquisition deliberately performs a full GET. Sending validators in that case could produce a `304` with no local body to use.

If the server exposes neither ETag nor Last-Modified, the fail-safe path is a full body download followed by SHA comparison. Size or timestamp alone is never treated as proof that a PDF is unchanged.

Within one run, repeated logical requests for the same URL are coalesced. This matters for multi-role documents such as UFPR definitive booklets: extraction may see separate logical definitions while the network performs only one physical fetch.

Acquisition also re-checks the effective redirect URL against the source allowlist. Redirecting a known official URL to an unapproved host fails closed.

### Discovery/engine bridge

`openRecipeAcquisitionBridge()` connects the recipe, inventory and acquisition layers without changing `IngestionEngine.run()`.

The engine historically receives one `DocumentFetcher` for both archive discovery and document downloads. The bridge preserves that contract:

```text
archive/index URL not in inventory
        → plain allowlisted fetch
        → recipe discovers documents
        → documents are inserted into inventory
        → subsequent PDF fetch
        → conditional/SHA acquisition
```

A source adapter can therefore use `bridge.discovery` as its `discovery` implementation and pass `bridge.fetcher` to `IngestionEngine`. Calling `bridge.persist()` after the run stores the updated SHA/ETag/Last-Modified metadata for the next process.

### Acquisition metrics

Each acquisition fetcher exposes counters for:

- logical requests and coalesced duplicates;
- physical network requests;
- conditional requests and HTTP 304 hits;
- documents and bytes actually downloaded;
- new, changed and byte-identical redownloads;
- blob-store reads, hits, misses and writes;
- acquisition failures.

The most important steady-state metric is `downloadedBytes`: after a source is warm and its server supports validators, rerunning unchanged editions should approach zero PDF bytes downloaded. The existing extraction checkpoint then avoids reparsing because its key already includes exact document SHA plus importer version.

## Trust boundary

The harvester and acquisition layers only produce/retrieve official document candidates.

They do not:

- publish questions;
- trust aggregators as content authority;
- infer answers;
- use LLMs to guess document roles;
- crawl or follow redirects outside recipe allowlists;
- treat HTTP metadata as stronger evidence than SHA-256;
- bypass the current ingestion/review/rights gates.

The existing ingestion engine remains responsible for extraction, semantic/media validation and review staging.

## Benchmark metrics

`runSourceHarvest()` reports crawl throughput directly:

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
- hosted-AI calls and cost per 1,000 questions;
- downloaded PDF bytes on cold and warm runs;
- conditional-request hit rate;
- extraction-checkpoint hit rate.

The target is horizontal economics: adding 10–20 years of a new institution should become a small source-configuration task plus exception reduction, not a new scraping/extraction project per edition.
