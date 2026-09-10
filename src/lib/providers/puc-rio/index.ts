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
import type { ExamMetadata, NormalizedQuestion } from "../types";

export const PUC_RIO_PROVIDER_ID = "puc-rio";

const CATALOG = normalizeReferenceCatalog(
  PUC_RIO_PROVIDER_ID,
  raw as unknown as Record<string, ReferenceAnswerKeyRaw>,
);

export function pucRioYears(): number[] {
  return referenceYears(CATALOG);
}

export function pucRioAnswerKey(year: number) {
  return referenceAnswerKey(CATALOG, year);
}

export function pucRioVariants(year: number) {
  const key = pucRioAnswerKey(year);
  return key ? referenceVariants(key) : null;
}

export function pucRioExamUrl(year: number): string | null {
  return pucRioAnswerKey(year)?.examUrl ?? null;
}

export function pucRioQuestions(year: number): NormalizedQuestion[] {
  const key = pucRioAnswerKey(year);
  return key ? referenceQuestionsForKey(pucRioProviderConfig, key) : [];
}

export function pucRioQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(PUC_RIO_PROVIDER_ID, question);
}

export const pucRioMetadata: ExamMetadata = {
  id: PUC_RIO_PROVIDER_ID,
  label: "Pontifícia Universidade Católica do Rio de Janeiro",
  shortLabel: "PUC-Rio",
  years: pucRioYears(),
  languages: [],
  phases: ["day2"],
  hasEssay: true,
  areas: [{ id: "conhecimentos-gerais", label: "Conhecimentos gerais" }],
};

const pucRioProviderConfig = {
  id: PUC_RIO_PROVIDER_ID,
  institution: "PUC-Rio",
  metadata: pucRioMetadata,
  keys: CATALOG,
};

export const pucRioProvider = buildReferenceProvider(pucRioProviderConfig);
