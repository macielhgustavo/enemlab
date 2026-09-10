import raw from "./answer-keys.generated.json";
import {
  normalizeReferenceCatalog,
  referenceQuestionKey,
  referenceQuestionsForKey,
  type ReferenceAnswerKey,
  type ReferenceAnswerKeyRaw,
} from "../vestibular-reference";
import type { ExamMetadata, ExamProvider, NormalizedQuestion } from "../types";

export const ACAFE_PROVIDER_ID = "acafe";

const CATALOG = normalizeReferenceCatalog(
  ACAFE_PROVIDER_ID,
  raw as unknown as Record<string, ReferenceAnswerKeyRaw>,
);

const EDITIONS = Object.values(CATALOG)
  .map((key) => ({ id: key.edition, label: `ACAFE ${key.edition}`, year: key.year }))
  .sort((left, right) => right.id.localeCompare(left.id, "pt-BR", { numeric: true }));

export function acafeEditions() {
  return EDITIONS;
}

export function acafeYears(): number[] {
  return [...new Set(EDITIONS.map((edition) => edition.year))].sort((left, right) => right - left);
}

export function acafeAnswerKey(editionId: string): ReferenceAnswerKey | null {
  return CATALOG[editionId] ?? null;
}

export function acafeQuestions(editionId: string): NormalizedQuestion[] {
  const key = acafeAnswerKey(editionId);
  return key ? referenceQuestionsForKey(acafeProviderConfig, key) : [];
}

export function acafeExamUrl(editionId: string): string | null {
  return acafeAnswerKey(editionId)?.examUrl ?? null;
}

export function acafeQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(ACAFE_PROVIDER_ID, question);
}

export const acafeMetadata: ExamMetadata = {
  id: ACAFE_PROVIDER_ID,
  label: "Associação Catarinense das Fundações Educacionais",
  shortLabel: "ACAFE",
  years: acafeYears(),
  editions: acafeEditions(),
  languages: [],
  phases: ["single"],
  hasEssay: true,
  areas: [
    { id: "matematica", label: "Matemática" },
    { id: "ciencias-natureza", label: "Ciências da Natureza" },
    { id: "ciencias-humanas", label: "Ciências Humanas" },
    { id: "linguagens", label: "Linguagens" },
  ],
};

const acafeProviderConfig = {
  id: ACAFE_PROVIDER_ID,
  institution: "Sistema ACAFE",
  metadata: acafeMetadata,
  keys: CATALOG,
  useNamedEditionId: true,
};

export const acafeProvider: ExamProvider = {
  id: ACAFE_PROVIDER_ID,
  metadata: acafeMetadata,
  async fetchQuestions({ year, editionId }) {
    const editions = editionId
      ? [editionId]
      : EDITIONS.filter((edition) => edition.year === year).map((edition) => edition.id);
    return editions.flatMap(acafeQuestions);
  },
  questionKey: acafeQuestionKey,
};
