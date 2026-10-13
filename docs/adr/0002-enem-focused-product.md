# ADR 0002 — ENEM-focused product and preserved acquisition engine

Status: accepted direction; migration not implemented.

## Context

Studium and ENEMLab are currently one repository. The application registers 17 exam providers, while Python acquisition/extraction tooling and Native Fleet share that tree. This obscures the primary product journey and maintenance boundaries.

ADR 0001 remains authoritative for stored identifiers and the Studium application name. This decision narrows the intended product scope; it does not rename storage or imply that unsupported editions are available.

## Decision

The product's primary journey will be **ENEM practice → correction → error review → progress**.

Keep acquisition, provenance, and validation as a distinct engineering concern. Preserve other provider adapters as pipeline capabilities and compatibility readers until data migration is proven.

Do not create two portfolio entries claiming independent projects while application and pipeline still share one implementation.

## Migration order

1. Record the pre-migration commit and preserve all provider-scoped persisted history.
2. Define an ENEM-only product entry point. Keep legacy histories readable/exportable; never silently reinterpret them as ENEM.
3. Reduce navigation around practice, correction, review, and progress. Move data administration out of the primary student journey.
4. Introduce an explicit pipeline boundary for discovery, acquisition, extraction, and enrichment.
5. Remove unused runtime imports/assets only after usage and build analysis. Store generated corpus outside the source repository.
6. Consider a new lean application repository only if it materially simplifies onboarding and maintenance. Preserve original history and attribution.

## Acceptance checks

- Fresh users complete a real ENEM practice/correction/review journey.
- Existing non-ENEM histories survive migration and remain identifiable.
- Question keys, source hashes, edition/phase identity, and publication gates remain stable.
- Application build/tests and extraction canaries pass.
- Dependency and artifact-size reductions are measured before being claimed.

## Consequences

The app has one clear primary domain. Pipeline work can still support multiple examinations without putting every integration into product navigation.

The migration requires cross-layer changes and browser acceptance checks. Hiding a selector or deleting adapters would not satisfy this decision.
