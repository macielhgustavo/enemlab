import raw from "./answer-keys.generated.json";
import {
  buildReferenceProvider,
  normalizeReferenceCatalog,
  referenceAnswerKey,
  referenceQuestionKey,
  referenceQuestionsForKey,
  referenceVariants,
  referenceYears,
  type ReferenceAnswerKeyRaw,
} from "../vestibular-reference";
import type { ExamMetadata, ExamProvider, NormalizedQuestion } from "../types";
import { unespDocumentUrlAtPage, unespSourcePage } from "./pages";

export const UNESP_PROVIDER_ID = "unesp";
const CATALOG = normalizeReferenceCatalog(
  UNESP_PROVIDER_ID,
  raw as unknown as Record<string, ReferenceAnswerKeyRaw>,
);
export function unespYears(): number[] {
  return referenceYears(CATALOG);
}
export function unespAnswerKey(year: number) {
  return referenceAnswerKey(CATALOG, year);
}
export function unespVariants(year: number) {
  const key = unespAnswerKey(year);
  return key ? referenceVariants(key) : null;
}
export function unespExamUrl(year: number): string | null {
  return unespAnswerKey(year)?.examUrl ?? null;
}

function attachSourcePage(question: NormalizedQuestion): NormalizedQuestion {
  const page = unespSourcePage(question.year, question.number ?? question.index);
  if (!page || !question.official?.documentUrl) return question;
  return {
    ...question,
    official: {
      ...question.official,
      page,
      documentUrl: unespDocumentUrlAtPage(question.official.documentUrl, page),
    },
  };
}

export function unespFirstPhaseQuestions(year: number): NormalizedQuestion[] {
  const key = unespAnswerKey(year);
  return key ? referenceQuestionsForKey(unespProviderConfig, key).map(attachSourcePage) : [];
}
export function unespQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(UNESP_PROVIDER_ID, question);
}

export const unespMetadata: ExamMetadata = {
  id: UNESP_PROVIDER_ID,
  label: "Universidade Estadual Paulista",
  shortLabel: "UNESP",
  years: unespYears(),
  languages: [],
  phases: ["first"],
  hasEssay: false,
  areas: [{ id: "conhecimentos-gerais", label: "Conhecimentos gerais" }],
};
const unespProviderConfig = {
  id: UNESP_PROVIDER_ID,
  institution: "VUNESP",
  metadata: unespMetadata,
  keys: CATALOG,
};
const baseUnespProvider = buildReferenceProvider(unespProviderConfig);
export const unespProvider: ExamProvider = {
  ...baseUnespProvider,
  async fetchQuestions({ year }) {
    return unespFirstPhaseQuestions(year);
  },
};
