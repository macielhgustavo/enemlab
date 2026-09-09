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

export const UEL_PROVIDER_ID = "uel";

const CATALOGO = normalizeReferenceCatalog(
  UEL_PROVIDER_ID,
  bruto as unknown as Record<string, ReferenceAnswerKeyRaw>,
);

export function uelYears(): number[] {
  return referenceYears(CATALOGO);
}

export function uelAnswerKey(year: number) {
  return referenceAnswerKey(CATALOGO, year);
}

export function uelVariants(year: number) {
  const key = uelAnswerKey(year);
  return key ? referenceVariants(key) : null;
}

export function uelExamUrl(year: number): string | null {
  return uelAnswerKey(year)?.examUrl ?? null;
}

export function uelFirstPhaseQuestions(year: number): NormalizedQuestion[] {
  const key = uelAnswerKey(year);
  return key ? referenceQuestionsForKey(uelProviderConfig, key) : [];
}

export function uelQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(UEL_PROVIDER_ID, question);
}

export const uelMetadata: ExamMetadata = {
  id: UEL_PROVIDER_ID,
  label: "Universidade Estadual de Londrina",
  shortLabel: "UEL",
  years: uelYears(),
  languages: [{ id: "ingles", label: "Inglês" }],
  phases: ["first"],
  hasEssay: false,
  areas: [{ id: "conhecimentos-gerais", label: "Conhecimentos gerais" }],
};

const uelProviderConfig = {
  id: UEL_PROVIDER_ID,
  institution: "UEL/COPS",
  metadata: uelMetadata,
  keys: CATALOGO,
  defaultLanguage: "ingles",
};

export const uelProvider = buildReferenceProvider(uelProviderConfig);

