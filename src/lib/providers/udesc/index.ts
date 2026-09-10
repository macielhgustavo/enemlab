import raw from "./answer-keys.generated.json";
import {
  normalizeReferenceCatalog,
  referenceQuestionKey,
  referenceQuestionsForKey,
  type ReferenceAnswerKey,
  type ReferenceAnswerKeyRaw,
} from "../vestibular-reference";
import type { ExamMetadata, ExamProvider, NormalizedQuestion } from "../types";

export const UDESC_PROVIDER_ID = "udesc";

const CATALOG = normalizeReferenceCatalog(
  UDESC_PROVIDER_ID,
  raw as unknown as Record<string, ReferenceAnswerKeyRaw>,
);

const EDITIONS = [...new Map(
  Object.values(CATALOG).map((key) => [
    key.edition,
    { id: key.edition, label: `UDESC ${key.edition}`, year: key.year },
  ]),
).values()].sort((left, right) => right.id.localeCompare(left.id, "pt-BR", { numeric: true }));

export function udescEditions() {
  return EDITIONS;
}

export function udescYears(): number[] {
  return [...new Set(EDITIONS.map((edition) => edition.year))].sort((left, right) => right - left);
}

export function udescAnswerKeys(editionId: string): ReferenceAnswerKey[] {
  return Object.values(CATALOG)
    .filter((key) => key.edition === editionId)
    .sort((left, right) => left.phase === "morning" ? -1 : right.phase === "morning" ? 1 : 0);
}

export function udescQuestions(editionId: string): NormalizedQuestion[] {
  return udescAnswerKeys(editionId).flatMap((key) => referenceQuestionsForKey(udescProviderConfig, key));
}

export function udescExamUrl(editionId: string, phase: "morning" | "afternoon"): string | null {
  return udescAnswerKeys(editionId).find((key) => key.phase === phase)?.examUrl ?? null;
}

export function udescQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(UDESC_PROVIDER_ID, question);
}

export const udescMetadata: ExamMetadata = {
  id: UDESC_PROVIDER_ID,
  label: "Universidade do Estado de Santa Catarina",
  shortLabel: "UDESC",
  years: udescYears(),
  editions: udescEditions(),
  languages: [],
  phases: ["morning", "afternoon"],
  hasEssay: false,
  areas: [
    { id: "matematica", label: "Matemática" },
    { id: "ciencias-natureza", label: "Ciências da Natureza" },
    { id: "ciencias-humanas", label: "Ciências Humanas" },
    { id: "linguagens", label: "Linguagens" },
  ],
};

const udescProviderConfig = {
  id: UDESC_PROVIDER_ID,
  institution: "UDESC/COVEST",
  metadata: udescMetadata,
  keys: CATALOG,
  useNamedEditionId: true,
};

export const udescProvider: ExamProvider = {
  id: UDESC_PROVIDER_ID,
  metadata: udescMetadata,
  async fetchQuestions({ year, editionId }) {
    const editions = editionId
      ? [editionId]
      : EDITIONS.filter((edition) => edition.year === year).map((edition) => edition.id);
    return editions.flatMap(udescQuestions);
  },
  questionKey: udescQuestionKey,
};
