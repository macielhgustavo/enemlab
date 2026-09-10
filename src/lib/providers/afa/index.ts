import type { ExamMetadata, ExamProvider } from "../types";
import {
  buildFabProvider,
  fabQuestionsForKey,
  fabQuestionKey,
  fabVariants,
  normalizeFabAnswerKey,
  type FabAnswerKey,
  type FabAnswerKeyRaw,
} from "../fab";
import raw from "./answer-keys.generated.json";

export const AFA_PROVIDER_ID = "afa";
const SUBJECT_LABELS = {
  portuguese: "Língua Portuguesa",
  mathematics: "Matemática",
  english: "Língua Inglesa",
  physics: "Física",
};

const KEYS = Object.fromEntries(
  Object.entries(raw as unknown as Record<string, FabAnswerKeyRaw>).map(([year, value]) => [
    year,
    normalizeFabAnswerKey(value),
  ]),
) as Record<string, FabAnswerKey>;

export function afaYears(): number[] {
  return Object.values(KEYS)
    .map((key) => key.year)
    .sort((a, b) => b - a);
}

export function afaAnswerKey(year: number): FabAnswerKey | null {
  return KEYS[String(year)] ?? null;
}

export function afaVariants(year: number) {
  const key = afaAnswerKey(year);
  return key ? fabVariants(key) : null;
}

export function afaQuestionKey(year: number, phase: string, number: number): string {
  return fabQuestionKey(AFA_PROVIDER_ID, year, phase, number);
}

export const afaMetadata: ExamMetadata = {
  id: AFA_PROVIDER_ID,
  label: "Academia da Força Aérea",
  shortLabel: "AFA",
  years: afaYears(),
  languages: [],
  phases: ["first"],
  hasEssay: false,
  areas: Object.entries(SUBJECT_LABELS).map(([id, label]) => ({ id, label })),
};

const config = {
  id: AFA_PROVIDER_ID,
  metadata: afaMetadata,
  institution: "FAB",
  keys: KEYS,
  subjectLabels: SUBJECT_LABELS,
};

export function afaFirstPhaseQuestions(year: number) {
  const key = afaAnswerKey(year);
  return key ? fabQuestionsForKey(config, key) : [];
}

export const afaProvider: ExamProvider = buildFabProvider(config);
