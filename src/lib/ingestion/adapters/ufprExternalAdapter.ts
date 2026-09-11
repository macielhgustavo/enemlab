import type { DiscoveredEdition } from "../../sources/ingestion";
import { createRecipeDiscovery } from "../../discovery/sourceRecipe";
import { UFPR_OFFICIAL_RECIPE } from "../../discovery/recipes/ufpr";
import { consumeExternalExtraction } from "../protocol";
import type {
  IngestionAdapter,
  IngestionExtractionContext,
  IngestionPlan,
} from "../types";

const PROVIDER_ID = "ufpr";
const SOURCE_ID = "ufpr-nc-official";
const LETTERS = ["A", "B", "C", "D", "E"];
export const UFPR_CANONICAL_VARIANT = "english";

export const UFPR_EXPECTED_COUNTS: Readonly<Record<number, number>> = {
  2016: 80,
  2017: 80,
  2018: 80,
  2019: 90,
  2020: 90,
  2021: 60,
  2022: 60,
  2023: 90,
  2024: 90,
  2025: 90,
  2026: 90,
};

export type UfprExternalPayloadLoader = (
  context: IngestionExtractionContext,
) => unknown | Promise<unknown>;

function definitiveDocuments(
  edition: DiscoveredEdition,
  variant: string,
): DiscoveredEdition["documents"] {
  return edition.documents.filter(
    (document) =>
      (document.role === "objective-exam" || document.role === "answer-key") &&
      (!document.variant || document.variant === variant),
  );
}

function validatePhysicalLayout(
  edition: DiscoveredEdition,
  documents: DiscoveredEdition["documents"],
): void {
  const roles = new Set(documents.map((document) => document.role));
  if (!roles.has("objective-exam") || !roles.has("answer-key")) {
    throw new Error(
      `UFPR ${edition.editionId}: definitive objective exam/answer source not discovered`,
    );
  }

  const physicalUrls = new Set(documents.map((document) => document.url));
  if (physicalUrls.size !== 1) {
    throw new Error(
      `UFPR ${edition.editionId}: expected one definitive booklet carrying exam and marked answers`,
    );
  }
}

/**
 * UFPR deterministic objective-exam adapter.
 *
 * The official definitive booklet is both the question source and answer-key
 * source because NC/UFPR marks the correct alternative inside the booklet.
 * The first benchmark intentionally fixes the foreign-language variant to
 * English so a shared PDF is parsed once, not once per repeated language block.
 */
export function createUfprExternalAdapter(
  loadPayload: UfprExternalPayloadLoader,
  variant: string = UFPR_CANONICAL_VARIANT,
): IngestionAdapter {
  if (variant !== UFPR_CANONICAL_VARIANT) {
    throw new Error(
      `UFPR extractor benchmark currently supports only ${UFPR_CANONICAL_VARIANT}`,
    );
  }

  return {
    providerId: PROVIDER_ID,
    sourceId: SOURCE_ID,
    importerVersion: "ufpr-objective-extraction-adapter@0.1.0",
    discovery: createRecipeDiscovery(UFPR_OFFICIAL_RECIPE),
    statementMode: "structured",
    extractionMethod: "pdf-text-layer",
    // Operationally conservative: extraction is useful for this personal
    // project, but the adapter does not assert redistribution permission.
    rightsStatus: "official-reference",
    plan(edition): IngestionPlan[] {
      const expectedCount = UFPR_EXPECTED_COUNTS[edition.year];
      if (!expectedCount) {
        throw new Error(`UFPR ${edition.editionId}: expected question count is not verified`);
      }
      if (edition.editionId !== `PS${edition.year}`) {
        throw new Error(`UFPR ${edition.editionId}: edition/year identity mismatch`);
      }

      const documents = definitiveDocuments(edition, variant);
      validatePhysicalLayout(edition, documents);

      return [
        {
          editionId: edition.editionId,
          year: edition.year,
          phase: "first",
          variant,
          expectedCount,
          allowedLetters: [...LETTERS],
          documents,
        },
      ];
    },
    async extract(context) {
      const payload = await loadPayload(context);
      return consumeExternalExtraction(payload, context, {
        providerId: PROVIDER_ID,
        sourceId: SOURCE_ID,
      });
    },
  };
}
