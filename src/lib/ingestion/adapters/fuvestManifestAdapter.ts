import type { DiscoveredEdition, ExamSourceDiscovery } from "../../sources/ingestion";
import { fuvestAnswerKey, fuvestYears, type FuvestAnswerKey } from "../../providers/fuvest";
import type { ExtractedExamData, IngestionAdapter, IngestionPlan } from "../types";

const PROVIDER_ID = "fuvest";
const SOURCE_ID = "fuvest-archive";
const LETTERS = ["A", "B", "C", "D", "E"];

function manifestEntry(year: number): FuvestAnswerKey {
  const entry = fuvestAnswerKey(year);
  if (!entry) throw new Error(`FUVEST ${year}: manifest entry not found`);
  return entry;
}

function toDiscoveredEdition(entry: FuvestAnswerKey): DiscoveredEdition {
  const documents: DiscoveredEdition["documents"] = [];

  if (entry.examUrl) {
    documents.push({
      role: "objective-exam",
      url: entry.examUrl,
      phase: "first",
      variant: entry.canonicalVariant,
    });
  }
  if (entry.answerKeyUrl) {
    documents.push({ role: "answer-key", url: entry.answerKeyUrl, phase: "first" });
  }

  return {
    editionId: entry.edition,
    year: entry.year,
    label: `FUVEST ${entry.edition}`,
    documents,
  };
}

function isReviewedReferenceEntry(entry: FuvestAnswerKey): boolean {
  return (
    entry.validationLevel === "reviewed" &&
    entry.sourceType === "pdf-reference" &&
    entry.contentMode === "reference-only" &&
    entry.rightsStatus === "official-reference" &&
    entry.expectedQuestions === entry.parsedQuestions &&
    entry.expectedQuestions === entry.total &&
    entry.total >= 1 &&
    Boolean(entry.answerKeyUrl) &&
    /^[0-9a-f]{64}$/i.test(entry.retrieval.sha256) &&
    entry.retrieval.parserVersion === entry.parserVersion
  );
}

/**
 * Bridge from the existing reviewed FUVEST manifest into the generic batch
 * ingestion engine.
 *
 * This deliberately does not scrape or parse PDFs again. The current Python
 * importer remains the extractor of record while the new engine proves that
 * one adapter can orchestrate all accepted editions as a batch. A future
 * FUVEST PDF extractor can replace only `extract()` without changing the
 * engine contract.
 */
export function createFuvestManifestAdapter(): IngestionAdapter {
  const years = fuvestYears();
  const discovery: ExamSourceDiscovery = {
    sourceId: SOURCE_ID,
    async discover() {
      return years.map((year) => toDiscoveredEdition(manifestEntry(year)));
    },
    isAllowed(edition) {
      const entry = fuvestAnswerKey(edition.year);
      return Boolean(
        entry && entry.edition === edition.editionId && isReviewedReferenceEntry(entry),
      );
    },
  };

  return {
    providerId: PROVIDER_ID,
    sourceId: SOURCE_ID,
    importerVersion: "fuvest-manifest-adapter@1.0.0",
    discovery,
    statementMode: "reference-only",
    extractionMethod: "pdf-text-layer",
    rightsStatus: "official-reference",
    plan(edition): IngestionPlan[] {
      const entry = manifestEntry(edition.year);
      if (entry.edition !== edition.editionId) {
        throw new Error(
          `FUVEST ${edition.editionId}: manifest identity resolves to ${entry.edition}`,
        );
      }

      return [
        {
          editionId: entry.edition,
          year: entry.year,
          phase: "first",
          expectedCount: entry.total,
          allowedLetters: [...LETTERS],
          documents: edition.documents,
        },
      ];
    },
    async extract({ plan }): Promise<ExtractedExamData> {
      const entry = manifestEntry(plan.year);
      if (entry.edition !== plan.editionId) {
        throw new Error(`FUVEST ${plan.editionId}: extraction identity mismatch`);
      }
      if (!isReviewedReferenceEntry(entry)) {
        throw new Error(`FUVEST ${plan.editionId}: manifest entry is not eligible for ingestion`);
      }

      const answerKey = Object.fromEntries(
        Object.entries(entry.answers).map(([number, answer]) => [Number(number), answer]),
      );

      return {
        questions: Array.from({ length: entry.total }, (_, index) => ({
          number: index + 1,
          subject: "Conhecimentos gerais",
          sourceDocumentUrl: entry.examUrl ?? entry.answerKeyUrl,
        })),
        answerKey,
        annulled: [...entry.annulled],
        subjects: { "Conhecimentos gerais": entry.total },
        warnings: [
          "Conteúdo em modo referência: o adapter valida cobertura e gabarito, não republica enunciados.",
        ],
      };
    },
  };
}
