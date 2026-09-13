import {
  normalizeReferenceCatalog,
  referenceMeasure,
  referenceQuestionKey,
  referenceQuestionsForKey,
  type ReferenceAnswerKey,
} from "../vestibular-reference";
import type { ExamMetadata, ExamProvider, NormalizedQuestion } from "../types";
import { buildUnioesteRawCatalog } from "./data";

export const UNIOESTE_PROVIDER_ID = "unioeste";

const CATALOG = normalizeReferenceCatalog(UNIOESTE_PROVIDER_ID, buildUnioesteRawCatalog());
const KEYS = Object.values(CATALOG).sort((left, right) => {
  if (left.year !== right.year) return right.year - left.year;
  return left.phase === "morning" ? -1 : 1;
});

export function unioesteYears(): number[] {
  return [...new Set(KEYS.map((key) => key.year))].sort((a, b) => b - a);
}

export function unioesteAnswerKeys(year: number): ReferenceAnswerKey[] {
  return KEYS.filter((key) => key.year === year);
}

export function unioesteExamUrl(year: number, phase: "morning" | "afternoon"): string | null {
  return unioesteAnswerKeys(year).find((key) => key.phase === phase)?.examUrl ?? null;
}

export function unioesteQuestions(year: number): NormalizedQuestion[] {
  return unioesteAnswerKeys(year).flatMap((key) =>
    referenceQuestionsForKey(unioesteProviderConfig, key).map((question) =>
      key.phase === "morning" ? { ...question, language: "ingles" } : question,
    ),
  );
}

export function unioesteQuestionKey(question: NormalizedQuestion): string {
  return referenceQuestionKey(UNIOESTE_PROVIDER_ID, question);
}

export function unioesteMeasures(year: number) {
  return unioesteAnswerKeys(year).map((key) => ({ phase: key.phase, ...referenceMeasure(key) }));
}

export const unioesteMetadata: ExamMetadata = {
  id: UNIOESTE_PROVIDER_ID,
  label: "Universidade Estadual do Oeste do Paraná",
  shortLabel: "UNIOESTE",
  years: unioesteYears(),
  languages: [{ id: "ingles", label: "Inglês" }],
  phases: ["morning", "afternoon"],
  hasEssay: false,
  areas: [
    { id: "linguagens", label: "Linguagens" },
    { id: "ciencias-humanas", label: "Ciências Humanas" },
    { id: "ciencias-natureza", label: "Ciências da Natureza" },
    { id: "matematica", label: "Matemática" },
  ],
};

const unioesteProviderConfig = {
  id: UNIOESTE_PROVIDER_ID,
  institution: "UNIOESTE",
  metadata: unioesteMetadata,
  keys: CATALOG,
};

export const unioesteProvider: ExamProvider = {
  id: UNIOESTE_PROVIDER_ID,
  metadata: unioesteMetadata,
  async fetchQuestions({ year }) {
    return unioesteQuestions(year);
  },
  questionKey: unioesteQuestionKey,
};
