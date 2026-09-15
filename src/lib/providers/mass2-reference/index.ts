import type { ExamMetadata, ExamProvider, NormalizedQuestion } from "../types";
import {
  normalizeReferenceCatalog,
  referenceQuestionKey,
  referenceQuestionsForKey,
  type ReferenceAnswerKey,
  type ReferenceAnswerKeyRaw,
} from "../vestibular-reference";

export interface Mass2ProviderSpec {
  id: string;
  institution: string;
  label: string;
  shortLabel: string;
  archiveUrl: string;
}

export interface Mass2ProviderBundle {
  provider: ExamProvider;
  metadata: ExamMetadata;
  editions: { id: string; label: string; year: number }[];
  years: number[];
  questions(editionId: string): NormalizedQuestion[];
  answerKeys(editionId: string): ReferenceAnswerKey[];
}

export function buildMass2Provider(
  spec: Mass2ProviderSpec,
  raw: Record<string, ReferenceAnswerKeyRaw>,
): Mass2ProviderBundle {
  const catalog = normalizeReferenceCatalog(spec.id, raw);
  const entries = Object.values(catalog);
  const editions = [...new Map(
    entries.map((key) => [
      key.edition,
      { id: key.edition, label: key.label, year: key.year },
    ]),
  ).values()].sort((left, right) =>
    right.id.localeCompare(left.id, "pt-BR", { numeric: true }),
  );
  const years = [...new Set(editions.map((edition) => edition.year))].sort((a, b) => b - a);
  const phases = [...new Set(entries.map((entry) => entry.phase))];

  const metadata: ExamMetadata = {
    id: spec.id,
    label: spec.label,
    shortLabel: spec.shortLabel,
    years,
    editions,
    languages: [],
    phases,
    hasEssay: false,
    areas: [{ id: "conhecimentos-gerais", label: "Conhecimentos gerais" }],
  };

  const providerConfig = {
    id: spec.id,
    institution: spec.institution,
    metadata,
    keys: catalog,
    useNamedEditionId: true,
  };

  function answerKeys(editionId: string): ReferenceAnswerKey[] {
    return entries.filter((key) => key.edition === editionId);
  }

  function questions(editionId: string): NormalizedQuestion[] {
    return answerKeys(editionId).flatMap((key) => referenceQuestionsForKey(providerConfig, key));
  }

  const provider: ExamProvider = {
    id: spec.id,
    metadata,
    async fetchQuestions({ year, editionId }) {
      const selected = editionId
        ? [editionId]
        : editions.filter((edition) => edition.year === year).map((edition) => edition.id);
      return selected.flatMap(questions);
    },
    questionKey(question) {
      return referenceQuestionKey(spec.id, question);
    },
  };

  return { provider, metadata, editions, years, questions, answerKeys };
}
