# Exception Reduction

The ingestion engine is fail-closed on purpose. The scalable goal is therefore not to hide exceptions or lower validation thresholds; it is to make the exception queue a **root-cause queue** instead of a per-question queue.

## Exception Reducer

`exceptionReducer.ts` converts staged ingestion failures into normalized observations, clusters equivalent failures across editions and produces a cheapest-first repair route.

Current root causes:

- `structure-incomplete`
- `media-unbound`
- `glyph-control`
- `glyph-replacement`
- `glyph-private-use`
- `formula-ambiguity`
- `layout-ambiguity`
- `extractor-reported`

The fingerprint is operational, not cryptographic. It combines provider/source/root-cause/field scope with a normalized message signature. Volatile URLs, digests and numbers are removed from that signature so the same parser failure in different questions or editions converges into one cluster.

A repair route is metadata only. It **never marks a question as correct**. The default order is:

```text
deterministic cleanup / normalization
        ↓
alternate parser / font mapping
        ↓
geometry
        ↓
local OCR
        ↓
vision
        ↓
structured LLM repair
        ↓
human review
```

Every strategy is declared with `requiresRevalidation=true`. Any actual replacement must still cross the existing selective-fallback merge restrictions and canonical semantic/media/structure gates.

## Why clustering matters

A one-question queue optimizes reviewer throughput. A root-cause queue optimizes **exception elimination**.

For example, 500 questions affected by the same broken PDF font should not create 500 independent repair decisions. They should create one cluster, one font-map/parser experiment and then a revalidation pass over all 500 affected identities.

The reducer records:

- number of observations and clusters;
- affected editions/questions/pages;
- dominant root causes;
- size of the largest cluster;
- expected batches for the first repair layer;
- whether a cluster can begin deterministically or already requires OCR/vision/human work.

`priorityScore` is only an operational ordering signal based on impact and first-step cost. It is **not confidence** and never participates in publication decisions.

## Real FUVEST root-cause benchmark — 2026-09-10

The 21-edition / 1,910-question FUVEST laboratory was clustered after extraction. The approximately one thousand semantically blocked questions were not one thousand unrelated problems: the queue collapsed into only five dominant initial signatures.

| Root cause | Affected questions before refinement |
|---|---:|
| `glyph-control` | **814** |
| `media-unbound` | **427** |
| `structure-incomplete` | **188** |
| `glyph-private-use` | **185** |
| `extractor-reported` (2018 raster recovery gate) | **90** |

Counts overlap because one question may have more than one exception class.

The largest source of avoidable review was itself an attribution problem. The primary parser detected raw control/private-use corruption per PDF page and conservatively attached that page finding to every question whose range crossed the page. That is safe, but overly broad.

## Precise semantic attribution

`scripts/refine-fuvest-semantic.py` adds an attribution-only refinement stage. It does not rewrite text and cannot increase trust.

For editions whose numeric boundaries are available deterministically, it walks the raw PDF text line by line while tracking the currently active question. `control-character`, `replacement-character` and `private-use-character` findings are then attached only to the question whose raw line actually contains the signal.

If boundaries cannot be reconstructed, refinement fails closed and the original conservative finding remains. FUVEST 2018 is intentionally left on its raster-recovery semantic gate for this reason.

Real result across the same 21-edition corpus:

| Root cause | Before | After precise attribution | Reduction |
|---|---:|---:|---:|
| `glyph-control` | 814 | **530** | **284 fewer (34.9%)** |
| `glyph-private-use` | 185 | **51** | **134 fewer (72.4%)** |
| `media-unbound` | 427 | 427 | unchanged |
| `structure-incomplete` | 188 | 188 | unchanged |
| `extractor-reported` / 2018 gate | 90 | 90 | unchanged |

This is queue reduction without content repair: 418 false-positive question assignments were removed simply by improving provenance granularity.

After refinement the dominant actionable clusters are:

1. precise line-level `glyph-control` — 445 questions in the largest normalized signature;
2. missing media — 427 questions;
3. incomplete objective structure — 188 questions;
4. FUVEST 2018 raster-recovery semantic gate — 90 questions;
5. the retained page-wide control cluster from the non-refinable 2018 case — 85 questions;
6. precise private-use glyphs — 51 questions.

## Next reduction loop

The next step is **not** to delete the remaining control/private-use characters. Their exact Unicode codepoints and source context must first be inventoried. Repeated codepoints that can be mapped back to a known PDF font/glyph deterministically can become a reusable `font-map-recovery` strategy. Heterogeneous or visually ambiguous symbols remain candidates for local OCR/vision.

For each cluster, the loop is:

```text
cluster
  ↓
inspect representative evidence
  ↓
implement cheapest safe repair
  ↓
re-run only affected identities
  ↓
independent semantic/media/structure validation
  ↓
resolved OR next repair tier
```

The important metric is therefore not “zero exceptions”. It is **human review per 1,000 questions after automatic root-cause reduction**, while keeping the same fail-closed gates.
