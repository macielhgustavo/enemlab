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

export const PUC_SP_PROVIDER_ID = "puc-sp";

const CATALOGO = normalizeReferenceCatalog(
  PUC_SP_PROVIDER_ID,
  bruto as unknown as Record<string, ReferenceAnswerKeyRaw>,
);

export function pucSpYears(): number[] {
  return referenceYears(CATALOGO);
}

export function pucSpAnswerKey(year: number) {
  return referenceAnswerKey(CATALOGO, year);
}

export function pucSpVariants(year: number) {
  const key = pucSpAnswerKey(year);
  return key ? referenceVariants(key) : null;
}

export function pucSpExamUrl(year: number): string | null {
  return pucSpAnswerKey(year)?.examUrl ?? null;
}

export function pucSpQuestions(year: number): NormalizedQuestion[] {
  const key = pucSpAnswerKey(year);
  return key ? referenceQuestionsForKey(pucSpProviderConfig, key) : [];
}

export function pucSpQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(PUC_SP_PROVIDER_ID, question);
}

export const pucSpMetadata: ExamMetadata = {
  id: PUC_SP_PROVIDER_ID,
  label: "Pontifícia Universidade Católica de São Paulo",
  shortLabel: "PUC-SP",
  years: pucSpYears(),
  languages: [],
  phases: ["single"],
  hasEssay: false,
  areas: [
    { id: "matematica", label: "Matemática" },
    { id: "ciencias-natureza", label: "Ciências da Natureza" },
    { id: "ciencias-humanas", label: "Ciências Humanas" },
    { id: "linguagens", label: "Linguagens" },
  ],
};

const pucSpProviderConfig = {
  id: PUC_SP_PROVIDER_ID,
  institution: "PUC-SP/NucVest",
  metadata: pucSpMetadata,
  keys: CATALOGO,
};

export const pucSpProvider = buildReferenceProvider(pucSpProviderConfig);

