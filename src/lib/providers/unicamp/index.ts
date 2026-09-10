import bruto from "./answer-keys.generated.json";
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

export const UNICAMP_PROVIDER_ID = "unicamp";

const CATALOGO = normalizeReferenceCatalog(
  UNICAMP_PROVIDER_ID,
  bruto as unknown as Record<string, ReferenceAnswerKeyRaw>,
);

export function unicampYears(): number[] {
  return referenceYears(CATALOGO);
}

export function unicampAnswerKey(year: number) {
  return referenceAnswerKey(CATALOGO, year);
}

export function unicampVariants(year: number) {
  const key = unicampAnswerKey(year);
  return key ? referenceVariants(key) : null;
}

export function unicampExamUrl(year: number): string | null {
  return unicampAnswerKey(year)?.examUrl ?? null;
}

export function unicampFirstPhaseQuestions(year: number): NormalizedQuestion[] {
  const key = unicampAnswerKey(year);
  return key ? referenceQuestionsForKey(unicampProviderConfig, key) : [];
}

export function unicampQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(UNICAMP_PROVIDER_ID, question);
}

export const unicampMetadata: ExamMetadata = {
  id: UNICAMP_PROVIDER_ID,
  label: "Comissão Permanente para os Vestibulares da Unicamp",
  shortLabel: "UNICAMP",
  years: unicampYears(),
  languages: [],
  phases: ["first"],
  hasEssay: false,
  areas: [{ id: "conhecimentos-gerais", label: "Conhecimentos gerais" }],
};

const unicampProviderConfig = {
  id: UNICAMP_PROVIDER_ID,
  institution: "UNICAMP/COMVEST",
  metadata: unicampMetadata,
  keys: CATALOGO,
};

export const unicampProvider = buildReferenceProvider(unicampProviderConfig);

